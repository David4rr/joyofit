import type { RogoHrSeries, RogoRoute, RogoVisibility, RogoWatchPostInput } from '@/cloud/rogo';
import type { WorkoutPointRow, WorkoutRow } from '@/db/queries';
import { downsample, heartRateBuckets, routePoints } from '@/features/workouts/summary';

/** The server's limits for `social.createWatchPost` (zod in JoyoRogo's `social.ts`). */
const MAX_SPORT_NAME = 60;
const MAX_DURATION_MIN = 1440;
const MAX_HR_BUCKETS = 600;
const MAX_ROUTE_POINTS = 1000;
const MIN_BPM = 20;
const MAX_BPM = 250;

/**
 * A workout may go to the JoyoRogo feed when the watch recorded all of it and it fits the post's duration limit.
 * Imported rows (Huawei export, FIT file) never do: they come from a file whose origin the app cannot tell, and a file
 * downloaded from Strava must not be shared (Strava API Agreement). The same rows already stay out of the cloud upload.
 */
export function canShareToRogo(workout: WorkoutRow): boolean {
  return workout.complete && !workout.imported && workout.duration > 0 && workout.duration <= MAX_DURATION_MIN * 60;
}

/** A bpm the server accepts, or null for a reading outside 20 to 250. */
function validBpm(value: number): number | null {
  const bpm = Math.round(value);
  return bpm >= MIN_BPM && bpm <= MAX_BPM ? bpm : null;
}

/**
 * Heart rate as at most 600 averaged readings, one per `intervalSec` seconds from `start`. The interval is the smallest
 * whole number of seconds that fits the workout into 600 buckets, so a 10-minute workout keeps one reading per second.
 * Null when the workout has no usable heart rate.
 */
export function hrSeries(points: readonly WorkoutPointRow[], start: number, end: number): RogoHrSeries | null {
  const intervalSec = Math.max(1, Math.ceil((end - start) / MAX_HR_BUCKETS));
  const count = Math.max(1, Math.ceil((end - start) / intervalSec));
  const buckets = heartRateBuckets(points, start, start + count * intervalSec, count);
  if (!buckets) return null;
  const bpm = buckets.values.map((value) => (value === null ? null : validBpm(value)));
  return bpm.some((value) => value !== null) ? { intervalSec, bpm } : null;
}

/** The GPS track as at most 1000 `[lat, lon]` pairs; null when fewer than two valid fixes remain. */
export function routePairs(points: readonly WorkoutPointRow[]): RogoRoute | null {
  const fixes = routePoints(points).filter((p) => Math.abs(p.lat) <= 90 && Math.abs(p.lon) <= 180);
  if (fixes.length < 2) return null;
  return downsample(fixes, MAX_ROUTE_POINTS).map((p) => [p.lat, p.lon]);
}

export interface WatchPostOptions {
  caption: string;
  visibility: RogoVisibility;
  includeHr: boolean;
  includeRoute: boolean;
}

/** `social.createWatchPost` input from a local workout row and its points. Seconds on the watch side, minutes and milliseconds on the server's. */
export function buildWatchPost(
  workout: WorkoutRow,
  points: readonly WorkoutPointRow[],
  options: WatchPostOptions,
): RogoWatchPostInput {
  const hr = options.includeHr ? hrSeries(points, workout.start, workout.end) : null;
  const route = options.includeRoute ? routePairs(points) : null;
  const caption = options.caption.trim();
  return {
    workout: {
      sportName: workout.sportName.slice(0, MAX_SPORT_NAME),
      startedAt: workout.start * 1000,
      durationMin: Math.max(1, Math.round(workout.duration / 60)),
      kcal: workout.calories > 0 ? Math.round(workout.calories) : null,
      distanceM: workout.distance > 0 ? Math.round(workout.distance) : null,
      avgHr: workout.avgHr === null ? null : validBpm(workout.avgHr),
      maxHr: workout.maxHr === null ? null : validBpm(workout.maxHr),
    },
    ...(hr || route ? { detail: { hr, route } } : {}),
    ...(caption ? { caption } : {}),
    visibility: options.visibility,
  };
}
