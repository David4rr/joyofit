import { describe, expect, test } from 'bun:test';

import {
  TILE_SIZE,
  boundsOf,
  fitBounds,
  lonLatToTile,
  lonLatToWorld,
  tileBounds,
  tileCover,
  tileFetchZoom,
  tileLayoutZoom,
  worldToLonLat,
} from './tileMath';

const MONAS = [-6.1754, 106.8272] as const;

describe('projection', () => {
  test('world pixel round trip', () => {
    for (const zoom of [0, 5, 14.3, 17]) {
      for (const [lat, lon] of [MONAS, [51.5, -0.12], [-33.9, 151.2], [0, 0], [84, 179.9]] as const) {
        const w = lonLatToWorld(lat, lon, zoom);
        const [la, lo] = worldToLonLat(w.x, w.y, zoom);
        expect(la).toBeCloseTo(lat, 6);
        expect(lo).toBeCloseTo(lon, 6);
      }
    }
  });

  test('512 px convention: the world is 512 * 2^z wide, equator at the middle', () => {
    expect(lonLatToWorld(0, -180, 0)).toEqual({ x: 0, y: TILE_SIZE / 2 });
    const e = lonLatToWorld(0, 180, 3);
    expect(e.x).toBeCloseTo(TILE_SIZE * 8, 6);
    expect(e.y).toBeCloseTo(TILE_SIZE * 4, 6);
  });

  test('tile of Monas at z14 is 13053/8473 and its bounds contain it', () => {
    const t = lonLatToTile(MONAS[0], MONAS[1], 14);
    expect(t).toEqual({ x: 13053, y: 8473 });
    const b = tileBounds(14, t.x, t.y);
    expect(MONAS[0]).toBeGreaterThan(b.minLat);
    expect(MONAS[0]).toBeLessThan(b.maxLat);
    expect(MONAS[1]).toBeGreaterThan(b.minLon);
    expect(MONAS[1]).toBeLessThan(b.maxLon);
  });
});

describe('zoom levels', () => {
  test('layout zoom floors up to 17, network zoom stops at 14', () => {
    expect(tileLayoutZoom(12.9)).toBe(12);
    expect(tileLayoutZoom(16.4)).toBe(16);
    expect(tileLayoutZoom(30)).toBe(17);
    expect(tileFetchZoom(16.4)).toBe(14);
    expect(tileFetchZoom(9.99)).toBe(9);
  });
});

describe('fitBounds', () => {
  const route = [
    [-6.18, 106.82],
    [-6.17, 106.84],
  ] as const;
  const b = boundsOf([route])!;

  test('route lies inside the padded viewport', () => {
    const v = fitBounds(b, 390, 300, 20);
    const c = lonLatToWorld(v.lat, v.lon, v.zoom);
    for (const [lat, lon] of route) {
      const p = lonLatToWorld(lat, lon, v.zoom);
      const x = p.x - c.x + 195;
      const y = p.y - c.y + 150;
      expect(x).toBeGreaterThanOrEqual(20 - 0.01);
      expect(x).toBeLessThanOrEqual(370 + 0.01);
      expect(y).toBeGreaterThanOrEqual(20 - 0.01);
      expect(y).toBeLessThanOrEqual(280 + 0.01);
    }
    // tight: one of the two axes touches its padded edge
    const p0 = lonLatToWorld(route[0][0], route[0][1], v.zoom);
    const p1 = lonLatToWorld(route[1][0], route[1][1], v.zoom);
    const fillX = Math.abs(p1.x - p0.x) / 350;
    const fillY = Math.abs(p1.y - p0.y) / 260;
    expect(Math.max(fillX, fillY)).toBeCloseTo(1, 3);
  });

  test('single point and tiny routes cap the zoom', () => {
    const p = fitBounds(boundsOf([[[-6.2, 106.8]]])!, 300, 300, 20);
    expect(p.zoom).toBe(15);
    expect(p.lat).toBeCloseTo(-6.2, 6);
    const tiny = fitBounds(boundsOf([[[-6.2, 106.8], [-6.2000001, 106.8000001]]])!, 300, 300, 20);
    expect(tiny.zoom).toBe(16);
  });

  test('boundsOf ignores empty input', () => {
    expect(boundsOf([])).toBeNull();
    expect(boundsOf([[]])).toBeNull();
  });
});

describe('tileCover', () => {
  test('covers the whole viewport with correct placement', () => {
    const view = { lat: MONAS[0], lon: MONAS[1], zoom: 14.4 };
    const w = 390;
    const h = 420;
    const cover = tileCover(view, w, h);
    expect(cover.length).toBeGreaterThan(0);
    expect(cover.every((t) => t.z === 14)).toBe(true);
    const size = TILE_SIZE * 2 ** 0.4;
    expect(cover[0].size).toBeCloseTo(size, 6);
    const minL = Math.min(...cover.map((t) => t.left));
    const maxR = Math.max(...cover.map((t) => t.left + t.size));
    const minT = Math.min(...cover.map((t) => t.top));
    const maxB = Math.max(...cover.map((t) => t.top + t.size));
    expect(minL).toBeLessThanOrEqual(0);
    expect(maxR).toBeGreaterThanOrEqual(w);
    expect(minT).toBeLessThanOrEqual(0);
    expect(maxB).toBeGreaterThanOrEqual(h);
    // the tile holding the view centre is placed around (w/2, h/2)
    const mid = cover.find((t) => t.x === 13053 && t.y === 8473)!;
    expect(mid.left).toBeLessThan(w / 2);
    expect(mid.left + mid.size).toBeGreaterThan(w / 2);
  });

  test('a margin adds tiles and stays under 16 on a phone', () => {
    const view = { lat: MONAS[0], lon: MONAS[1], zoom: 14.9 };
    const plain = tileCover(view, 390, 420);
    const padded = tileCover(view, 390, 420, 117, 126);
    expect(padded.length).toBeGreaterThanOrEqual(plain.length);
    expect(padded.length).toBeLessThanOrEqual(16);
  });

  test('overzoom 16.x lays out zoom-16 tiles (sub-tiles of the z14 tile)', () => {
    const cover = tileCover({ lat: MONAS[0], lon: MONAS[1], zoom: 16.5 }, 390, 420);
    expect(cover.every((t) => t.z === 16)).toBe(true);
    expect(cover.length).toBeLessThanOrEqual(4);
  });

  test('wraps x across the antimeridian and drops rows beyond the poles', () => {
    const cover = tileCover({ lat: 0, lon: 179.99, zoom: 3 }, 800, 400);
    expect(cover.some((t) => t.ux >= 8 && t.x < 8)).toBe(true);
    expect(cover.every((t) => t.x >= 0 && t.x < 8)).toBe(true);
    const polar = tileCover({ lat: 85, lon: 0, zoom: 3 }, 800, 1200);
    expect(polar.every((t) => t.y >= 0)).toBe(true);
  });
});
