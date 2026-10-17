import { describe, expect, test } from 'bun:test';

import {
  addElevation,
  elevationUrl,
  interpolateAltitudes,
  parseElevations,
  sampleIndices,
} from './elevationClient';
import type { FetchLike } from './http';
import type { RoutePoint } from '@/features/routes/routeModel';

/** `count` points along the equator, 0.001 degrees (about 111 m) apart. */
function eastward(count: number): RoutePoint[] {
  return Array.from({ length: count }, (_, i) => ({ lat: 0, lon: i * 0.001, alt: null }));
}

/** An elevation service where the altitude of a point is its longitude times 1000 (so point i is at i metres). */
function serviceByLongitude(calls: number[] = []): FetchLike {
  return async (url) => {
    const query = new URL(url).searchParams;
    const longitudes = (query.get('longitude') ?? '').split(',').map(Number);
    calls.push(longitudes.length);
    return { ok: true, status: 200, json: async () => ({ elevation: longitudes.map((lon) => Math.round(lon * 1000)) }) };
  };
}

describe('sampleIndices', () => {
  test('every point when there are no more than the limit', () => {
    expect(sampleIndices(eastward(5), 200)).toEqual([0, 1, 2, 3, 4]);
    expect(sampleIndices(eastward(200), 200)).toHaveLength(200);
  });

  test('at most the limit, first and last included, increasing, spread by distance', () => {
    const indices = sampleIndices(eastward(1001), 11);
    expect(indices).toHaveLength(11);
    expect(indices[0]).toBe(0);
    expect(indices[10]).toBe(1000);
    expect(indices).toEqual([0, 100, 200, 300, 400, 500, 600, 700, 800, 900, 1000]);
  });

  test('a line with uneven point spacing is sampled by distance, not by index', () => {
    // 100 close points, then one far point, then 100 close points again: index spacing would sample the dense ends only.
    const dense = Array.from({ length: 100 }, (_, i) => ({ lat: 0, lon: i * 0.0001, alt: null }));
    const far = { lat: 0, lon: 1, alt: null };
    const tail = Array.from({ length: 100 }, (_, i) => ({ lat: 0, lon: 1 + i * 0.0001, alt: null }));
    const indices = sampleIndices([...dense, far, ...tail], 5);
    expect(indices[0]).toBe(0);
    expect(indices[indices.length - 1]).toBe(200);
    expect(indices.length).toBeLessThanOrEqual(5);
    expect(indices).toEqual([...indices].sort((a, b) => a - b));
    expect(new Set(indices).size).toBe(indices.length);
  });

  test('points that all share one place are sampled by index', () => {
    const still = Array.from({ length: 50 }, () => ({ lat: 1, lon: 1, alt: null }));
    const indices = sampleIndices(still, 5);
    expect(indices[0]).toBe(0);
    expect(indices[indices.length - 1]).toBe(49);
    expect(indices.length).toBeLessThanOrEqual(5);
  });
});

describe('elevationUrl', () => {
  test('lists latitudes and longitudes with 5 decimals', () => {
    expect(elevationUrl([{ lat: -7.980001, lon: 112.63 }, { lat: -7.97, lon: 112.64 }])).toBe(
      'https://api.open-meteo.com/v1/elevation?latitude=-7.98000,-7.97000&longitude=112.63000,112.64000',
    );
  });
});

describe('parseElevations', () => {
  test('one finite number per point', () => {
    expect(parseElevations({ elevation: [1, 2.5] }, 2)).toEqual([1, 2.5]);
  });

  test('anything else is a parse error', () => {
    for (const body of [null, {}, { elevation: [1] }, { elevation: [1, null] }, { elevation: [1, 'x'] }, { elevation: 5 }]) {
      expect(() => parseElevations(body, 2)).toThrow(expect.objectContaining({ kind: 'parse' }));
    }
  });
});

