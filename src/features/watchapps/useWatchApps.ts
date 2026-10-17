import { useEventListener } from 'expo';
import * as DocumentPicker from 'expo-document-picker';
import { useFocusEffect } from 'expo-router';
import { useCallback, useRef, useState } from 'react';

import { findFuel } from '@/features/watchapps/appModel';
import { errorMessage } from '@/format';
import { useWatch } from '@/state/WatchProvider';
import {
  HuaweiWear,
  type AppInstallStatusEvent,
  type FuelLinkStatus,
  type UploadProgressEvent,
  type WatchAppList,
  type WatchAppPackageInfo,
} from '@/wear';

/** A file the user picked, read by `inspectWatchApp` and waiting for the Install button. */
export interface PickedApp {
  uri: string;
  info: WatchAppPackageInfo;
}

/** What the screen waits for: the list, an install, a delete, or a Fuel link call. */
export type WatchAppBusy = 'list' | 'install' | { packageName: string; action: 'delete' } | 'fuel' | null;

/**
 * The apps on the watch and the JoyoFit Fuel link. The list and the link status are read whenever the screen gains focus with a
 * connected watch; install, delete and the Fuel calls replace them with what the watch answered.
 */
export function useWatchApps() {
  const { linkState } = useWatch();
  const connected = linkState === 'connected' || linkState === 'syncing';
  const [list, setList] = useState<WatchAppList | null>(null);
  const [fuel, setFuel] = useState<FuelLinkStatus | null>(null);
  const [picked, setPicked] = useState<PickedApp | null>(null);
  const [busy, setBusy] = useState<WatchAppBusy>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [fuelError, setFuelError] = useState<string | null>(null);
  const [fuelNotice, setFuelNotice] = useState<string | null>(null);
  const [progress, setProgress] = useState<UploadProgressEvent | null>(null);
  const [report, setReport] = useState<AppInstallStatusEvent | null>(null);

  useEventListener(HuaweiWear, 'onUploadProgress', (event) => setProgress(event));
  useEventListener(HuaweiWear, 'onAppInstallStatus', (event) => setReport(event));

  // One operation at a time: a second one started while the first runs would clear `busy` while the native call still holds the link.
  const busyRef = useRef<WatchAppBusy>(null);
  const begin = useCallback((kind: Exclude<WatchAppBusy, null>) => {
    if (busyRef.current !== null) return false;
    busyRef.current = kind;
    setBusy(kind);
    return true;
  }, []);
  const end = useCallback(() => {
    busyRef.current = null;
    setBusy(null);
  }, []);

  const run = useCallback(
    async (kind: Exclude<WatchAppBusy, null>, action: () => Promise<void>) => {
      if (!begin(kind)) return;
      setError(null);
      setNotice(null);
      try {
        await action();
      } catch (e) {
        setError(errorMessage(e));
      } finally {
        end();
      }
    },
    [begin, end],
  );

  const refreshFuel = useCallback(async () => {
    try {
      setFuel(await HuaweiWear.getFuelLink());
      setFuelError(null);
    } catch (e) {
      setFuelError(errorMessage(e));
    }
  }, []);

  const refresh = useCallback(async () => {
    await run('list', async () => setList(await HuaweiWear.listWatchApps()));
    await refreshFuel();
  }, [run, refreshFuel]);

  const remove = useCallback(
    (packageName: string) =>
      run({ packageName, action: 'delete' }, async () => {
        setReport(null);
        setList(await HuaweiWear.deleteWatchApp(packageName));
        setNotice('Removed from the watch.');
      }),
    [run],
  );

  /** Asks for a file and reads what it is; the install itself is a second step, so the user sees name, version and signature first. */
  const pick = useCallback(async () => {
    setError(null);
    setNotice(null);
    let result: DocumentPicker.DocumentPickerResult;
    try {
      // Opened in place: the native side reads content:// and file:// URIs itself, and a copy would leave up to 16 MiB in the cache.
      result = await DocumentPicker.getDocumentAsync({ type: '*/*', copyToCacheDirectory: false, multiple: false });
    } catch (e) {
      setError(errorMessage(e));
      return;
    }
    if (result.canceled || result.assets.length === 0) return;
    const uri = result.assets[0].uri;
    try {
      setPicked({ uri, info: await HuaweiWear.inspectWatchApp(uri) });
    } catch (e) {
      setPicked(null);
      setError(errorMessage(e));
    }
  }, []);

  const clearPicked = useCallback(() => setPicked(null), []);

  const install = useCallback(
    async (allowUnsigned: boolean) => {
      if (!picked) return;
      await run('install', async () => {
        setProgress({ bytes: 0, total: 0 });
        setReport(null);
        try {
          const result = await HuaweiWear.installWatchApp(picked.uri, allowUnsigned);
          if (result.list) setList(result.list);
          if (result.listed) {
            setNotice(`${result.name}: ${result.message}`);
            setPicked(null);
          } else {
            setError(`${result.name}: ${result.message}`);
          }
        } finally {
          setProgress(null);
        }
      });
      await refreshFuel();
    },
    [picked, run, refreshFuel],
  );

  const sendProfile = useCallback(async () => {
    if (!begin('fuel')) return;
    setFuelError(null);
    setFuelNotice(null);
    try {
      const result = await HuaweiWear.sendFuelProfile();
      setFuelNotice(
        result.sent
          ? 'The profile was sent. The watch app answers with hello or ack when it is open.'
          : 'The profile was not sent: JoyoFit could not read its own signing certificate.',
      );
      // The ping answer arrives a moment after the call returns.
      setTimeout(() => void refreshFuel(), 1500);
      await refreshFuel();
    } catch (e) {
      setFuelError(errorMessage(e));
    } finally {
      end();
    }
  }, [refreshFuel, begin, end]);

  const saveFingerprint = useCallback(
    async (fingerprint: string) => {
      try {
        await HuaweiWear.setFuelWatchFingerprint(fingerprint.trim());
        setFuelNotice('Watch app fingerprint saved.');
        setFuelError(null);
        await refreshFuel();
      } catch (e) {
        setFuelError(errorMessage(e));
      }
    },
    [refreshFuel],
  );

  useFocusEffect(
    useCallback(() => {
      // The phone fingerprint and the saved watch app fingerprint are readable without a watch.
      if (connected) void refresh();
      else void refreshFuel();
    }, [connected, refresh, refreshFuel]),
  );

  return {
    connected,
    list,
    fuel,
    fuelInstalled: findFuel(list),
    picked,
    busy,
    error,
    notice,
    fuelError,
    fuelNotice,
    progress,
    report,
    refresh,
    remove,
    pick,
    clearPicked,
    install,
    sendProfile,
    saveFingerprint,
  };
}
