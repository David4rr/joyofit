/**
 * The route model shared by the library, the importers, the map and the watch push. Pure: no React, no native modules,
 * so everything here runs under `bun test`.
 */

import { fmtDecimal, fmtInt, t } from '@/i18n';

export interface RoutePoint {
  lat: number;
  lon: number;
  /** Metres above sea level; null when the source did not have it. */
  alt: number | null;
}

export type RouteSource = 'gpx' | 'tcx' | 'drawn' | 'workout';

export interface SavedRoute {
  id: string;
  name: string;
  source: RouteSource;
  /** Epoch milliseconds. */
  createdAt: number;
  distanceM: number;
  ascentM: number | null;
  descentM: number | null;
  /** Points kept in storage (at most `MAX_STORED_POINTS`). */
  pointCount: number;
  /** Every stored point has an altitude. */
  hasAltitude: boolean;
  /** Epoch milliseconds of the last successful send to the watch. */
  lastSentAt: number | null;
}

export interface RouteDraft {
  name: string;
  source: RouteSource;
  points: RoutePoint[];
}

/** Most points a saved route keeps; longer tracks are simplified down to this. */
export const MAX_STORED_POINTS = 5000;

/** Altitude changes smaller than this are noise and count as neither ascent nor descent. */
export const ELEVATION_THRESHOLD_M = 3;

const EARTH_RADIUS_M = 6_371_008.8;
const toRad = (deg: number) => (deg * Math.PI) / 180;

