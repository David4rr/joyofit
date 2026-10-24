import { describe, expect, test } from 'bun:test';

import { appendTrail, TRAIL_MAX_POINTS } from './trail';

describe('appendTrail', () => {
  test('the first point starts the trail', () => {
    expect(appendTrail([], { lat: -6.2, lon: 106.8 })).toEqual([{ lat: -6.2, lon: 106.8 }]);
  });
  test('jitter returns the same array', () => {
    const trail = [{ lat: -6.2, lon: 106.8 }];
    expect(appendTrail(trail, { lat: -6.200001, lon: 106.800001 })).toBe(trail);
  });
  test('a step of about 11 m is kept', () => {
    expect(appendTrail([{ lat: -6.2, lon: 106.8 }], { lat: -6.2001, lon: 106.8 }).length).toBe(2);
  });
  test('stays under the cap and keeps the newest point', () => {
    let trail: readonly { lat: number; lon: number }[] = [];
    for (let i = 0; i < TRAIL_MAX_POINTS + 50; i += 1) trail = appendTrail(trail, { lat: -6.2 - i * 0.001, lon: 106.8 });
    expect(trail.length).toBeLessThanOrEqual(TRAIL_MAX_POINTS);
    expect(trail[trail.length - 1].lat).toBeCloseTo(-6.2 - (TRAIL_MAX_POINTS + 49) * 0.001, 6);
  });
});
