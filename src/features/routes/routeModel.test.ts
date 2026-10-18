import { describe, expect, test } from 'bun:test';

import {
  cleanRoutePoints,
  completeAltitudes,
  formatElevation,
  formatRouteDistance,
  haversineM,
  isUsableCoordinate,
  routeStats,
  simplifyRoute,
  type RoutePoint,
} from './routeModel';

const at = (lat: number, lon: number, alt: number | null = null): RoutePoint => ({ lat, lon, alt });
const withAlts = (alts: number[]): RoutePoint[] => alts.map((alt, i) => at(i * 0.0001, 0, alt));

describe('haversineM', () => {
  test('one degree of longitude on the equator', () => {
    expect(haversineM({ lat: 0, lon: 0 }, { lat: 0, lon: 1 })).toBeCloseTo(111195, -2);
  });
  test('zero for the same point', () => {
    expect(haversineM({ lat: -7.98, lon: 112.63 }, { lat: -7.98, lon: 112.63 })).toBe(0);
  });
});

describe('routeStats', () => {
  test('distance is the sum of the legs', () => {
    const stats = routeStats([at(0, 0), at(0, 0.001), at(0, 0.002)]);
    expect(stats.distanceM).toBeCloseTo(222.4, 0);
    expect(stats.hasAltitude).toBe(false);
    expect(stats.ascentM).toBeNull();
    expect(stats.descentM).toBeNull();
  });
  test('ascent and descent count changes past the noise threshold', () => {
    const stats = routeStats(withAlts([100, 105, 110, 104, 98]));
    expect(stats.hasAltitude).toBe(true);
    expect(stats.ascentM).toBe(10);
    expect(stats.descentM).toBe(12);
  });
  test('small wobbles count for nothing', () => {
    const stats = routeStats(withAlts([100, 101, 99.5, 100.8, 99.2, 100.4]));
    expect(stats.ascentM).toBe(0);
    expect(stats.descentM).toBe(0);
  });
  test('a slow climb adds up', () => {
    const stats = routeStats(withAlts([100, 100.5, 101, 101.5, 102, 102.5, 103, 103.5]));
    expect(stats.ascentM).toBe(3);
  });
  test('one missing altitude means no altitude profile', () => {
    const points = withAlts([100, 110, 120]);
    points[1].alt = null;
    const stats = routeStats(points);
    expect(stats.hasAltitude).toBe(false);
    expect(stats.ascentM).toBeNull();
  });
  test('fewer than two points have no distance', () => {
    expect(routeStats([]).distanceM).toBe(0);
    expect(routeStats([at(1, 1, 5)]).distanceM).toBe(0);
  });
});

describe('formatRouteDistance', () => {
  test('metres under a kilometre', () => {
    expect(formatRouteDistance(850)).toBe('850 m');
    expect(formatRouteDistance(0)).toBe('0 m');
    expect(formatRouteDistance(849.6)).toBe('850 m');
  });
  test('kilometres with a decimal comma', () => {
    expect(formatRouteDistance(12_400)).toBe('12,4 km');
    expect(formatRouteDistance(1000)).toBe('1,0 km');
    expect(formatRouteDistance(999.6)).toBe('1,0 km');
    expect(formatRouteDistance(105_250)).toBe('105,3 km');
  });
});

describe('formatElevation', () => {
  test('signed metres, a dash when unknown', () => {
    expect(formatElevation(320)).toBe('+320 m');
    expect(formatElevation(-80.4)).toBe('-80 m');
    expect(formatElevation(0)).toBe('0 m');
    expect(formatElevation(0.4)).toBe('0 m');
    expect(formatElevation(null)).toBe('-');
  });
});

