import { describe, expect, test } from 'bun:test';

import { darkPalette, lightPalette, maplibreStyle } from './palette';

describe('maplibreStyle', () => {
  for (const theme of ['light', 'dark'] as const) {
    test(`${theme}: valid shape, OpenFreeMap source, no labels`, () => {
      const style = maplibreStyle(theme);
      expect(style.version).toBe(8);
      expect(style.sources.openmaptiles).toEqual({
        type: 'vector',
        url: 'https://tiles.openfreemap.org/planet',
      });
      expect('glyphs' in style).toBe(false);
      const ids = style.layers.map((l) => l.id);
      expect(new Set(ids).size).toBe(ids.length);
      expect(style.layers.some((l) => l.type === 'symbol')).toBe(false);
      for (const l of style.layers) {
        if (l.type !== 'background') {
          expect(l.source).toBe('openmaptiles');
          expect(l['source-layer']).toBeDefined();
        }
      }
      expect(ids[0]).toBe('background');
      expect(ids.indexOf('water')).toBeLessThan(ids.indexOf('road-minor'));
      expect(ids.indexOf('road-motorway-casing')).toBeLessThan(ids.indexOf('road-service'));
      const json = JSON.stringify(style);
      expect(JSON.parse(json)).toEqual(style);
    });
  }

  test('uses the palette colours', () => {
    const light = maplibreStyle('light');
    const dark = maplibreStyle('dark');
    expect(light.layers[0].paint['background-color']).toBe(lightPalette.background);
    expect(dark.layers[0].paint['background-color']).toBe(darkPalette.background);
    const water = dark.layers.find((l) => l.id === 'water')!;
    expect(water.paint['fill-color']).toBe(darkPalette.water);
  });
});
