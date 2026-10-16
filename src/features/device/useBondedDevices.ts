import { useEventListener } from 'expo';
import { useFocusEffect } from 'expo-router';
import { useCallback, useRef, useState } from 'react';

import { supportRank } from '@/features/device/modelSupport';
import { errorMessage } from '@/format';
import { HuaweiWear, type BondedDevice } from '@/wear';

interface BondedState {
  devices: BondedDevice[];
  loading: boolean;
  scanning: boolean;
  error: string | null;
}

function sortDevices(devices: BondedDevice[]): BondedDevice[] {
  return [...devices].sort(
    (a, b) => supportRank(a.support) - supportRank(b.support) || a.name.localeCompare(b.name),
  );
}

/** Loads bonded and nearby BLE devices when permission is granted. */
export function useBondedDevices(enabled: boolean) {
  const [state, setState] = useState<BondedState>({
    devices: [],
    loading: false,
    scanning: false,
    error: null,
  });
  const deviceMapRef = useRef<Map<string, BondedDevice>>(new Map());
  const scanTimeoutRef = useRef<number | null>(null);
  const reload = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const bonded = await HuaweiWear.getBondedDevices();
      const discovered = HuaweiWear.getDiscoveredDevices();
      const activeDev = HuaweiWear.getDevice();
      const map = new Map<string, BondedDevice>();
      for (const d of bonded) map.set(d.address, d);
      for (const d of discovered) {
        if (!map.has(d.address)) map.set(d.address, d);
      }
      if (activeDev && !map.has(activeDev.address)) {
        map.set(activeDev.address, {
          address: activeDev.address,
          name: activeDev.name || activeDev.address,
          model: activeDev.model ?? null,
          support: activeDev.support,
          reason: null,
        });
      }
      deviceMapRef.current = map;
      setState((s) => ({
        ...s,
        devices: sortDevices(Array.from(map.values())),
        loading: false,
        error: null,
      }));
    } catch (e) {
      setState((s) => ({ ...s, loading: false, error: errorMessage(e) }));
    }
  }, []);

  const stopScan = useCallback(async () => {
    clearTimeout(scanTimeoutRef.current ?? undefined);
    scanTimeoutRef.current = null;
    try {
      await HuaweiWear.stopScan();
      setState((s) => ({ ...s, scanning: false }));
    } catch {
      // ignore
    }
  }, []);

  const startScan = useCallback(async () => {
    try {
      clearTimeout(scanTimeoutRef.current ?? undefined);
      setState((s) => ({ ...s, scanning: true, error: null }));
      await HuaweiWear.startScan();
      scanTimeoutRef.current = setTimeout(() => {
        void stopScan();
      }, 12000) as unknown as number;
    } catch (e) {
      setState((s) => ({ ...s, scanning: false, error: errorMessage(e) }));
    }
  }, [stopScan]);
  useEventListener(HuaweiWear, 'onDeviceDiscovered', (device) => {
    const map = deviceMapRef.current;
    if (!map.has(device.address) || map.get(device.address)?.name !== device.name) {
      map.set(device.address, device);
      setState((s) => ({
        ...s,
        devices: sortDevices(Array.from(map.values())),
      }));
    }
  });

  useEventListener(HuaweiWear, 'onScanStateChange', (event) => {
    setState((s) => ({
      ...s,
      scanning: event.scanning,
      error: event.error ?? s.error,
    }));
  });

  useFocusEffect(
    useCallback(() => {
      if (enabled) {
        void reload();
      }
      return () => {
        void stopScan();
      };
    }, [enabled, reload, stopScan]),
  );

  return { ...state, reload, startScan, stopScan };
}