describe('isUsableCoordinate', () => {
  test('rejects 0,0, out of range and not-a-number', () => {
    expect(isUsableCoordinate(0, 0)).toBe(false);
    expect(isUsableCoordinate(91, 10)).toBe(false);
    expect(isUsableCoordinate(10, 181)).toBe(false);
    expect(isUsableCoordinate(Number.NaN, 10)).toBe(false);
    expect(isUsableCoordinate(0, 10)).toBe(true);
    expect(isUsableCoordinate(-7.98, 112.63)).toBe(true);
  });
});

describe('cleanRoutePoints', () => {
  test('drops unusable points and consecutive repeats, keeps order', () => {
    const cleaned = cleanRoutePoints([
      at(1, 1, 10),
      at(1, 1, 11),
      at(0, 0),
      at(Number.NaN, 5),
      at(95, 5),
      at(2, 2, Number.NaN),
      at(1, 1),
    ]);
    expect(cleaned).toEqual([at(1, 1, 10), at(2, 2, null), at(1, 1, null)]);
  });
});

describe('completeAltitudes', () => {
  test('interpolates gaps and extends the ends', () => {
    expect(completeAltitudes([at(1, 1, 100), at(2, 2), at(3, 3, 120)]).map((p) => p.alt)).toEqual([100, 110, 120]);
    expect(completeAltitudes([at(1, 1), at(2, 2, 10), at(3, 3, 20)]).map((p) => p.alt)).toEqual([10, 10, 20]);
    expect(completeAltitudes([at(1, 1, 100), at(2, 2), at(3, 3, 110), at(4, 4), at(5, 5, 120)]).map((p) => p.alt)).toEqual([
      100, 105, 110, 115, 120,
    ]);
    expect(completeAltitudes([at(1, 1, 5), at(2, 2, 6), at(3, 3)]).map((p) => p.alt)).toEqual([5, 6, 6]);
  });
  test('drops every altitude when fewer than half are known', () => {
    expect(completeAltitudes([at(1, 1, 100), at(2, 2), at(3, 3), at(4, 4), at(5, 5)]).map((p) => p.alt)).toEqual([
      null, null, null, null, null,
    ]);
  });
  test('leaves a complete or empty list alone', () => {
    expect(completeAltitudes([at(1, 1, 1), at(2, 2, 2)])).toEqual([at(1, 1, 1), at(2, 2, 2)]);
    expect(completeAltitudes([])).toEqual([]);
  });
});

describe('simplifyRoute', () => {
  test('keeps the corner of a nearly straight line', () => {
    const line = Array.from({ length: 100 }, (_, i) => at(i * 0.0001, i === 50 ? 0.001 : 0, i));
    const out = simplifyRoute(line, 3);
    expect(out.map((p) => p.alt)).toEqual([0, 50, 99]);
    expect(out[1]).toBe(line[50]);
  });
  test('returns a copy when the line already fits', () => {
    const line = [at(1, 1), at(2, 2), at(3, 3)];
    const out = simplifyRoute(line, 3);
    expect(out).toEqual(line);
    expect(out).not.toBe(line);
  });
  test('respects the budget, keeps both ends and the order', () => {
    const wave = Array.from({ length: 1000 }, (_, i) => at(i * 0.00001, Math.sin(i / 20) * 0.001, i));
    const out = simplifyRoute(wave, 50);
    expect(out.length).toBeLessThanOrEqual(50);
    expect(out[0]).toBe(wave[0]);
    expect(out[out.length - 1]).toBe(wave[999]);
    const alts = out.map((p) => p.alt as number);
    expect([...alts].sort((a, b) => a - b)).toEqual(alts);
  });
  test('a loop that ends where it started keeps its shape', () => {
    const ring = Array.from({ length: 200 }, (_, i) => at(Math.sin((i / 199) * 2 * Math.PI) * 0.01, Math.cos((i / 199) * 2 * Math.PI) * 0.01 - 0.01 + 1));
    const out = simplifyRoute(ring, 12);
    expect(out.length).toBe(12);
    const far = Math.max(...out.map((p) => haversineM(p, ring[0])));
    expect(far).toBeGreaterThan(1000);
  });
});
