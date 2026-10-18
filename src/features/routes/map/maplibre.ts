/**
 * MapLibre is a native module: a JoyoFit build made before it was added does not have it, and importing it there throws
 * (its turbo module is looked up at import time). So it is required lazily and the result kept; every map screen checks
 * for null and shows the SVG route instead. The `import type` below is erased: nothing loads until `loadMapLibre`.
 */
import type * as MapLibreModule from '@maplibre/maplibre-react-native';

export type MapLibre = typeof MapLibreModule;

let loaded: MapLibre | null | undefined;

export function loadMapLibre(): MapLibre | null {
  if (loaded !== undefined) return loaded;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- lazy on purpose, see above
    loaded = require('@maplibre/maplibre-react-native') as MapLibre;
  } catch {
    loaded = null;
  }
  return loaded;
}
