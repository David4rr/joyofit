/** Ease-out cubic on 0..1: fast at first, settling at the end. Matches the Ring fill so numbers and arcs land together. */
export function easeOutCubic(t: number): number {
  const c = Math.min(1, Math.max(0, t));
  return 1 - (1 - c) ** 3;
}

/** Number on its way from `from` to `to` after `elapsed` of `duration` ms. Lands exactly on `to` at the end. */
export function countUpValue(from: number, to: number, elapsed: number, duration: number): number {
  if (duration <= 0 || elapsed >= duration) return to;
  return from + (to - from) * easeOutCubic(elapsed / duration);
}

/**
 * Where bar `index` of `count` starts and ends on a shared 0..1 timeline, so a row of bars grows left to right while one value
 * drives them all. `spread` is the share of the timeline spent on the stagger; each bar then takes the rest to grow.
 */
export function sweepRange(index: number, count: number, spread: number): [number, number] {
  const start = count > 1 ? (index / (count - 1)) * spread : 0;
  return [start, start + (1 - spread)];
}

/** What `useSyncDone` remembers between renders. */
export interface SyncTrack {
  /** A sync started and has not been resolved into a check (or dropped) yet. */
  began: boolean;
  /** The last-sync time when that sync started. */
  startedWith: number | null;
  /** The check is showing. */
  done: boolean;
}

export const IDLE_SYNC: SyncTrack = { began: false, startedWith: null, done: false };

/**
 * Next state for the sync check. A sync that began and ended with a newer last-sync time succeeded and shows the check; one that
 * ended without moving the time failed (the error shows elsewhere) and shows nothing. A new sync clears a check still showing.
 * Returns the same object when nothing changes, so it can be applied while rendering.
 */
export function trackSync(track: SyncTrack, syncing: boolean, lastSync: number | null): SyncTrack {
  if (syncing) {
    if (!track.began) return { began: true, startedWith: lastSync, done: false };
    return track.done ? { ...track, done: false } : track;
  }
  if (track.began && lastSync !== null && lastSync !== track.startedWith) return { began: false, startedWith: null, done: true };
  return track;
}
