/** Map-independent geometry for the route map and the drawing screen. Pure: no React, no native modules. */

export interface LatLon {
  lat: number;
  lon: number;
}

/** MapLibre's `[west, south, east, north]`. */
export type Bounds = [west: number, south: number, east: number, north: number];

/** A box never thinner than this, so a one-point or a straight north-south line still has a zoom to fit. */
const MIN_SPAN_DEG = 0.004;

/** The box around the points, widened to `MIN_SPAN_DEG`; null for no points. */
export function boundsOf(points: readonly LatLon[]): Bounds | null {
  if (points.length === 0) return null;
  let west = Infinity;
  let south = Infinity;
  let east = -Infinity;
  let north = -Infinity;
  for (const p of points) {
    if (p.lon < west) west = p.lon;
    if (p.lon > east) east = p.lon;
    if (p.lat < south) south = p.lat;
    if (p.lat > north) north = p.lat;
  }
  const growLon = Math.max(0, (MIN_SPAN_DEG - (east - west)) / 2);
  const growLat = Math.max(0, (MIN_SPAN_DEG - (north - south)) / 2);
  return [west - growLon, south - growLat, east + growLon, north + growLat];
}

const toPosition = (p: LatLon): [number, number] => [p.lon, p.lat];

export function lineFeature(points: readonly LatLon[]): GeoJSON.Feature<GeoJSON.LineString> {
  return { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: points.map(toPosition) } };
}

export function pointFeature(point: LatLon): GeoJSON.Feature<GeoJSON.Point> {
  return { type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: toPosition(point) } };
}

/** Lines shorter than two points cannot be drawn and are left out. */
export function lineCollection(lines: readonly (readonly LatLon[])[]): GeoJSON.FeatureCollection {
  return { type: 'FeatureCollection', features: lines.filter((line) => line.length >= 2).map(lineFeature) };
}

export function pointCollection(points: readonly LatLon[]): GeoJSON.FeatureCollection {
  return { type: 'FeatureCollection', features: points.map(pointFeature) };
}
