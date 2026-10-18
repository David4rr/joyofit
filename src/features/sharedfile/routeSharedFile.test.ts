import { describe, expect, test } from 'bun:test';

import { GARMIN_GPX, STRAVA_GPX, COURSE_TCX, NOT_A_ROUTE_XML } from '../routes/routeFixtures';
import { baseNameOf, classifyByName, extensionOf, screenFor, SNIFF_BYTES, sniffKind } from './routeSharedFile';

const zip = Uint8Array.from([0x50, 0x4b, 0x03, 0x04, 0, 0, 0, 0, 0, 0, 0, 0]);
const fit = Uint8Array.from([14, 0x20, 0x98, 0, 0, 0, 0, 0, 0x2e, 0x46, 0x49, 0x54]);
const head = (text: string, bom = false) => {
  const bytes = new TextEncoder().encode(text).slice(0, SNIFF_BYTES);
  return bom ? Uint8Array.from([0xef, 0xbb, 0xbf, ...bytes]) : bytes;
};

describe('extensionOf', () => {
  test('reads the name from a document URI', () => {
    expect(extensionOf('content://x/document/primary%3ADownload%2FHealth%20data.ZIP')).toBe('zip');
    expect(extensionOf('file:///sdcard/a/b.fit?x=1')).toBe('fit');
  });
  test('none when there is no extension', () => {
    expect(extensionOf('content://com.android.providers.downloads.documents/document/msf%3A1234')).toBeNull();
  });
});

describe('baseNameOf', () => {
  test('the file name without its extension', () => {
    expect(baseNameOf('content://x/document/primary%3ADownload%2FLari%20pagi.gpx')).toBe('Lari pagi');
    expect(baseNameOf('Morning Run.tcx')).toBe('Morning Run');
    expect(baseNameOf('file:///cache/a.b.gpx?x=1')).toBe('a.b');
  });
  test('null when the name says nothing', () => {
    expect(baseNameOf('content://com.android.providers.downloads.documents/document/msf%3A1234')).toBeNull();
    expect(baseNameOf('content://x/')).toBeNull();
    expect(baseNameOf('.gpx')).toBeNull();
  });
});

describe('classifyByName', () => {
  test('extension wins', () => {
    expect(classifyByName('content://x/a.zip', 'application/octet-stream')).toBe('huawei-zip');
    expect(classifyByName('content://x/ride.FIT', 'application/zip')).toBe('fit');
    expect(classifyByName('content://x/lari.gpx', 'application/octet-stream')).toBe('gpx');
    expect(classifyByName('file:///cache/Morning%20Run.GPX')).toBe('gpx');
    expect(classifyByName('content://x/course.tcx', 'application/xml')).toBe('tcx');
  });
  test('MIME type when the name has no extension', () => {
    expect(classifyByName('content://x/1', 'application/x-zip-compressed')).toBe('huawei-zip');
    expect(classifyByName('content://x/1', 'application/zip')).toBe('huawei-zip');
    expect(classifyByName('content://x/1', 'application/vnd.ant.fit')).toBe('fit');
    expect(classifyByName('content://x/1', 'application/gpx+xml')).toBe('gpx');
    expect(classifyByName('content://x/1', 'application/vnd.garmin.tcx+xml')).toBe('tcx');
  });
  test('unknown for octet-stream without extension', () => {
    expect(classifyByName('content://x/1', 'application/octet-stream')).toBe('unknown');
    expect(classifyByName('content://x/1', 'application/xml')).toBe('unknown');
    expect(classifyByName('content://x/1', 'text/xml')).toBe('unknown');
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
  test('GPX and TCX by their root element', () => {
    expect(sniffKind(head(STRAVA_GPX))).toBe('gpx');
    expect(sniffKind(head(GARMIN_GPX))).toBe('gpx');
    expect(sniffKind(head(COURSE_TCX))).toBe('tcx');
    expect(sniffKind(head(`<gpx version="1.1"></gpx>`))).toBe('gpx');
    expect(sniffKind(head(`  \n<TrainingCenterDatabase xmlns="x"/>`))).toBe('tcx');
  });
  test('a byte-order mark and an XML declaration do not matter', () => {
    expect(sniffKind(head(STRAVA_GPX, true))).toBe('gpx');
    expect(sniffKind(head(COURSE_TCX, true))).toBe('tcx');
  });
  test('other XML and text that merely mentions gpx are unknown', () => {
    expect(sniffKind(head(NOT_A_ROUTE_XML))).toBe('unknown');
    expect(sniffKind(head('hello <gpx> world'))).toBe('unknown');
    expect(sniffKind(head('{"a":"<gpx>"}'))).toBe('unknown');
  });
});

describe('screenFor', () => {
  test('ZIP to the Huawei import, FIT and unknown to the FIT import, GPX and TCX to the route import, uri encoded', () => {
    expect(screenFor('content://x/a b.zip', 'huawei-zip')).toBe('/settings/import-huawei?uri=content%3A%2F%2Fx%2Fa%20b.zip');
    expect(screenFor('content://x/1', 'fit')).toStartWith('/settings/import-fit?uri=');
    expect(screenFor('content://x/1', 'unknown')).toStartWith('/settings/import-fit?uri=');
    expect(screenFor('content://x/a b.gpx', 'gpx')).toBe('/routes/import?uri=content%3A%2F%2Fx%2Fa%20b.gpx');
    expect(screenFor('content://x/1', 'tcx')).toStartWith('/routes/import?uri=');
  });
});
