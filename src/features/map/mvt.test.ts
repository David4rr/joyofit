import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

import { decodeTile } from './mvt';

const fixture = new Uint8Array(readFileSync(`${import.meta.dir}/__fixtures__/tile.pbf`));

// --- tiny protobuf encoder for hand-built tiles ---
const varint = (n: number): number[] => {
  const out: number[] = [];
  let v = BigInt(n);
  if (v < 0n) v += 1n << 64n;
  do {
    let b = Number(v & 0x7fn);
    v >>= 7n;
    if (v > 0n) b |= 0x80;
    out.push(b);
  } while (v > 0n);
  return out;
};
const field = (num: number, wire: number) => varint((num << 3) | wire);
const lenDelim = (num: number, bytes: number[]) => [...field(num, 2), ...varint(bytes.length), ...bytes];
const str = (num: number, s: string) => lenDelim(num, [...new TextEncoder().encode(s)]);
const zig = (n: number) => (n << 1) ^ (n >> 31);

describe('decodeTile on a real OpenFreeMap tile (z14 13060/8471)', () => {
  const tile = decodeTile(fixture);

  test('contains the expected layers', () => {
    for (const name of ['water', 'transportation', 'landuse', 'landcover', 'waterway', 'boundary']) {
      expect(tile.layers[name]).toBeDefined();
    }
    expect(tile.layers.water.extent).toBe(4096);
    expect(tile.layers.transportation.features.length).toBeGreaterThan(10);
  });

  test('features carry properties and sane geometry', () => {
    const roads = tile.layers.transportation.features;
    const classes = new Set(roads.map((f) => f.props.class));
    expect(classes.has('minor')).toBe(true);
    for (const f of roads.filter((r) => r.type === 'line')) {
      for (const ring of f.rings) {
        expect(ring.length % 2).toBe(0);
        expect(ring.length).toBeGreaterThanOrEqual(4);
        for (const v of ring) expect(Math.abs(v)).toBeLessThan(4096 * 2);
      }
    }
    for (const f of tile.layers.water.features) {
      expect(f.type).toBe('polygon');
      for (const ring of f.rings) expect(ring.length).toBeGreaterThanOrEqual(6);
    }
  });

  test('layer filter skips the rest', () => {
    const only = decodeTile(fixture, { layers: new Set(['water']) });
    expect(Object.keys(only.layers)).toEqual(['water']);
    expect(only.layers.water.features.length).toBe(tile.layers.water.features.length);
  });
});

describe('decodeTile on a hand-built tile', () => {
  test('decodes geometry commands, zigzag, tags and every value type', () => {
    const feature = [
      ...field(1, 0), ...varint(7), // id
      ...lenDelim(2, [0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5]), // tags
      ...field(3, 0), ...varint(2), // LINESTRING
      ...lenDelim(4, [
        ...varint((1 << 3) | 1), ...varint(zig(25)), ...varint(zig(17)), // MoveTo(25,17)
        ...varint((2 << 3) | 2), ...varint(zig(-3)), ...varint(zig(4)), ...varint(zig(10)), ...varint(zig(-20)),
      ]),
    ];
    const poly = [
      ...field(3, 0), ...varint(3),
      ...lenDelim(4, [
        ...varint((1 << 3) | 1), ...varint(zig(0)), ...varint(zig(0)),
        ...varint((2 << 3) | 2), ...varint(zig(10)), ...varint(zig(0)), ...varint(zig(0)), ...varint(zig(10)),
        ...varint((1 << 3) | 7),
        ...varint((1 << 3) | 1), ...varint(zig(-8)), ...varint(zig(-8)), // hole starts relative
        ...varint((2 << 3) | 2), ...varint(zig(2)), ...varint(zig(0)), ...varint(zig(0)), ...varint(zig(2)),
        ...varint((1 << 3) | 7),
      ]),
    ];
    const points = [
      ...field(3, 0), ...varint(1),
      ...lenDelim(4, [...varint((2 << 3) | 1), ...varint(zig(5)), ...varint(zig(6)), ...varint(zig(1)), ...varint(zig(1))]),
    ];
    const value = (bytes: number[]) => lenDelim(4, bytes);
    const f32 = [...new Uint8Array(new Float32Array([1.5]).buffer)];
    const f64 = [...new Uint8Array(new Float64Array([-2.25]).buffer)];
    const layer = [
      ...str(1, 'roads'),
      ...lenDelim(2, feature),
      ...lenDelim(2, poly),
      ...lenDelim(2, points),
      ...str(3, 'class'), ...str(3, 'f'), ...str(3, 'd'), ...str(3, 'i'), ...str(3, 'u'), ...str(3, 'b'),
      ...value(str(1, 'residential')),
      ...value([...field(2, 5), ...f32]),
      ...value([...field(3, 1), ...f64]),
      ...value([...field(4, 0), ...varint(-5)]),
      ...value([...field(5, 0), ...varint(2 ** 40)]),
      ...value([...field(7, 0), ...varint(1)]),
      ...field(5, 0), ...varint(4096),
      ...field(15, 0), ...varint(2),
    ];
    const tile = decodeTile(new Uint8Array(lenDelim(3, layer)));
    const roads = tile.layers.roads;
    expect(roads.extent).toBe(4096);
    expect(roads.features.length).toBe(3);

    const [line, polygon, pts] = roads.features;
    expect(line.id).toBe(7);
    expect(line.type).toBe('line');
    expect(line.props).toEqual({ class: 'residential', f: 1.5, d: -2.25, i: -5, u: 2 ** 40, b: true });
    expect(Array.from(line.rings[0])).toEqual([25, 17, 22, 21, 32, 1]);

    expect(polygon.type).toBe('polygon');
    expect(polygon.rings.length).toBe(2);
    expect(Array.from(polygon.rings[0])).toEqual([0, 0, 10, 0, 10, 10]);
    // cursor continues from the last point of the previous ring: (10,10) + (-8,-8)
    expect(Array.from(polygon.rings[1])).toEqual([2, 2, 4, 2, 4, 4]);

    expect(pts.type).toBe('point');
    expect(pts.rings.map((r) => Array.from(r))).toEqual([[5, 6], [6, 7]]);
  });

  test('rejects truncated input', () => {
    expect(() => decodeTile(fixture.subarray(0, 40))).toThrow();
  });
});
