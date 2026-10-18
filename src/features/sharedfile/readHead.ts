import { File } from 'expo-file-system';

import { headOf } from './headOf';

/** The first bytes of a file, or null when it cannot be opened. */
export function readHead(uri: string): Uint8Array | null {
  try {
    return headOf(new File(uri));
  } catch {
    return null;
  }
}
