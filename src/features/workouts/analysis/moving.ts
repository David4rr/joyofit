/** Under this ground speed (m/s) the track counts as stopped. */
export const MIN_MOVING_SPEED_MS = 0.5;

/**
 * Seconds the track moved: each grid sample whose neighbours (one step either side) are at least 0.5 m/s apart counts one
 * step, so a pause's edges stay sharp. The last sample may lie past the end of the workout; times are clamped to it.
 * Without a track (`dist` null) nothing says when the workout paused: the whole elapsed time counts.
 */
export function movingSeconds(dist: readonly number[] | null, stepSec: number, elapsedSec: number): number {
  if (!dist) return elapsedSec;
  const n = dist.length;
  let moving = 0;
  for (let i = 0; i < n; i++) {
    const lo = Math.max(0, i - 1);
    const hi = Math.min(n - 1, i + 1);
    const seconds = Math.min(hi * stepSec, elapsedSec) - lo * stepSec;
    if (hi > lo && seconds > 0 && (dist[hi] - dist[lo]) / seconds >= MIN_MOVING_SPEED_MS) {
      moving += Math.min(stepSec, Math.max(0, elapsedSec - i * stepSec));
    }
  }
  return Math.min(moving, elapsedSec);
}
