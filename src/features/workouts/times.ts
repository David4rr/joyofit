/**
 * The two durations of a workout and what is derived from them, in one place so the header, the analysis, the share card,
 * the JoyoRogo post and the Strava file all show the same figures.
 *
 * - `elapsedSec` is `end - start`: the watch's start and end time stamps of the workout.
 * - `movingSec` is the time Strava calls moving time. A Strava activity made from our FIT file takes it from the file's
 *   timer events, which span the whole workout except a pause the watch reported (see `activityFile.ts`), so it equals the
 *   elapsed time unless the watch's own active time (`duration`, the watch's timer) is at least `PAUSE_MIN_SEC` shorter,
 *   in which case it is that active time. The watch's timer and its start and end time stamps differ by a few seconds
 *   (3 s on the owner's walk: 25:23 against 25:26). The stored data cannot say why (rounding cannot make 3 s; a timer
 *   that starts after the workout's start stamp or a stop stamp written after the timer stops can); it is not a pause, and
 *   Strava, which counts from the file's start and stop, shows 25:26 for both moving and elapsed time.
 */

/** A watch active time this much shorter than the elapsed time is a pause; the Strava file writes one from the same size. */
export const PAUSE_MIN_SEC = 30;

export interface WorkoutTimes {
  elapsedSec: number;
  movingSec: number;
}

/** `end - start`; the watch's active time when the end is not usable. */
export function elapsedOfWorkout(w: { start: number; end: number; duration: number }): number {
  return w.end > w.start ? w.end - w.start : Math.max(w.duration, 0);
}

/** Moving seconds from the elapsed time and the watch's active time (0 or less when the watch gave none). */
export function movingOf(elapsedSec: number, activeSec: number): number {
  return activeSec > 0 && elapsedSec - activeSec >= PAUSE_MIN_SEC ? activeSec : elapsedSec;
}

export function workoutTimes(w: { start: number; end: number; duration: number }): WorkoutTimes {
  const elapsedSec = elapsedOfWorkout(w);
  return { elapsedSec, movingSec: movingOf(elapsedSec, w.duration) };
}

/** Metres over moving seconds, as Strava's average speed; null without both or under 100 m. */
export function averageSpeedMs(distanceM: number, movingSec: number): number | null {
  return distanceM >= 100 && movingSec > 0 ? distanceM / movingSec : null;
}

/** Seconds per `perM` metres (1000 for km, 100 for swimming); null like `averageSpeedMs`. */
export function averagePaceSec(distanceM: number, movingSec: number, perM = 1000): number | null {
  const speed = averageSpeedMs(distanceM, movingSec);
  return speed === null ? null : perM / speed;
}