/** Great-circle distance in metres. */
export function haversineM(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** A coordinate on Earth that is not the 0,0 a GPS without a fix reports. */
export function isUsableCoordinate(lat: number, lon: number): boolean {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return false;
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return false;
  return Math.abs(lat) > 1e-6 || Math.abs(lon) > 1e-6;
}

/** Drops points without a usable coordinate and consecutive repeats of the same coordinate; an altitude that is not a number becomes null. */
export function cleanRoutePoints(points: readonly { lat: number; lon: number; alt?: number | null }[]): RoutePoint[] {
  const out: RoutePoint[] = [];
  for (const p of points) {
    if (!isUsableCoordinate(p.lat, p.lon)) continue;
    const last = out[out.length - 1];
    if (last && last.lat === p.lat && last.lon === p.lon) continue;
    const alt = p.alt !== null && p.alt !== undefined && Number.isFinite(p.alt) ? p.alt : null;
    out.push({ lat: p.lat, lon: p.lon, alt });
  }
  return out;
}

/**
 * Gives every point an altitude when most of them have one: a gap is filled by interpolating between the neighbours that
 * have it (by index), the ends take the nearest one. When fewer than half of the points have an altitude, a guess would be
 * mostly invented, so all altitudes are dropped instead.
 */
export function completeAltitudes(points: readonly RoutePoint[]): RoutePoint[] {
  const n = points.length;
  const known: number[] = [];
  for (let i = 0; i < n; i++) {
    const alt = points[i].alt;
    if (alt !== null && Number.isFinite(alt)) known.push(i);
  }
  if (n === 0) return [];
  if (known.length === n) return points.map((p) => ({ ...p }));
  if (known.length === 0 || known.length * 2 < n) return points.map((p) => ({ lat: p.lat, lon: p.lon, alt: null }));

  const out = points.map((p) => ({ ...p }));
  // Between two known indexes `known[k]` and `known[k + 1]`; before the first and after the last the nearest one is used.
  let k = 0;
  for (let i = 0; i < n; i++) {
    if (known[k] === i) continue;
    while (k + 1 < known.length && known[k + 1] < i) k++;
    const before = known[k] < i ? known[k] : null;
    const after = known[k] < i ? (known[k + 1] ?? null) : known[k];
    if (before !== null && after !== null) {
      const a = points[before].alt as number;
      const b = points[after].alt as number;
      out[i].alt = a + ((b - a) * (i - before)) / (after - before);
    } else {
      out[i].alt = points[(before ?? after) as number].alt;
    }
  }
  return out;
}

export interface RouteStats {
  distanceM: number;
  ascentM: number | null;
  descentM: number | null;
  /** Every point has an altitude. */
  hasAltitude: boolean;
}

/** Distance, ascent and descent. Ascent and descent are null unless every point has an altitude; changes under `ELEVATION_THRESHOLD_M` are ignored. */
export function routeStats(points: readonly RoutePoint[]): RouteStats {
  let distanceM = 0;
  for (let i = 1; i < points.length; i++) distanceM += haversineM(points[i - 1], points[i]);
  const hasAltitude = points.length > 0 && points.every((p) => p.alt !== null && Number.isFinite(p.alt));
  if (!hasAltitude) return { distanceM, ascentM: null, descentM: null, hasAltitude: false };

  let ascent = 0;
  let descent = 0;
  let ref = points[0].alt as number;
  for (let i = 1; i < points.length; i++) {
    const alt = points[i].alt as number;
    const delta = alt - ref;
    if (delta >= ELEVATION_THRESHOLD_M) {
      ascent += delta;
      ref = alt;
    } else if (delta <= -ELEVATION_THRESHOLD_M) {
      descent -= delta;
      ref = alt;
    }
  }
  return { distanceM, ascentM: Math.round(ascent), descentM: Math.round(descent), hasAltitude: true };
}

/** `850 m` below a kilometre, `12,4 km` / `12.4 km` above (decimal mark of the language). */
export function formatRouteDistance(m: number): string {
  const metres = Math.round(m);
  if (metres < 1000) return t('common:units.m', { value: fmtInt(Math.max(0, metres)) });
  return t('common:units.km', { value: fmtDecimal(m / 1000, 1) });
}

/** `+320 m` for a climb, `-80 m` for a drop (pass a negative number), `0 m`, and `-` when unknown. */
export function formatElevation(m: number | null): string {
  if (m === null || !Number.isFinite(m)) return '-';
  const rounded = Math.round(m);
  if (rounded === 0) return t('common:units.m', { value: '0' });
  return t('common:units.m', { value: `${rounded > 0 ? '+' : '-'}${fmtInt(Math.abs(rounded))}` });
}

interface Segment {
  lo: number;
  hi: number;
  /** Index of the point farthest from the chord `lo` to `hi`. */
  far: number;
  /** Its distance from the chord, metres. */
  dev: number;
}

/**
 * At most `maxPoints` points of the line that keep its shape best: the first and last point stay, then the point that
 * deviates most from the line drawn so far is added until the budget is used (Douglas-Peucker, best-first). Returns the
 * input points themselves in their original order, so extra fields (altitude) stay with them. Fewer points are returned
 * when the rest lie exactly on the line.
 */
export function simplifyRoute<T extends { lat: number; lon: number }>(points: readonly T[], maxPoints: number): T[] {
  const n = points.length;
  const budget = Math.max(2, Math.floor(maxPoints));
  if (n <= budget) return [...points];

  const kx = 111_320 * Math.cos(toRad(points[0].lat));
  const ky = 110_540;
  const xs = new Float64Array(n);
  const ys = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    xs[i] = (points[i].lon - points[0].lon) * kx;
    ys[i] = (points[i].lat - points[0].lat) * ky;
  }

  const segment = (lo: number, hi: number): Segment => {
    const ax = xs[lo];
    const ay = ys[lo];
    const dx = xs[hi] - ax;
    const dy = ys[hi] - ay;
    const len2 = dx * dx + dy * dy;
    let far = lo;
    let dev = -1;
    for (let i = lo + 1; i < hi; i++) {
      const px = xs[i] - ax;
      const py = ys[i] - ay;
      let d2: number;
      if (len2 === 0) d2 = px * px + py * py;
      else {
        const t = Math.max(0, Math.min(1, (px * dx + py * dy) / len2));
        const ex = px - t * dx;
        const ey = py - t * dy;
        d2 = ex * ex + ey * ey;
      }
      if (d2 > dev) {
        dev = d2;
        far = i;
      }
    }
    return { lo, hi, far, dev: Math.sqrt(Math.max(0, dev)) };
  };

  const heap: Segment[] = [];
  const push = (s: Segment) => {
    heap.push(s);
    let i = heap.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (heap[parent].dev >= heap[i].dev) break;
      [heap[parent], heap[i]] = [heap[i], heap[parent]];
      i = parent;
    }
  };
  const pop = (): Segment => {
    const top = heap[0];
    const last = heap.pop() as Segment;
    if (heap.length > 0) {
      heap[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < heap.length && heap[l].dev > heap[m].dev) m = l;
        if (r < heap.length && heap[r].dev > heap[m].dev) m = r;
        if (m === i) break;
        [heap[m], heap[i]] = [heap[i], heap[m]];
        i = m;
      }
    }
    return top;
  };

  const keep = new Uint8Array(n);
  keep[0] = 1;
  keep[n - 1] = 1;
  let kept = 2;
  if (n > 2) push(segment(0, n - 1));
  while (kept < budget && heap.length > 0) {
    const top = pop();
    if (top.dev <= 0) break;
    keep[top.far] = 1;
    kept++;
    if (top.far - top.lo > 1) push(segment(top.lo, top.far));
    if (top.hi - top.far > 1) push(segment(top.far, top.hi));
  }
  const out: T[] = [];
  for (let i = 0; i < n; i++) if (keep[i] === 1) out.push(points[i]);
  return out;
}
