/**
 * Keeps the screen on while the logger is open. `expo-keep-awake` is autolinked by expo but may be missing from an older binary:
 * then every call does nothing instead of crashing.
 */
type KeepAwake = {
  activateKeepAwakeAsync: (tag?: string) => Promise<void>;
  deactivateKeepAwake: (tag?: string) => Promise<void>;
};

const TAG = 'strength';

function load(): KeepAwake | null {
  try {
    return require('expo-keep-awake') as KeepAwake;
  } catch {
    return null;
  }
}

export async function holdScreenOn(): Promise<void> {
  try {
    await load()?.activateKeepAwakeAsync(TAG);
  } catch {
    // a binary without the native module: the screen just follows the system timeout
  }
}

export async function releaseScreen(): Promise<void> {
  try {
    await load()?.deactivateKeepAwake(TAG);
  } catch {
    // see holdScreenOn
  }
}
