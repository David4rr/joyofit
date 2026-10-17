import { describe, expect, test } from 'bun:test';

import type { RoutePushResult } from '@/wear';

import { outcomeFromError, outcomeFromResult } from './pushOutcome';
import { copy } from './copy';
import type { RoutePoint } from './routeModel';
import { alternativeName, buildWatchRoute, MAX_WATCH_NAME_BYTES, MAX_WATCH_POINTS, truncateUtf8, utf8Length, watchRouteName } from './watchRoute';
import { workoutRouteDraft } from './workoutRoute';

const at = (lat: number, lon: number, alt: number | null = null): RoutePoint => ({ lat, lon, alt });
const wave = (n: number, alt: (i: number) => number | null): RoutePoint[] =>
  Array.from({ length: n }, (_, i) => at(-8 + i * 0.00001, 112 + Math.sin(i / 40) * 0.001, alt(i)));

describe('utf8', () => {
  test('length counts bytes', () => {
    expect(utf8Length('abc')).toBe(3);
    expect(utf8Length('h\u00e9')).toBe(3);
    expect(utf8Length('\u2013')).toBe(3);
    expect(utf8Length('\u{1F6B4}')).toBe(4);
  });
  test('truncation never splits a character and trims', () => {
    expect(truncateUtf8('h\u00e9llo', 2)).toBe('h');
    expect(truncateUtf8('h\u00e9llo', 3)).toBe('h\u00e9');
    expect(truncateUtf8('ab \u{1F6B4}', 4)).toBe('ab');
    expect(truncateUtf8('ab \u{1F6B4}', 7)).toBe('ab \u{1F6B4}');
  });
});

describe('watchRouteName', () => {
  test('at most 100 bytes', () => {
    const name = watchRouteName('\u00e9'.repeat(80));
    expect(utf8Length(name)).toBeLessThanOrEqual(MAX_WATCH_NAME_BYTES);
    expect(name).toBe('\u00e9'.repeat(50));
  });
  test('a blank name gets the fallback', () => {
    expect(watchRouteName('   ')).toBe(copy.push.watchFallbackName);
  });
});

describe('buildWatchRoute', () => {
  test('flat lat, lon, alt triples with altitude when every point has one', () => {
    const route = buildWatchRoute(' Lari ', [at(-8, 112, 10), at(-8.001, 112.001, 12.5)]);
    expect(route).toEqual({ name: 'Lari', points: [-8, 112, 10, -8.001, 112.001, 12.5], hasAltitude: true, durationSec: 0 });
  });
  test('altitude is off and zero when one point lacks it', () => {
    const route = buildWatchRoute('Lari', [at(-8, 112, 10), at(-8.001, 112.001), at(-8.002, 112.002, 14)]);
    expect(route.hasAltitude).toBe(false);
    expect(route.points).toEqual([-8, 112, 0, -8.001, 112.001, 0, -8.002, 112.002, 0]);
  });
  test('a long route is cut to 3000 points, ends kept', () => {
    const points = wave(9000, (i) => 100 + (i % 5));
    const route = buildWatchRoute('Panjang', points);
    expect(route.points.length).toBe(MAX_WATCH_POINTS * 3);
    expect(route.points.length % 3).toBe(0);
    expect(route.points.slice(0, 3)).toEqual([points[0].lat, points[0].lon, 100]);
    expect(route.points.slice(-3)).toEqual([points[8999].lat, points[8999].lon, points[8999].alt as number]);
    expect(route.hasAltitude).toBe(true);
  });
  test('refuses fewer than two points', () => {
    expect(() => buildWatchRoute('x', [at(1, 1, 1)])).toThrow();
  });
});

describe('alternativeName', () => {
  test('adds and bumps a counter', () => {
    expect(alternativeName('Lari')).toBe('Lari (2)');
    expect(alternativeName('Lari (2)')).toBe('Lari (3)');
    expect(alternativeName('Lari (9) ')).toBe('Lari (10)');
    expect(alternativeName('Bromo (utara)')).toBe('Bromo (utara) (2)');
  });
  test('stays within the watch limit', () => {
    expect(utf8Length(alternativeName('x'.repeat(100)))).toBeLessThanOrEqual(MAX_WATCH_NAME_BYTES);
    expect(alternativeName('x'.repeat(100)).endsWith(' (2)')).toBe(true);
  });
});

function coded(code: string, message: string): Error {
  return Object.assign(new Error(message), { code });
}

