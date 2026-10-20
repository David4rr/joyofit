/**
 * Cadence and step length ("Panjang langkah") of a foot workout when the source did not store them directly.
 *
 * Step length (metres per step, what intervals.icu calls stride length) is speed over steps per second:
 * `speed / (cadence / 60)`. Every figure here is a plausibility-checked estimate, never a measurement: a value outside the
 * human range is dropped (null) rather than clamped, so a stray GPS jump or a stopped watch cannot show as a "stride".
 */

/** Under this speed (m/s) the person is standing: the same threshold the pace series uses for "moving". */
export const MIN_STRIDE_SPEED_MS = 0.5;
/** Steps per minute: a slow walk is about 60, a sprint about 230; outside 40 to 260 the reading is not a gait. */
export const MIN_SPM = 40;
export const MAX_SPM = 260;
/** Metres per step: a shuffling step is 0.2 m, a sprinter's about 2.5 m. */
export const MIN_STEP_M = 0.2;
export const MAX_STEP_M = 2.5;

const inRange = (value: number, min: number, max: number): boolean => Number.isFinite(value) && value >= min && value <= max;

/** Metres per step from `speedMs` (m/s) and `spm` (steps per minute); null while standing, without a cadence or outside the human range. */
export function stepLengthFromSpeed(speedMs: number | null, spm: number | null): number | null {
  if (speedMs === null || spm === null || speedMs < MIN_STRIDE_SPEED_MS || !inRange(spm, MIN_SPM, MAX_SPM)) return null;
  const length = speedMs / (spm / 60);
  return inRange(length, MIN_STEP_M, MAX_STEP_M) ? length : null;
}

/** Steps per minute from a step count over `movingSec`; null outside the human range. */
export function cadenceFromSteps(steps: number, movingSec: number): number | null {
  if (!(steps > 0) || !(movingSec > 0)) return null;
  const spm = steps / (movingSec / 60);
  return inRange(spm, MIN_SPM, MAX_SPM) ? spm : null;
}

/** A figure a source gave directly, kept only when it is a possible step length (the cloud contract allows 0 to 10 m). */
export function plausibleStepLength(metres: number | null | undefined): number | null {
  return typeof metres === 'number' && inRange(metres, MIN_STEP_M, MAX_STEP_M) ? metres : null;
}
