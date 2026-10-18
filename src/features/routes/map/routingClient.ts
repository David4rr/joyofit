/**
 * Snaps a leg between two waypoints to roads and paths with the FOSSGIS OSRM instances (`routed-foot`, `routed-bike`).
 * Policy (https://routing.openstreetmap.de/about.html): at most one request per second, a valid User-Agent and Referer,
 * attribution, no heavy use. So: one serial queue at >= 1.1 s between request starts, a cache per session, and a
 * 10 s timeout. Pure: `fetch`, the throttle and the identity are injected.
 */
import type { LatLon } from '@/features/routes/map/geometry';
import { getJson, RequestError, type FetchLike } from '@/features/routes/map/http';
import { createThrottle, type Throttle } from '@/features/routes/map/throttle';

export type RoutingProfile = 'foot' | 'bike';

export const ROUTING_BASE_URL = 'https://routing.openstreetmap.de';
export const ROUTING_MIN_INTERVAL_MS = 1100;
export const ROUTING_TIMEOUT_MS = 10_000;
const MAX_CACHED_LEGS = 300;

/** A coordinate as the URL and the cache key carry it: 6 decimals (about 0.1 m) without trailing zeros. */
function coordinateText(value: number): string {
  return String(Number(value.toFixed(6)));
}

/** The "driving" in the path is right for the foot and bike instances: it is the name of the profile they all share. */
export function routeUrl(profile: RoutingProfile, from: LatLon, to: LatLon): string {
  const path = `${coordinateText(from.lon)},${coordinateText(from.lat)};${coordinateText(to.lon)},${coordinateText(to.lat)}`;
  return `${ROUTING_BASE_URL}/routed-${profile}/route/v1/driving/${path}?overview=full&geometries=geojson`;
}

/** Waypoints within about a metre of each other are the same request (5 decimals is 1.1 m). */
export function routeCacheKey(profile: RoutingProfile, from: LatLon, to: LatLon): string {
  const round = (p: LatLon) => `${p.lat.toFixed(5)},${p.lon.toFixed(5)}`;
  return `${profile}:${round(from)}>${round(to)}`;
}

function isCoordinatePair(value: unknown): value is [number, number] {
  return (
    Array.isArray(value) &&
    value.length >= 2 &&
    typeof value[0] === 'number' &&
    typeof value[1] === 'number' &&
    Number.isFinite(value[0]) &&
    Number.isFinite(value[1]) &&
    Math.abs(value[0]) <= 180 &&
    Math.abs(value[1]) <= 90
  );
}

/** The line of `routes[0]` as lat/lon points. Throws a `code` error when OSRM found no route and a `parse` error for any other shape. */
export function parseRouteResponse(body: unknown): LatLon[] {
  if (typeof body !== 'object' || body === null) throw new RequestError('parse', 'The routing answer is empty.');
  const { code, routes } = body as { code?: unknown; routes?: unknown };
  if (code !== 'Ok') throw new RequestError('code', `Routing code: ${String(code)}`);
  const coordinates = (Array.isArray(routes) ? (routes[0] as { geometry?: { coordinates?: unknown } } | undefined) : undefined)
    ?.geometry?.coordinates;
  if (!Array.isArray(coordinates) || coordinates.length < 2 || !coordinates.every(isCoordinatePair)) {
    throw new RequestError('parse', 'The routing answer has no usable line.');
  }
  // GeoJSON order is longitude first.
  return coordinates.map(([lon, lat]) => ({ lat, lon }));
}

export interface RoutingClientOptions {
  fetch: FetchLike;
  /** `JoyoFit/<version> (https://joyofit.app)`: the service blocks anonymous and library default agents. */
  userAgent: string;
  referer: string;
  /** One shared queue per service; defaults to 1.1 s between request starts. */
  throttle?: Throttle;
  timeoutMs?: number;
}

export interface RoutingClient {
  /** The snapped line from `from` to `to`, both ends at the road. Rejects with a `RequestError`; an abort has kind `aborted`. */
  route(profile: RoutingProfile, from: LatLon, to: LatLon, signal?: AbortSignal): Promise<readonly LatLon[]>;
}

export function createRoutingClient(options: RoutingClientOptions): RoutingClient {
  const throttle = options.throttle ?? createThrottle({ minIntervalMs: ROUTING_MIN_INTERVAL_MS });
  const timeoutMs = options.timeoutMs ?? ROUTING_TIMEOUT_MS;
  const headers = { 'User-Agent': options.userAgent, Referer: options.referer, Accept: 'application/json' };
  const cache = new Map<string, readonly LatLon[]>();

  return {
    async route(profile, from, to, signal) {
      const key = routeCacheKey(profile, from, to);
      const hit = cache.get(key);
      if (hit) return hit;

      const line = await throttle(
        async () => parseRouteResponse(await getJson(options.fetch, routeUrl(profile, from, to), { headers, timeoutMs, signal })),
        signal,
      );
      if (cache.size >= MAX_CACHED_LEGS) cache.delete(cache.keys().next().value as string);
      cache.set(key, line);
      return line;
    },
  };
}
