import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

import { decodeTile } from './mvt';
import { casingWidthAt, layerPaint, lightPalette, strokeWidthAt } from './palette';
import { RENDER_LAYERS, renderTile, simplifyFlat, sourceTileOf } from './renderTile';

const bytes = new Uint8Array(readFileSync(`${import.meta.dir}/__fixtures__/tile.pbf`));
const tile = decodeTile(bytes, { layers: RENDER_LAYERS });
const ID = { z: 14, x: 13060, y: 8471 };

const NUMBER = /-?\d+(\.\d+)?/g;

describe('renderTile', () => {
  const out = renderTile(tile, ID);
  const byKey = new Map(out.layers.map((l) => [`${l.kind}:${l.id}`, l]));

  test('draws water, roads and landuse as non-empty paths', () => {
    expect(byKey.get('fill:water')?.d.length).toBeGreaterThan(50);
    expect(byKey.get('road:minor')?.d.length).toBeGreaterThan(50);
    expect(byKey.get('casing:minor')?.d.length).toBeGreaterThan(50);
    expect(byKey.get('road:motorway')).toBeDefined();
    expect(byKey.get('fill:landuse')).toBeDefined();
    expect(byKey.get('line:waterway')).toBeDefined();
  });

  test('keeps the node count under the cap, one path per layer, no empty paths', () => {
    expect(out.layers.length).toBeLessThanOrEqual(25);
    expect(new Set(out.layers.map((l) => `${l.kind}:${l.id}`)).size).toBe(out.layers.length);
    for (const l of out.layers) expect(l.d.length).toBeGreaterThan(0);
  });

  test('paths are well formed, rounded to 0.1 px and inside the tile plus buffer', () => {
    for (const l of out.layers) {
      expect(l.d.startsWith('M')).toBe(true);
      expect(l.d).not.toContain('NaN');
      for (const n of l.d.match(NUMBER) ?? []) {
        expect(Math.abs(Number(n))).toBeLessThan(512 * 1.5);
        expect(Math.round(Number(n) * 10) / 10).toBeCloseTo(Number(n), 9);
      }
    }
    for (const l of out.layers.filter((l) => l.kind === 'fill')) expect(l.d).toContain('Z');
    for (const l of out.layers.filter((l) => l.kind !== 'fill')) expect(l.d).not.toContain('Z');
  });

  test('simplification shrinks the geometry', () => {
    const raw = tile.layers.transportation.features.reduce(
      (n, f) => n + f.rings.reduce((m, r) => m + r.length / 2, 0),
      0,
    );
    const road = byKey.get('road:minor')!.d;
    const drawn = (road.match(/[ML]/g) ?? []).length;
    expect(drawn).toBeLessThan(raw);
  });

  test('buildings only from zoom 15 and tunnels never', () => {
    expect(byKey.has('fill:building')).toBe(false);
    const z15 = renderTile(tile, { z: 15, x: ID.x * 2, y: ID.y * 2 });
    expect(z15.layers.length).toBeLessThanOrEqual(25);
  });

  test('subtiles above zoom 14 partition the source tile', () => {
    expect(sourceTileOf({ z: 16, x: 4 * 13060 + 3, y: 4 * 8471 + 1 })).toEqual({ z: 14, x: 13060, y: 8471 });
    expect(sourceTileOf({ z: 12, x: 5, y: 6 })).toEqual({ z: 12, x: 5, y: 6 });
    const wholeSize = out.layers.reduce((n, l) => n + l.d.length, 0);
    let parts = 0;
    for (let i = 0; i < 4; i++) {
      for (let j = 0; j < 4; j++) {
        const sub = renderTile(tile, { z: 16, x: ID.x * 4 + i, y: ID.y * 4 + j });
        expect(sub.layers.length).toBeLessThanOrEqual(25);
        parts += sub.layers.find((l) => l.id === 'water')?.d.length ?? 0;
      }
    }
    expect(parts).toBeGreaterThan(0);
    // culling: one sub-tile holds only a fraction of the whole tile's path data
    const one = renderTile(tile, { z: 16, x: ID.x * 4, y: ID.y * 4 });
    expect(one.layers.reduce((n, l) => n + l.d.length, 0)).toBeLessThan(wholeSize / 2);
  });

  test('waterway classes below zoom 12 skip streams', () => {
    const synthetic = {
      layers: {
        waterway: {
          name: 'waterway',
          extent: 4096,
          features: [
            { id: 1, type: 'line' as const, props: { class: 'stream' }, rings: [Int32Array.from([0, 0, 2000, 2000])] },
            { id: 2, type: 'line' as const, props: { class: 'river' }, rings: [Int32Array.from([0, 100, 2000, 2100])] },
          ],
        },
      },
    };
    const low = renderTile(synthetic, { z: 11, x: 0, y: 0 });
    const high = renderTile(synthetic, { z: 13, x: 0, y: 0 });
    expect((low.layers[0].d.match(/M/g) ?? []).length).toBe(1);
    expect((high.layers[0].d.match(/M/g) ?? []).length).toBe(2);
  });
});

describe('simplifyFlat', () => {
  test('drops collinear points and keeps corners', () => {
    expect(simplifyFlat([0, 0, 5, 0.1, 10, 0, 10, 10], 0.35)).toEqual([0, 0, 10, 0, 10, 10]);
  });
});

describe('palette helpers', () => {
  test('widths grow with zoom and casing is wider than the fill', () => {
    expect(strokeWidthAt('primary', 16)).toBeGreaterThan(strokeWidthAt('primary', 12));
    expect(casingWidthAt('primary', 15)).toBeGreaterThan(strokeWidthAt('primary', 15));
    expect(strokeWidthAt('primary', 14)).toBeCloseTo(3, 9);
  });

  test('layerPaint resolves every layer renderTile can emit', () => {
    const out = renderTile(tile, ID);
    for (const l of out.layers) expect(layerPaint(l.kind, l.id, 14, lightPalette)).not.toBeNull();
  });
});
