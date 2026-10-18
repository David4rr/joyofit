/**
 * Altitude for a drawn route from the Open-Meteo elevation API (https://open-meteo.com/en/docs/elevation-api): at most ~200
 * sampled points go out, 100 per request, and the rest of the line is interpolated by distance along the route. Any failure
 * returns the route without altitude: a missing altitude never blocks saving. Pure: `fetch` is injected.
 */
import { getJson, RequestError, type FetchLike } from '@/features/routes/map/http';
import { haversineM, type RoutePoint } from '@/features/routes/routeModel';

export const ELEVATION_URL = 'https://api.open-meteo.com/v1/elevation';
export const ELEVATION_MAX_SAMPLES = 200;
export const ELEVATION_BATCH = 100;
export const ELEVATION_TIMEOUT_MS = 10_000;

/** Distance from the first point to each point along the line, in metres. */
function cumulativeDistances(points: readonly RoutePoint[]): number[] {
  const cumulative = [0];
  for (let i = 1; i < points.length; i++) cumulative.push(cumulative[i - 1] + haversineM(points[i - 1], points[i]));
  return cumulative;
}

/**
 * Indices of at most `maxSamples` points, the first and the last among them, spaced evenly by distance along the line
 * (by index when the line has no length). Every point when there are no more than `maxSamples`.
 */
export function sampleIndices(points: readonly RoutePoint[], maxSamples = ELEVATION_MAX_SAMPLES): number[] {
  const count = points.length;
  const wanted = Math.max(2, maxSamples);
  if (count <= wanted) return Array.from({ length: count }, (_, i) => i);
  const cumulative = cumulativeDistances(points);
  const position = cumulative[count - 1] > 0 ? cumulative : points.map((_, i) => i);
  const end = position[count - 1];
  const picked = [0];
  let cursor = 0;
  for (let k = 1; k < wanted - 1; k++) {
    const target = (end * k) / (wanted - 1);
    while (cursor < count - 1 && position[cursor] < target) cursor++;
    // The point just before the target may be closer than the one just after.
    const before = Math.max(cursor - 1, 0);
    const closer = Math.abs(position[before] - target) <= Math.abs(position[cursor] - target) ? before : cursor;
    if (closer > picked[picked.length - 1] && closer < count - 1) picked.push(closer);
  }
  picked.push(count - 1);
  return picked;
}

/** The request for one batch: `latitude=a,b&longitude=c,d`, 5 decimals (about 1 m). */
export function elevationUrl(points: readonly { lat: number; lon: number }[]): string {
  const latitude = points.map((p) => p.lat.toFixed(5)).join(',');
  const longitude = points.map((p) => p.lon.toFixed(5)).join(',');
  return `${ELEVATION_URL}?latitude=${latitude}&longitude=${longitude}`;
}

/** The `elevation` array of an answer, one finite number per requested point. */
export function parseElevations(body: unknown, expected: number): number[] {
  const elevation = (body as { elevation?: unknown } | null)?.elevation;
  if (!Array.isArray(elevation) || elevation.length !== expected || !elevation.every((v) => typeof v === 'number' && Number.isFinite(v))) {
    throw new RequestError('parse', 'The elevation answer does not match the request.');
  }
  return elevation as number[];
}

/**
 * Every point with an altitude: the sampled ones as given, the others linearly between the two sampled neighbours by
 * distance along the line. `indices` are sorted and include the first and last point.
 */
export function interpolateAltitudes(
  points: readonly RoutePoint[],
  indices: readonly number[],
  altitudes: readonly number[],
): RoutePoint[] {
  const cumulative = cumulativeDistances(points);
  const result: RoutePoint[] = [];
  let segment = 0;
  for (let i = 0; i < points.length; i++) {
    while (segment < indices.length - 2 && i > indices[segment + 1]) segment++;
    const a = indices[segment];
    const b = indices[segment + 1] ?? a;
    const span = cumulative[b] - cumulative[a];
    const t = span > 0 ? Math.min(Math.max((cumulative[i] - cumulative[a]) / span, 0), 1) : 0;
    const alt = altitudes[segment] + ((altitudes[segment + 1] ?? altitudes[segment]) - altitudes[segment]) * t;
    result.push({ ...points[i], alt: Math.round(alt * 10) / 10 });
  }
  return result;
}

export interface ElevationOptions {
  fetch: FetchLike;
  headers?: Record<string, string>;
  maxSamples?: number;
  timeoutMs?: number;
  signal?: AbortSignal;
}

/**
 * The same points with `alt` filled in, or unchanged when the line is too short, already has altitude, or the service
 * cannot be reached (`ok: false`).
 */
export async function addElevation(
  points: readonly RoutePoint[],
  options: ElevationOptions,
): Promise<{ points: RoutePoint[]; ok: boolean }> {
  const unchanged = { points: [...points], ok: false };
  if (points.length < 2) return unchanged;
  if (points.every((p) => p.alt !== null)) return { points: [...points], ok: true };

  const indices = sampleIndices(points, options.maxSamples);
  const samples = indices.map((i) => points[i]);
  const altitudes: number[] = [];
  try {
    for (let from = 0; from < samples.length; from += ELEVATION_BATCH) {
      const batch = samples.slice(from, from + ELEVATION_BATCH);
      const body = await getJson(options.fetch, elevationUrl(batch), {
        headers: { Accept: 'application/json', ...options.headers },
        timeoutMs: options.timeoutMs ?? ELEVATION_TIMEOUT_MS,
        signal: options.signal,
      });
      altitudes.push(...parseElevations(body, batch.length));
    }
  } catch {
    return unchanged;
  }
  return { points: interpolateAltitudes(points, indices, altitudes), ok: true };
}
