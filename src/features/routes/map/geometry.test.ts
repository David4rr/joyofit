import { describe, expect, test } from 'bun:test';

import { boundsOf, lineCollection, lineFeature, pointCollection } from './geometry';

describe('boundsOf', () => {
  test('null for no points', () => {
    expect(boundsOf([])).toBeNull();
  });

  test('west, south, east, north of the points', () => {
    expect(
      boundsOf([
        { lat: -7.98, lon: 112.63 },
        { lat: -7.9, lon: 112.7 },
        { lat: -7.95, lon: 112.5 },
      ]),
    ).toEqual([112.5, -7.98, 112.7, -7.9]);
  });

  test('a single point or a thin line is widened so the camera has an area to fit', () => {
    const [west, south, east, north] = boundsOf([{ lat: 1, lon: 2 }]) as number[];
    expect(east - west).toBeCloseTo(0.004, 9);
    expect(north - south).toBeCloseTo(0.004, 9);
    expect((west + east) / 2).toBeCloseTo(2, 9);
    const line = boundsOf([{ lat: 0, lon: 10 }, { lat: 1, lon: 10 }]) as number[];
    expect(line[2] - line[0]).toBeCloseTo(0.004, 9);
    expect(line[3] - line[1]).toBeCloseTo(1, 9);
  });
});

describe('GeoJSON helpers', () => {
  test('coordinates are longitude first', () => {
    expect(lineFeature([{ lat: 1, lon: 2 }, { lat: 3, lon: 4 }]).geometry.coordinates).toEqual([[2, 1], [4, 3]]);
  });

  test('a line collection leaves out lines of fewer than two points', () => {
    const lines = [[{ lat: 1, lon: 2 }], [{ lat: 1, lon: 2 }, { lat: 3, lon: 4 }], []];
    expect(lineCollection(lines).features).toHaveLength(1);
  });

  test('a point collection has one feature per point and may be empty', () => {
    expect(pointCollection([{ lat: 1, lon: 2 }, { lat: 3, lon: 4 }]).features).toHaveLength(2);
    expect(pointCollection([])).toEqual({ type: 'FeatureCollection', features: [] });
  });
});
