/**
 * "Cari tempat": one place search against Nominatim (https://operations.osmfoundation.org/policies/nominatim/): only when
 * the user submits (never while typing), at most one request per second, an identifying User-Agent and Referer, results
 * cached per session, attribution on screen. Pure: `fetch` and the throttle are injected.
 */
import { getJson, RequestError, type FetchLike } from '@/features/routes/map/http';
import { createThrottle, type Throttle } from '@/features/routes/map/throttle';

export const GEOCODE_URL = 'https://nominatim.openstreetmap.org/search';
const MIN_QUERY_LENGTH = 3;
const MAX_QUERY_LENGTH = 100;
const MAX_RESULTS = 5;
const MAX_CACHED_QUERIES = 50;

export interface Place {
  /** The short name, e.g. "Alun-Alun Kota Malang". */
  name: string;
  /** The rest of the address, e.g. "Klojen, Malang, Jawa Timur, Indonesia"; empty when there is none. */
  detail: string;
  lat: number;
  lon: number;
}

/** The query as it is sent and cached: trimmed, single spaces. Null when it is too short or too long to search. */
export function normalizeQuery(text: string): string | null {
  const query = text.trim().replace(/\s+/g, ' ');
  return query.length >= MIN_QUERY_LENGTH && query.length <= MAX_QUERY_LENGTH ? query : null;
}

export function searchUrl(query: string): string {
  return `${GEOCODE_URL}?q=${encodeURIComponent(query)}&format=jsonv2&limit=${MAX_RESULTS}&accept-language=id`;
}

interface RawPlace {
  lat?: unknown;
  lon?: unknown;
  name?: unknown;
  display_name?: unknown;
}

/** Places with a usable coordinate; `name` falls back to the first part of the display name. */
export function parsePlaces(body: unknown): Place[] {
  if (!Array.isArray(body)) throw new RequestError('parse', 'The search answer is not a list.');
  const places: Place[] = [];
  for (const raw of body as RawPlace[]) {
    const lat = Number(raw?.lat);
    const lon = Number(raw?.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) continue;
    const display = typeof raw.display_name === 'string' ? raw.display_name : '';
    const [first = '', ...rest] = display.split(',').map((part) => part.trim());
    const name = typeof raw.name === 'string' && raw.name !== '' ? raw.name : first;
    if (name === '') continue;
    // The display name starts with the name; keep the address after it.
    const detail = (first === name ? rest : [first, ...rest]).filter((part) => part !== '').join(', ');
    places.push({ name, detail, lat, lon });
  }
  return places;
}

export interface GeocodeClientOptions {
  fetch: FetchLike;
  userAgent: string;
  referer: string;
  throttle?: Throttle;
  timeoutMs?: number;
}

export interface GeocodeClient {
  /** Places for `text`; an empty list when nothing matches, `RequestError` `parse` for a text that cannot be searched. */
  search(text: string, signal?: AbortSignal): Promise<readonly Place[]>;
}

export function createGeocodeClient(options: GeocodeClientOptions): GeocodeClient {
  const throttle = options.throttle ?? createThrottle({ minIntervalMs: 1100 });
  const headers = { 'User-Agent': options.userAgent, Referer: options.referer, Accept: 'application/json' };
  const cache = new Map<string, readonly Place[]>();

  return {
    async search(text, signal) {
      const query = normalizeQuery(text);
      if (!query) throw new RequestError('parse', 'The search text is too short or too long.');
      const key = query.toLowerCase();
      const hit = cache.get(key);
      if (hit) return hit;

      const places = await throttle(
        async () => parsePlaces(await getJson(options.fetch, searchUrl(query), { headers, timeoutMs: options.timeoutMs ?? 10_000, signal })),
        signal,
      );
      if (cache.size >= MAX_CACHED_QUERIES) cache.delete(cache.keys().next().value as string);
      cache.set(key, places);
      return places;
    },
  };
}
