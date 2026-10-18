import { describe, expect, test } from 'bun:test';

import { GARMIN_GPX } from '../routes/routeFixtures';
import { headOf, MAX_WHOLE_READ_BYTES, type HeadSource } from './headOf';
import { classifyByName, screenFor, SNIFF_BYTES, sniffKind } from './routeSharedFile';

const gpx = new TextEncoder().encode(GARMIN_GPX);

/** A source that behaves like expo-file-system on a plain `content://` URI: no handle, whole-file reads only. */
function contentUriSource(bytes: Uint8Array, size: number | null = bytes.length): HeadSource {
  return {
    open() {
      throw new Error('File handle is not supported for content://com.android.gm.provider/attachment/1');
    },
    size,
    bytesSync: () => bytes,
  };
}

function handleSource(bytes: Uint8Array): HeadSource & { closed: boolean } {
  const source = {
    closed: false,
    size: bytes.length,
    open: () => ({ readBytes: (n: number) => bytes.slice(0, n), close: () => void (source.closed = true) }),
    bytesSync: () => {
      throw new Error('must not read the whole file when a handle opens');
    },
  };
  return source;
}

describe('headOf', () => {
  test('reads through a handle and closes it', () => {
    const source = handleSource(gpx);
    expect(headOf(source)).toEqual(gpx.slice(0, SNIFF_BYTES));
    expect(source.closed).toBe(true);
  });

  test('an extension-less content:// GPX is read whole, sniffed as GPX and sent to the route import', () => {
    const uri = 'content://com.android.gm.provider/attachment/1';
    expect(classifyByName(uri)).toBe('unknown');
    const head = headOf(contentUriSource(gpx));
    expect(head).not.toBeNull();
    expect(head!.length).toBeLessThanOrEqual(SNIFF_BYTES);
    const kind = sniffKind(head!);
    expect(kind).toBe('gpx');
    expect(screenFor(uri, kind)).toStartWith('/routes/import?uri=');
  });

  test('a read failure or an oversized file gives null', () => {
    const broken: HeadSource = {
      open() {
        throw new Error('no handle');
      },
      size: 10,
      bytesSync() {
        throw new Error('unreadable');
      },
    };
    expect(headOf(broken)).toBeNull();
    expect(headOf(contentUriSource(gpx, MAX_WHOLE_READ_BYTES + 1))).toBeNull();
  });

  test('an unknown size is still read', () => {
    expect(headOf(contentUriSource(gpx, null))).toEqual(gpx.slice(0, SNIFF_BYTES));
  });
});
