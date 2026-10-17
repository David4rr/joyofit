import { File } from 'expo-file-system';

import { SNIFF_BYTES } from './routeSharedFile';

/** The first bytes of a file, or null when it cannot be opened. */
export function readHead(uri: string): Uint8Array | null {
  try {
    const handle = new File(uri).open();
    try {
      return handle.readBytes(SNIFF_BYTES);
    } finally {
      handle.close();
    }
  } catch {
    return null;
  }
}
