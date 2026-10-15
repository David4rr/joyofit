import { useCallback, useEffect, useState } from 'react';
import { PermissionsAndroid, Platform } from 'react-native';

export type PermissionStatus = 'checking' | 'granted' | 'denied' | 'blocked';

/** Android 12 (API 31) introduced the runtime BLUETOOTH_CONNECT permission; older versions grant it at install. */
const RUNTIME_BLUETOOTH_API = 31;

export async function ensureBluetoothConnect(): Promise<Exclude<PermissionStatus, 'checking'>> {
  if (Platform.OS !== 'android') return 'granted';
  const version = Number(Platform.Version);
  if (version >= RUNTIME_BLUETOOTH_API) {
    const connectPerm = PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT;
    const scanPerm = PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN;
    const hasConnect = await PermissionsAndroid.check(connectPerm);
    const hasScan = await PermissionsAndroid.check(scanPerm);
    if (hasConnect && hasScan) return 'granted';

    const results = await PermissionsAndroid.requestMultiple([connectPerm, scanPerm]);
    const connectRes = results[connectPerm];
    const scanRes = results[scanPerm];
    if (connectRes === PermissionsAndroid.RESULTS.GRANTED && scanRes === PermissionsAndroid.RESULTS.GRANTED) {
      return 'granted';
    }
    if (
      connectRes === PermissionsAndroid.RESULTS.NEVER_ASK_AGAIN ||
      scanRes === PermissionsAndroid.RESULTS.NEVER_ASK_AGAIN
    ) {
      return 'blocked';
    }
    return 'denied';
  } else {
    // Android < 12 requires location for BLE scanning
    const locPerm = PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION;
    if (await PermissionsAndroid.check(locPerm)) return 'granted';
    const res = await PermissionsAndroid.request(locPerm);
    if (res === PermissionsAndroid.RESULTS.GRANTED) return 'granted';
    return res === PermissionsAndroid.RESULTS.NEVER_ASK_AGAIN ? 'blocked' : 'denied';
  }
}

/** Checks BLUETOOTH_CONNECT on mount and asks for it when it is not yet granted. */
export function useBluetoothPermission() {
  const [status, setStatus] = useState<PermissionStatus>('checking');

  useEffect(() => {
    let live = true;
    void ensureBluetoothConnect().then((next) => {
      if (live) setStatus(next);
    });
    return () => {
      live = false;
    };
  }, []);

  const request = useCallback(async () => {
    setStatus(await ensureBluetoothConnect());
  }, []);

  return { status, request };
}