describe('outcomeFromError', () => {
  test('every documented code has its own Indonesian copy', () => {
    expect(outcomeFromError(coded('ERR_NOT_CONNECTED', 'x'))).toEqual({ kind: 'failed', message: copy.push.errors.ERR_NOT_CONNECTED, canRename: false });
    expect(outcomeFromError(coded('ERR_UNSUPPORTED', 'x'))).toMatchObject({ kind: 'failed', message: copy.push.errors.ERR_UNSUPPORTED });
    expect(outcomeFromError(coded('ERR_ROUTE_FULL', 'x'))).toMatchObject({ message: copy.push.errors.ERR_ROUTE_FULL });
    expect(outcomeFromError(coded('ERR_TIMEOUT', 'x'))).toMatchObject({ message: copy.push.errors.ERR_TIMEOUT });
    expect(outcomeFromError(coded('ERR_BUSY', 'x'))).toMatchObject({ message: copy.push.errors.ERR_BUSY });
    expect(outcomeFromError(coded('ERR_DISCONNECTED', 'x'))).toMatchObject({ message: copy.push.errors.ERR_DISCONNECTED });
  });
  test('a full list says to delete a route on the watch', () => {
    const outcome = outcomeFromError(coded('ERR_ROUTE_FULL', 'x'));
    expect(outcome.kind === 'failed' && outcome.message).toContain('penuh');
    expect(outcome.kind === 'failed' && outcome.message).toContain('Hapus rute lama');
  });
  test('a name the watch cannot take offers a rename', () => {
    expect(outcomeFromError(coded('ERR_ROUTE_NAME', 'x'))).toMatchObject({ kind: 'failed', canRename: true });
  });
  test('the watch\'s own message is kept for a rejected upload and an invalid route', () => {
    const rejected = outcomeFromError(coded('ERR_UPLOAD_REJECTED', 'watch said 7'));
    expect(rejected.kind === 'failed' && rejected.message).toContain('watch said 7');
    const invalid = outcomeFromError(coded('ERR_INVALID_ARGUMENT', 'route has 1 point'));
    expect(invalid.kind === 'failed' && invalid.message).toContain('route has 1 point');
  });
  test('an unknown error shows its message and code, a plain error its message', () => {
    expect(outcomeFromError(coded('ERR_SOMETHING', 'boom'))).toEqual({ kind: 'failed', message: copy.push.failedUnknown('boom', 'ERR_SOMETHING'), canRename: false });
    const plain = outcomeFromError(new Error('boom'));
    expect(plain.kind === 'failed' && plain.message).toContain('boom');
    const text = outcomeFromError('just a string');
    expect(text.kind === 'failed' && text.message).toContain('just a string');
  });
});

const result = (over: Partial<RoutePushResult>): RoutePushResult => ({
  ok: true,
  alreadyOnWatch: false,
  handshakeCode: 1,
  maxPoints: 500,
  version: 2,
  sentPoints: 480,
  bytes: 5000,
  uploadStatus: 1,
  answerCode: 1,
  ...over,
});

describe('outcomeFromResult', () => {
  test('saved and confirmed', () => {
    expect(outcomeFromResult(result({}), 3000)).toEqual({ kind: 'sent', sentPoints: 480, totalPoints: 3000, confirmed: true });
  });
  test('saved without the final answer is not confirmed', () => {
    expect(outcomeFromResult(result({ answerCode: null }), 3000)).toMatchObject({ kind: 'sent', confirmed: false });
  });
  test('already on the watch', () => {
    expect(outcomeFromResult(result({ alreadyOnWatch: true, handshakeCode: 3, version: 0, sentPoints: 0, answerCode: null }), 10)).toEqual({ kind: 'already' });
  });
  test('refused', () => {
    expect(outcomeFromResult(result({ ok: false, answerCode: 9 }), 10)).toEqual({ kind: 'failed', message: copy.push.notAccepted(9), canRename: false });
    expect(outcomeFromResult(result({ ok: false, handshakeCode: 2 }), 10)).toMatchObject({ message: copy.push.errors.ERR_ROUTE_FULL });
    expect(outcomeFromResult(result({ ok: false, handshakeCode: 5 }), 10)).toMatchObject({ canRename: true });
  });
});

describe('workoutRouteDraft', () => {
  test('keeps the GPS rows only and fills a missing altitude', () => {
    const draft = workoutRouteDraft('Lari 12 Okt 2026', [
      { lat: null, lon: null, alt: null },
      { lat: -8, lon: 112, alt: 100 },
      { lat: -8.001, lon: 112, alt: null },
      { lat: null, lon: null, alt: 50 },
      { lat: -8.002, lon: 112, alt: 120 },
    ]);
    expect(draft).toEqual({
      name: 'Lari 12 Okt 2026',
      source: 'workout',
      points: [
        { lat: -8, lon: 112, alt: 100 },
        { lat: -8.001, lon: 112, alt: 110 },
        { lat: -8.002, lon: 112, alt: 120 },
      ],
    });
  });
  test('null when there is no line', () => {
    expect(workoutRouteDraft('x', [{ lat: -8, lon: 112, alt: 1 }, { lat: -8, lon: 112, alt: 2 }, { lat: 0, lon: 0, alt: 3 }])).toBeNull();
    expect(workoutRouteDraft('x', [])).toBeNull();
  });
});
