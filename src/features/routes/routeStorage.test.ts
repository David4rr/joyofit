import { describe, expect, test } from 'bun:test';

import { MAX_STORED_POINTS, routeStats, type RoutePoint } from './routeModel';
import {
  buildRoute,
  cleanRouteName,
  decodePoints,
  decodeThumb,
  encodePoints,
  encodeThumb,
  isRouteId,
  newRouteId,
  parseMeta,
  RouteDraftError,
  THUMB_POINTS,
} from './routeStorage';

const at = (lat: number, lon: number, alt: number | null = null): RoutePoint => ({ lat, lon, alt });
const curve = (n: number): RoutePoint[] => Array.from({ length: n }, (_, i) => at(-8 + i * 0.00001, 112 + Math.sin(i / 50) * 0.001, 500 + (i % 7)));

describe('ids', () => {
  test('are file-name safe and sortable by time', () => {
    const id = newRouteId(1_792_000_000_000, () => 0.5);
    expect(isRouteId(id)).toBe(true);
    expect(newRouteId(0, () => 0)).toBe('0-000000');
    expect(newRouteId(1_800_000_000_000) > newRouteId(1_700_000_000_000)).toBe(true);
  });
  test('anything that could leave the folder is refused', () => {
    for (const bad of ['', '../x', 'a/b', 'A', 'a b', '-a', 'a-', 'a--b', 'x'.repeat(41), 'a.json', 5, null, undefined]) {
      expect(isRouteId(bad)).toBe(false);
    }
    expect(isRouteId('mgh2k1-0a9z8y')).toBe(true);
  });
});

describe('cleanRouteName', () => {
  test('collapses whitespace and trims', () => {
    expect(cleanRouteName('  Lari \n\t sore  ')).toBe('Lari sore');
    expect(cleanRouteName('   ')).toBe('');
  });
  test('at most 100 characters, never half an emoji', () => {
    const name = cleanRouteName(`${'a'.repeat(99)}\u{1F600}\u{1F600}`);
    expect(Array.from(name)).toHaveLength(100);
    expect(name.endsWith('\u{1F600}')).toBe(true);
  });
});

describe('points on disk', () => {
  test('round trip with the stored precision', () => {
    const encoded = encodePoints([at(-7.98251234567, 112.63041234567, 445.26), at(1, 2, null)]);
    expect(encoded).toEqual([-7.982512, 112.630412, 445.3, 1, 2, null]);
    expect(decodePoints({ v: 1, pts: encoded })).toEqual([at(-7.982512, 112.630412, 445.3), at(1, 2, null)]);
  });
  test('damaged files are refused', () => {
    expect(decodePoints(null)).toBeNull();
    expect(decodePoints({ pts: [1, 2] })).toBeNull();
    expect(decodePoints({ pts: [1, 'x', 3] })).toBeNull();
    expect(decodePoints({})).toBeNull();
  });
  test('thumbnail points round trip', () => {
    const flat = encodeThumb([{ lat: -7.123456789, lon: 112.987654321 }]);
    expect(flat).toEqual([-7.12346, 112.98765]);
    expect(decodeThumb(flat)).toEqual([{ lat: -7.12346, lon: 112.98765 }]);
  });
});

describe('parseMeta', () => {
  const route = {
    id: 'abc-123',
    name: 'Lari',
    source: 'gpx',
    createdAt: 1,
    distanceM: 5000,
    ascentM: 20,
    descentM: null,
    pointCount: 100,
    hasAltitude: true,
    lastSentAt: null,
  };
  test('reads what buildRoute writes', () => {
    const built = buildRoute({ name: 'Lari', source: 'gpx', points: curve(300) }, 'abc-123', 5, 'x', 'y');
    expect(parseMeta(JSON.parse(JSON.stringify(built.meta)))).toEqual(built.meta);
  });
  test('accepts a complete record, nulling bad optional numbers', () => {
    const meta = parseMeta({ v: 1, route: { ...route, ascentM: 'x', lastSentAt: Number.NaN }, thumb: [1, 'a', 2] });
    expect(meta?.route.ascentM).toBeNull();
    expect(meta?.route.lastSentAt).toBeNull();
    expect(meta?.thumb).toEqual([1, 2]);
  });
  test('refuses damaged records', () => {
    expect(parseMeta(null)).toBeNull();
    expect(parseMeta({ v: 2, route })).toBeNull();
    expect(parseMeta({ v: 1, route: { ...route, id: '../x' } })).toBeNull();
    expect(parseMeta({ v: 1, route: { ...route, source: 'kml' } })).toBeNull();
    expect(parseMeta({ v: 1, route: { ...route, name: 5 } })).toBeNull();
    expect(parseMeta({ v: 1, route: { ...route, distanceM: undefined } })).toBeNull();
  });
});

describe('buildRoute', () => {
  test('stats come from the cleaned line, the name is cleaned', () => {
    const points = [at(-8, 112, 100), at(-8, 112, 101), at(0, 0), at(-8.001, 112, 110), at(-8.002, 112, 105)];
    const { meta, points: stored } = buildRoute({ name: '  Rute   A ', source: 'drawn', points }, 'id-1', 42, 'x', 'y');
    expect(stored).toHaveLength(3);
    expect(meta.route).toMatchObject({
      id: 'id-1',
      name: 'Rute A',
      source: 'drawn',
      createdAt: 42,
      pointCount: 3,
      hasAltitude: true,
      lastSentAt: null,
    });
    expect(meta.route.distanceM).toBe(Math.round(routeStats(stored).distanceM));
    expect(meta.route.ascentM).toBe(10);
    expect(meta.route.descentM).toBe(5);
  });
  test('an empty name falls back', () => {
    expect(buildRoute({ name: '   ', source: 'gpx', points: curve(10) }, 'id-2', 1, 'x', 'Rute 1 Jan').meta.route.name).toBe('Rute 1 Jan');
  });
  test('a long line is kept at 5000 points, ends included, distance from the whole line', () => {
    const points = curve(12_000);
    const { meta, points: stored } = buildRoute({ name: 'Panjang', source: 'workout', points }, 'id-3', 1, 'x', 'y');
    expect(stored.length).toBeLessThanOrEqual(MAX_STORED_POINTS);
    expect(stored.length).toBeGreaterThan(1000);
    expect(meta.route.pointCount).toBe(stored.length);
    expect(stored[0]).toEqual(points[0]);
    expect(stored[stored.length - 1]).toEqual(points[11_999]);
    expect(meta.route.distanceM).toBe(Math.round(routeStats(points).distanceM));
    expect(meta.thumb.length).toBeLessThanOrEqual(THUMB_POINTS * 2);
  });
  test('fewer than two usable points is an error with the given message', () => {
    expect(() => buildRoute({ name: 'x', source: 'drawn', points: [at(1, 1), at(1, 1), at(0, 0)] }, 'id-4', 1, 'terlalu sedikit', 'y')).toThrow('terlalu sedikit');
    expect(() => buildRoute({ name: 'x', source: 'drawn', points: [] }, 'id-4', 1, 'm', 'y')).toThrow(RouteDraftError);
  });
});
