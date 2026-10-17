import { describe, expect, test } from 'bun:test';

import { classifyByName, extensionOf, screenFor, sniffKind } from './routeSharedFile';

const zip = Uint8Array.from([0x50, 0x4b, 0x03, 0x04, 0, 0, 0, 0, 0, 0, 0, 0]);
const fit = Uint8Array.from([14, 0x20, 0x98, 0, 0, 0, 0, 0, 0x2e, 0x46, 0x49, 0x54]);

describe('extensionOf', () => {
  test('reads the name from a document URI', () => {
    expect(extensionOf('content://x/document/primary%3ADownload%2FHealth%20data.ZIP')).toBe('zip');
    expect(extensionOf('file:///sdcard/a/b.fit?x=1')).toBe('fit');
  });
  test('none when there is no extension', () => {
    expect(extensionOf('content://com.android.providers.downloads.documents/document/msf%3A1234')).toBeNull();
  });
});

describe('classifyByName', () => {
  test('extension wins', () => {
    expect(classifyByName('content://x/a.zip', 'application/octet-stream')).toBe('huawei-zip');
    expect(classifyByName('content://x/ride.FIT', 'application/zip')).toBe('fit');
  });
  test('MIME type when the name has no extension', () => {
    expect(classifyByName('content://x/1', 'application/x-zip-compressed')).toBe('huawei-zip');
    expect(classifyByName('content://x/1', 'application/zip')).toBe('huawei-zip');
    expect(classifyByName('content://x/1', 'application/vnd.ant.fit')).toBe('fit');
  });
  test('unknown for octet-stream without extension', () => {
    expect(classifyByName('content://x/1', 'application/octet-stream')).toBe('unknown');
    expect(classifyByName('content://x/1')).toBe('unknown');
  });
});

describe('sniffKind', () => {
  test('PK is a ZIP', () => expect(sniffKind(zip)).toBe('huawei-zip'));
  test('.FIT at offset 8 is a FIT file', () => expect(sniffKind(fit)).toBe('fit'));
  test('anything else, or too short, is unknown', () => {
    expect(sniffKind(new Uint8Array(12))).toBe('unknown');
    expect(sniffKind(new Uint8Array(0))).toBe('unknown');
    expect(sniffKind(Uint8Array.from([0x50, 0x4b]))).toBe('unknown');
  });
});

describe('screenFor', () => {
  test('ZIP to the Huawei import, FIT and unknown to the FIT import, uri encoded', () => {
    expect(screenFor('content://x/a b.zip', 'huawei-zip')).toBe('/settings/import-huawei?uri=content%3A%2F%2Fx%2Fa%20b.zip');
    expect(screenFor('content://x/1', 'fit')).toStartWith('/settings/import-fit?uri=');
    expect(screenFor('content://x/1', 'unknown')).toStartWith('/settings/import-fit?uri=');
  });
});
