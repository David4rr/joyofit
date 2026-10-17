/**
 * The pure half of the route store: what a saved route looks like on disk and how a draft becomes one. `routeStore.ts`
 * does the file access with these.
 */
import {
  cleanRoutePoints,
  MAX_STORED_POINTS,
  routeStats,
  simplifyRoute,
  type RouteDraft,
  type RoutePoint,
  type RouteSource,
  type SavedRoute,
} from './routeModel';

/** Longest name kept, in characters. The watch takes 100 UTF-8 bytes; `watchRoute.ts` shortens a name for it. */
export const MAX_NAME_LENGTH = 100;

/** Points in the thumbnail the library list draws. */
export const THUMB_POINTS = 48;

const ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** What the `<id>.json` file holds: the route's facts and a few points for the list thumbnail (flat `lat, lon`). */
export interface StoredMeta {
  v: 1;
  route: SavedRoute;
  thumb: number[];
}

/** What the `<id>.pts.json` file holds: flat `lat, lon, alt` triples, `null` for an unknown altitude. */
export interface StoredPoints {
  v: 1;
  pts: (number | null)[];
}

/** One property of parsed JSON of unknown shape; undefined when the value is not an object. */
function field(value: unknown, key: string): unknown {
  return typeof value === 'object' && value !== null ? Reflect.get(value, key) : undefined;
}

/** A short, sortable, file-name-safe id: the time in base 36, then random characters. */
export function newRouteId(now: number, random: () => number = Math.random): string {
  const tail = Math.floor(random() * 36 ** 6)
    .toString(36)
    .padStart(6, '0');
  return `${now.toString(36)}-${tail}`;
}

/** An id that is safe to put in a file name; route parameters come from a link, so nothing else is accepted. */
export function isRouteId(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 40 && ID_PATTERN.test(value);
}

/** The name as stored: whitespace collapsed, trimmed, at most `MAX_NAME_LENGTH` characters (never half a surrogate pair). */
export function cleanRouteName(name: string): string {
  const collapsed = name.replace(/\s+/g, ' ').trim();
  const chars = Array.from(collapsed);
  return chars.length > MAX_NAME_LENGTH ? chars.slice(0, MAX_NAME_LENGTH).join('').trim() : collapsed;
}

const round = (value: number, digits: number) => {
  const f = 10 ** digits;
  return Math.round(value * f) / f;
};

/** Flat triples; coordinates to 6 decimals (about 11 cm), altitude to 0.1 m. */
export function encodePoints(points: readonly RoutePoint[]): (number | null)[] {
  const flat: (number | null)[] = [];
  for (const p of points) flat.push(round(p.lat, 6), round(p.lon, 6), p.alt === null ? null : round(p.alt, 1));
  return flat;
}

/** The points of a stored file; null when it is not what `encodePoints` writes. */
export function decodePoints(stored: unknown): RoutePoint[] | null {
  const pts: unknown = field(stored, 'pts');
  if (!Array.isArray(pts) || pts.length % 3 !== 0) return null;
  const out: RoutePoint[] = [];
  for (let i = 0; i < pts.length; i += 3) {
    const lat = pts[i];
    const lon = pts[i + 1];
    const alt = pts[i + 2];
    if (typeof lat !== 'number' || typeof lon !== 'number') return null;
    out.push({ lat, lon, alt: typeof alt === 'number' ? alt : null });
  }
  return out;
}

/** `[lat, lon]` pairs for the list thumbnail. */
export function thumbOf(points: readonly RoutePoint[]): { lat: number; lon: number }[] {
  return simplifyRoute(points, THUMB_POINTS).map((p) => ({ lat: p.lat, lon: p.lon }));
}

export function encodeThumb(thumb: readonly { lat: number; lon: number }[]): number[] {
  return thumb.flatMap((p) => [round(p.lat, 5), round(p.lon, 5)]);
}

export function decodeThumb(flat: readonly number[]): { lat: number; lon: number }[] {
  const out: { lat: number; lon: number }[] = [];
  for (let i = 0; i + 1 < flat.length; i += 2) out.push({ lat: flat[i], lon: flat[i + 1] });
  return out;
}

const SOURCES: readonly RouteSource[] = ['gpx', 'tcx', 'drawn', 'workout'];

function isRouteSource(value: unknown): value is RouteSource {
  return SOURCES.some((s) => s === value);
}

function numberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** A `StoredMeta` read from disk, checked field by field; null when it is damaged. */
export function parseMeta(raw: unknown): StoredMeta | null {
  const route: unknown = field(raw, 'route');
  if (field(raw, 'v') !== 1 || typeof route !== 'object' || route === null) return null;
  const id: unknown = field(route, 'id');
  const name: unknown = field(route, 'name');
  const source: unknown = field(route, 'source');
  const createdAt: unknown = field(route, 'createdAt');
  const distanceM: unknown = field(route, 'distanceM');
  const pointCount: unknown = field(route, 'pointCount');
  const thumb: unknown = field(raw, 'thumb');
  if (!isRouteId(id) || typeof name !== 'string') return null;
  if (!isRouteSource(source)) return null;
  if (typeof createdAt !== 'number' || typeof distanceM !== 'number' || typeof pointCount !== 'number') return null;
  return {
    v: 1,
    route: {
      id,
      name,
      source,
      createdAt,
      distanceM,
      ascentM: numberOrNull(field(route, 'ascentM')),
      descentM: numberOrNull(field(route, 'descentM')),
      pointCount,
      hasAltitude: field(route, 'hasAltitude') === true,
      lastSentAt: numberOrNull(field(route, 'lastSentAt')),
    },
    thumb: Array.isArray(thumb) ? thumb.filter((x): x is number => typeof x === 'number') : [],
  };
}

export class RouteDraftError extends Error {
  constructor(public readonly reason: 'too-few-points', message: string) {
    super(message);
    this.name = 'RouteDraftError';
  }
}

export interface BuiltRoute {
  meta: StoredMeta;
  points: RoutePoint[];
}

/**
 * Turns a draft into what is stored: coordinates cleaned, stats from the full line, then at most `MAX_STORED_POINTS`
 * points kept. `tooFew` is the message when fewer than two usable points are left.
 */
export function buildRoute(draft: RouteDraft, id: string, now: number, tooFew: string, fallbackName: string): BuiltRoute {
  const cleaned = cleanRoutePoints(draft.points);
  if (cleaned.length < 2) throw new RouteDraftError('too-few-points', tooFew);
  const stats = routeStats(cleaned);
  const points = simplifyRoute(cleaned, MAX_STORED_POINTS);
  const route: SavedRoute = {
    id,
    name: cleanRouteName(draft.name) || fallbackName,
    source: draft.source,
    createdAt: now,
    distanceM: Math.round(stats.distanceM),
    ascentM: stats.ascentM,
    descentM: stats.descentM,
    pointCount: points.length,
    hasAltitude: stats.hasAltitude,
    lastSentAt: null,
  };
  return { meta: { v: 1, route, thumb: encodeThumb(thumbOf(points)) }, points };
}