describe('interpolateAltitudes', () => {
  test('sampled points keep their altitude, the others are linear by distance', () => {
    const points = eastward(5);
    const result = interpolateAltitudes(points, [0, 4], [100, 200]);
    expect(result.map((p) => p.alt)).toEqual([100, 125, 150, 175, 200]);
  });

  test('works across several sampled points', () => {
    const points = eastward(5);
    const result = interpolateAltitudes(points, [0, 2, 4], [0, 100, 0]);
    expect(result.map((p) => p.alt)).toEqual([0, 50, 100, 50, 0]);
  });

  test('keeps latitude and longitude and does not change the input', () => {
    const points = eastward(3);
    const result = interpolateAltitudes(points, [0, 2], [10, 20]);
    expect(result.map((p) => [p.lat, p.lon])).toEqual(points.map((p) => [p.lat, p.lon]));
    expect(points.every((p) => p.alt === null)).toBe(true);
  });
});

describe('addElevation', () => {
  test('fills every point from one request for a short line', async () => {
    const batches: number[] = [];
    const { points, ok } = await addElevation(eastward(10), { fetch: serviceByLongitude(batches) });
    expect(ok).toBe(true);
    expect(batches).toEqual([10]);
    expect(points.map((p) => p.alt)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  test('samples at most 200 points, 100 per request, and interpolates the rest', async () => {
    const batches: number[] = [];
    const line = eastward(1001);
    const { points, ok } = await addElevation(line, { fetch: serviceByLongitude(batches) });
    expect(ok).toBe(true);
    expect(batches).toEqual([100, 100]);
    expect(points).toHaveLength(1001);
    expect(points.every((p) => p.alt !== null)).toBe(true);
    // The service says point i is i metres high, so the interpolation is within a metre of that everywhere.
    for (let i = 0; i < points.length; i += 37) expect(Math.abs((points[i].alt as number) - i)).toBeLessThan(1.01);
  });

  test('sends the extra headers', async () => {
    let seen: Record<string, string> = {};
    const fetch: FetchLike = async (url, init) => {
      seen = init.headers;
      return serviceByLongitude()(url, init);
    };
    await addElevation(eastward(3), { fetch, headers: { 'User-Agent': 'JoyoFit/1.0 (https://joyofit.app)' } });
    expect(seen['User-Agent']).toBe('JoyoFit/1.0 (https://joyofit.app)');
  });

  test('returns the points unchanged when the service fails', async () => {
    const line = eastward(10);
    const { points, ok } = await addElevation(line, {
      fetch: async () => ({ ok: false, status: 429, json: async () => ({}) }),
    });
    expect(ok).toBe(false);
    expect(points).toEqual(line);
  });

  test('returns the points unchanged when the answer does not match the request', async () => {
    const line = eastward(10);
    const { points, ok } = await addElevation(line, {
      fetch: async () => ({ ok: true, status: 200, json: async () => ({ elevation: [1, 2] }) }),
    });
    expect(ok).toBe(false);
    expect(points).toEqual(line);
  });

  test('returns the points unchanged when the second batch fails', async () => {
    let calls = 0;
    const line = eastward(300);
    const { points, ok } = await addElevation(line, {
      fetch: async (url, init) => {
        calls += 1;
        if (calls === 2) throw new TypeError('Network request failed');
        return serviceByLongitude()(url, init);
      },
    });
    expect(ok).toBe(false);
    expect(points.every((p) => p.alt === null)).toBe(true);
  });

  test('does not call the service for one point, or when every point already has an altitude', async () => {
    let calls = 0;
    const fetch: FetchLike = async (url, init) => {
      calls += 1;
      return serviceByLongitude()(url, init);
    };
    expect((await addElevation(eastward(1), { fetch })).ok).toBe(false);
    const withAlt = eastward(3).map((p) => ({ ...p, alt: 5 }));
    const result = await addElevation(withAlt, { fetch });
    expect(result.ok).toBe(true);
    expect(result.points).toEqual(withAlt);
    expect(calls).toBe(0);
  });

  test('a caller abort returns the points unchanged', async () => {
    const controller = new AbortController();
    controller.abort();
    const line = eastward(5);
    const { points, ok } = await addElevation(line, { fetch: serviceByLongitude(), signal: controller.signal });
    expect(ok).toBe(false);
    expect(points).toEqual(line);
  });
});
