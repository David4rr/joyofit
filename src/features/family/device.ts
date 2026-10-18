import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

import { family } from '@/cloud/family';
import { HuaweiWear, type FamilyConfig, type FamilyUploadResult } from '@/wear';

/** This phone as the Worker knows it: one id for the install, and the bearer token the native upload sends with it. */
const DEVICE_ID_KEY = 'joyofit_family_device_id';
const DEVICE_TOKEN_KEY = 'joyofit_family_device_token';

export const pushPlatform = Platform.OS === 'ios' ? 'ios' : 'android';

/** Stable across launches (the Keychain keeps it on iOS), so a re-minted token replaces the old one instead of adding a sixth. */
export async function familyDeviceId(): Promise<string> {
  const stored = await SecureStore.getItemAsync(DEVICE_ID_KEY);
  if (stored) return stored;
  const created = Crypto.randomUUID();
  await SecureStore.setItemAsync(DEVICE_ID_KEY, created);
  return created;
}

/** The stored device token, minted once with the session and shown by the Worker only then. */
export async function ensureDeviceToken(): Promise<string> {
  const stored = await SecureStore.getItemAsync(DEVICE_TOKEN_KEY);
  if (stored) return stored;
  const { token } = await family.deviceToken.create(await familyDeviceId());
  await SecureStore.setItemAsync(DEVICE_TOKEN_KEY, token);
  return token;
}

export const forgetDeviceToken = () => SecureStore.deleteItemAsync(DEVICE_TOKEN_KEY);

export async function hasDeviceToken(): Promise<boolean> {
  return (await SecureStore.getItemAsync(DEVICE_TOKEN_KEY)) !== null;
}

/**
 * The native calls, guarded: a JavaScript bundle that runs on a build without family monitoring (an update onto an
 * older binary) must not crash, it just uploads nothing.
 */
export async function configureNative(config: FamilyConfig | null): Promise<void> {
  if (typeof HuaweiWear.familyConfigure === 'function') await HuaweiWear.familyConfigure(config);
}

export async function uploadNative(): Promise<FamilyUploadResult | null> {
  return typeof HuaweiWear.familyUploadNow === 'function' ? HuaweiWear.familyUploadNow() : null;
}

/** Stops everything this phone does for family monitoring locally: no native config, no stored token. */
export async function clearLocalFamily(): Promise<void> {
  await Promise.allSettled([configureNative(null), forgetDeviceToken()]);
}

/**
 * Called before the JoyoRogo session is dropped, while the Worker still accepts it: revokes this phone's device token
 * and push token, then clears the local side. The server calls are best effort, so being offline never blocks signing
 * out; a token left behind is useless without a link and is replaced the next time the account signs in here.
 */
export async function releaseFamilyDevice(): Promise<void> {
  try {
    const deviceId = await familyDeviceId();
    await Promise.allSettled([family.deviceToken.revoke(deviceId), family.pushToken.remove(deviceId)]);
  } finally {
    await clearLocalFamily();
  }
}
