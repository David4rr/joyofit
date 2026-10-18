import { SNIFF_BYTES } from './routeSharedFile';

/** The part of expo-file-system's `File` that reading a file's first bytes needs. */
export interface HeadSource {
  open(): { readBytes(length: number): Uint8Array; close(): void };
  readonly size: number | null;
  bytesSync(): Uint8Array;
}

/** A file that cannot be opened as a handle is read whole to look at its head; anything bigger than this is not read. */
export const MAX_WHOLE_READ_BYTES = 20 * 1024 * 1024;

/**
 * The first bytes of a file, or null when it cannot be read. A random-access handle is tried first. It works for `file://`
 * and document URIs but not for the plain `content://` URIs a share or "Open with" intent hands over (a FileProvider
 * attachment, a MediaStore item): expo-file-system throws for those, so the stream is read whole instead, up to
 * `MAX_WHOLE_READ_BYTES`.
 */
export function headOf(source: HeadSource): Uint8Array | null {
  try {
    const handle = source.open();
    try {
      return handle.readBytes(SNIFF_BYTES);
    } finally {
      handle.close();
    }
  } catch {
    // No handle for this kind of URI; read it whole below.
  }
  try {
    const size = source.size;
    if (size !== null && size > MAX_WHOLE_READ_BYTES) return null;
    return source.bytesSync().subarray(0, SNIFF_BYTES);
  } catch {
    return null;
  }
}
