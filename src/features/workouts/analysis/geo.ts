import type { SportKind } from './types';

const EARTH_RADIUS_M = 6_371_000;
const RAD = Math.PI / 180;

/** Fastest believable ground speed between two fixes: a sprinting runner, or anything on wheels. */
const MAX_FOOT_SPEED_MS = 12;
const MAX_SPEED_MS = 30;
/** Fixes closer than this to the last kept one are GPS jitter (standing still drifts a metre or two per fix). */
const MIN_STEP_M = 1;
/** After this many rejected fixes in a row the anchor itself was the outlier: restart from the current fix. */
const MAX_CONSECUTIVE_REJECTS = 5;

/** A GPS point as stored: `workout_points` rows with a position; the rest of the row is ignored here. */
export interface RawFix {
  ts: number;
  lat: number | null;
  lon: number | null;
}

/** A fix that survived cleaning, with the distance walked up to it. */
export interface CleanFix {
  /** Unix seconds. */
  ts: number;
  lat: number;
  lon: number;
  /** Cumulative metres from the first kept fix. */
  dist: number;
}

/** Great-circle distance in metres. */
export function haversineM(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const dLat = (lat2 - lat1) * RAD;
  const dLon = (lon2 - lon1) * RAD;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * RAD) * Math.cos(lat2 * RAD) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(a)));
}

/**
 * A usable position: finite, in range, not the (0, 0) of a lost fix and not the pause marker (lat 90, lon -80) the watch
 * writes between GPS segments.
 */
export function isValidFix(lat: number | null, lon: number | null): lat is number {
  if (lat === null || lon === null || !Number.isFinite(lat) || !Number.isFinite(lon)) return false;
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return false;
  if (lat === 90 && lon === -80) return false;
  if (lat === 0 && lon === 0) return false;
  return true;
}

/**
 * The GPS track with invalid fixes, duplicate timestamps, jitter and teleports removed, and cumulative distance added.
 * A fix is a teleport when reaching it from the last kept fix would take more than 12 m/s on foot, 30 m/s otherwise.
 */
export function cleanFixes(points: readonly RawFix[], kind: SportKind): CleanFix[] {
  const limit = kind === 'run' || kind === 'walk' ? MAX_FOOT_SPEED_MS : MAX_SPEED_MS;
  const out: CleanFix[] = [];
  let lastTs = -Infinity;
  let rejects = 0;
  for (const p of points) {
    if (!isValidFix(p.lat, p.lon)) continue;
    if (!(p.ts > lastTs)) continue;
    lastTs = p.ts;
    const lat = p.lat as number;
    const lon = p.lon as number;
    const prev = out[out.length - 1];
    if (!prev) {
      out.push({ ts: p.ts, lat, lon, dist: 0 });
      continue;
    }
    const d = haversineM(prev.lat, prev.lon, lat, lon);
    if (d / (p.ts - prev.ts) > limit) {
      rejects += 1;
      if (rejects < MAX_CONSECUTIVE_REJECTS) continue;
      out.length = 0;
      out.push({ ts: p.ts, lat, lon, dist: 0 });
      rejects = 0;
      continue;
    }
    rejects = 0;
    if (d < MIN_STEP_M) continue;
    out.push({ ts: p.ts, lat, lon, dist: prev.dist + d });
  }
  return out;
}
