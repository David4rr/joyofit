import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';

import { supportRank } from '@/features/device/modelSupport';
import { errorMessage } from '@/format';
import { HuaweiWear, type BondedDevice } from '@/wear';

interface BondedState {
  devices: BondedDevice[];
  loading: boolean;
  error: string | null;
  /** True once a load has finished, so "no watch found" is not shown before the first answer. */
  loaded: boolean;
}

/** Tested watches first, then experimental, unknown and unsupported, each by name. */
function sortBonded(devices: BondedDevice[]): BondedDevice[] {
  return [...devices].sort(
    (a, b) => supportRank(a.support) - supportRank(b.support) || a.name.localeCompare(b.name),
  );
}

/** Loads bonded devices once permission is granted, and again whenever the tab regains focus. */
export function useBondedDevices(enabled: boolean) {
  const [state, setState] = useState<BondedState>({ devices: [], loading: false, error: null, loaded: false });

  const load = useCallback(async (fetchDevices: () => Promise<BondedDevice[]>) => {
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const devices = sortBonded(await fetchDevices());
      setState({ devices, loading: false, error: null, loaded: true });
    } catch (e) {
      setState((s) => ({ ...s, loading: false, error: errorMessage(e), loaded: true }));
    }
  }, []);

  const reload = useCallback(() => load(() => HuaweiWear.getBondedDevices()), [load]);
  /** The Refresh button: on iOS the last scan is ignored and the scan runs longer, so a watch that was just released shows up. */
  const refresh = useCallback(() => load(() => HuaweiWear.refreshBondedDevices()), [load]);

  useFocusEffect(
    useCallback(() => {
      if (enabled) void reload();
    }, [enabled, reload]),
  );

  return { ...state, reload, refresh };
}
