/** The arithmetic of the cadence metronome. Pure: no React, no native modules, so it runs under `bun test`. */

export const MIN_BPM = 120;
export const MAX_BPM = 200;
export const DEFAULT_BPM = 170;
export const BPM_STEP = 5;

/** How long one beat buzzes (ms): short enough to be a tick at 200 bpm (a 300 ms beat). */
export const BEAT_PULSE_MS = 40;

/** `bpm` as a whole number inside the range; anything that is not a number is the default. */
export function clampBpm(bpm: unknown): number {
  if (typeof bpm !== 'number' || !Number.isFinite(bpm)) return DEFAULT_BPM;
  return Math.min(MAX_BPM, Math.max(MIN_BPM, Math.round(bpm)));
}

/** One step of the stepper: `direction` times `BPM_STEP`, kept inside the range. */
export function stepBpm(bpm: number, direction: -1 | 1): number {
  return clampBpm(bpm + direction * BPM_STEP);
}

export function beatIntervalMs(bpm: number): number {
  return 60_000 / clampBpm(bpm);
}

/**
 * When the beat after the one due at `dueAt` is due. It follows a fixed grid (no drift from timer lateness); a timer that was
 * suspended for more than one beat (screen off, the app in the background) restarts the grid from `now` instead of firing a
 * burst of catch-up beats.
 */
export function nextBeatAt(dueAt: number, now: number, intervalMs: number): number {
  const next = dueAt + intervalMs;
  return next <= now ? now + intervalMs : next;
}
