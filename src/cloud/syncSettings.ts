import { getNetworkStateAsync, NetworkStateType } from 'expo-network';
import Storage from 'expo-sqlite/kv-store';

const WIFI_ONLY_KEY = 'cloud.wifiOnly';
const AUTO_SYNC_KEY = 'cloud.autoSync';

export interface SyncSettings {
  /** Automatic runs wait for Wi-Fi or Ethernet. */
  wifiOnly: boolean;
  /** Runs start on their own after a local sync and when the app comes back. */
  autoSync: boolean;
}

/** Wi-Fi only is off until chosen, automatic sync is on until the person (or "Delete cloud data") turns it off. */
export function readSyncSettings(): SyncSettings {
  return {
    wifiOnly: Storage.getItemSync(WIFI_ONLY_KEY) === '1',
    autoSync: Storage.getItemSync(AUTO_SYNC_KEY) !== '0',
  };
}

export function writeWifiOnly(value: boolean): void {
  Storage.setItemSync(WIFI_ONLY_KEY, value ? '1' : '0');
}

export function writeAutoSync(value: boolean): void {
  Storage.setItemSync(AUTO_SYNC_KEY, value ? '1' : '0');
}

/** The phone is on Wi-Fi or Ethernet, where a backfill of workouts does not eat a mobile data plan. */
export async function onUnmeteredNetwork(): Promise<boolean> {
  try {
    const state = await getNetworkStateAsync();
    return state.isConnected === true && (state.type === NetworkStateType.WIFI || state.type === NetworkStateType.ETHERNET);
  } catch {
    return false;
  }
}
