import type { SleepSegment } from '@/wear';

/**
 * Watches that give no sleep stages (Huawei Watch Fit 2: only `sleep_state.bin`) store one stage-less range per
 * TruSleep state record. Those records are the watch's sensor windows, not a verdict of "asleep": Huawei Health works
 * the real sleep out of `sleep_data.bin` on the phone, which JoyoFit does not do (see `SleepSync.segmentsFromState`).
 * A 1-minute HRV or stress check, and a workout started on the watch, both open such windows, so they were counted as
 * sleep: a "nap" of 7 minutes made of fragments, a night that included a morning run.
 *
 * This is the rule that tells them apart again, on stage-less segments only (a segment with a stage came from the
 * watch's own sleep analysis and is never touched). Same rule as `SleepCleaning` in SleepCleaning.kt and
 * SleepCleaning.swift; keep the three and their constants together.
 *
 *  1. Awake evidence is subtracted from the stage-less ranges: a stored workout, a stored spot HRV measurement
 *     (you sat still on purpose), and every minute with {@link ACTIVE_STEPS_PER_MIN} steps or more.
 *  2. What is left is chained into runs (pieces at most {@link RUN_BRIDGE_SEC} apart). A run holding less than
 *     {@link MIN_RUN_SEC} of sleep is dropped: that covers the 1 to 5 minute fragments, a stress check, and a nap too
 *     short to tell from one.
 *  3. A kept segment that follows a workout, or that follows another stage-less segment after more than
 *     {@link UNSTAGED_BREAK_SEC} of nothing, is marked `breakBefore`, so the night is split there and its totals are
 *     worked out for each side.
 */

/** A stage-less run needs this much sleep (gaps up to {@link RUN_BRIDGE_SEC} inside it are not counted) to be sleep. */
export const MIN_RUN_SEC = 20 * 60;

/** Stage-less pieces this close belong to one run: a minute of steps or a short state gap does not end a night. */
export const RUN_BRIDGE_SEC = 2 * 60;

/** A minute with this many steps is awake. Sleep, even a restless one, does not walk. */
export const ACTIVE_STEPS_PER_MIN = 15;

/** Room left around a spot HRV measurement; the stored span is the 1-minute reading itself. */
export const SPOT_MARGIN_SEC = 60;

/** Two stage-less segments further apart than this are two sessions: nobody sleeps through an hour of nothing recorded. */
export const UNSTAGED_BREAK_SEC = 60 * 60;

export interface Span {
  start: number;
  end: number;
}

/** What says the wearer was awake while the watch recorded a stage-less range. All times are unix seconds. */
export interface SleepEvidence {
  /** Stored workouts (any source). */
  workouts: readonly Span[];
  /** Stored spot HRV measurements (`hrv_readings.source = 'spot'`). */
  spots: readonly Span[];
  /** Start of every minute with at least {@link ACTIVE_STEPS_PER_MIN} steps, in any order. */
  activeMinutes: readonly number[];
}

export const NO_EVIDENCE: SleepEvidence = { workouts: [], spots: [], activeMinutes: [] };

/** A workout's span; a row without a usable end falls back to its active duration. */
export function workoutSpan(start: number, end: number, duration: number): Span {
  return { start, end: end > start ? end : start + Math.max(0, duration) };
}

function mergeSpans(spans: Span[]): Span[] {
  const sorted = spans.filter((s) => s.end > s.start).sort((a, b) => a.start - b.start || a.end - b.end);
  const out: Span[] = [];
  for (const s of sorted) {
    const last = out[out.length - 1];
    if (last && s.start <= last.end) last.end = Math.max(last.end, s.end);
    else out.push({ start: s.start, end: s.end });
  }
  return out;
}

/** `piece` minus the sorted, disjoint `awake` spans. `from` is the first span that can still overlap (spans are visited in order). */
function subtract(piece: Span, awake: readonly Span[], from: number): Span[] {
  const out: Span[] = [];
  let at = piece.start;
  for (let i = from; i < awake.length && awake[i].start < piece.end; i++) {
    if (awake[i].end <= at) continue;
    if (awake[i].start > at) out.push({ start: at, end: awake[i].start });
    at = Math.max(at, awake[i].end);
    if (at >= piece.end) break;
  }
  if (at < piece.end) out.push({ start: at, end: piece.end });
  return out;
}

/** Index of the first of the sorted, disjoint `spans` that ends after `time`. */
function firstEndingAfter(spans: readonly Span[], time: number): number {
  let lo = 0;
  let hi = spans.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (spans[mid].end > time) hi = mid;
    else lo = mid + 1;
  }
  return lo;
}

/**
 * Applies the rule above and returns every segment, staged ones untouched, sorted by start. Stage-less segments come
 * back clipped to what is left of them (a copy, same `type`), without overlaps among themselves.
 */
export function cleanUnstagedSleep<T extends SleepSegment>(
  segments: readonly T[],
  evidence: SleepEvidence,
): (T & { breakBefore?: boolean })[] {
  const staged: T[] = [];
  const unstaged: T[] = [];
  for (const s of segments) {
    if (s.stage) staged.push(s);
    else if (s.end > s.start) unstaged.push(s);
  }
  if (unstaged.length === 0) return [...segments].sort((a, b) => a.start - b.start || a.end - b.end) as (T & { breakBefore?: boolean })[];

  const awake = mergeSpans([
    ...evidence.workouts,
    ...evidence.spots.map((s) => ({ start: s.start - SPOT_MARGIN_SEC, end: s.end + SPOT_MARGIN_SEC })),
    ...evidence.activeMinutes.map((t) => ({ start: t, end: t + 60 })),
  ]);

  // Stage-less ranges overlap each other (two raw types for one night); an earlier-starting one keeps the time.
  unstaged.sort((a, b) => a.start - b.start || a.end - b.end);
  const pieces: (T & { breakBefore?: boolean })[] = [];
  let cursor = -Infinity;
  for (const seg of unstaged) {
    const start = Math.max(seg.start, cursor);
    if (start >= seg.end) continue;
    cursor = seg.end;
    for (const span of subtract({ start, end: seg.end }, awake, firstEndingAfter(awake, start))) {
      pieces.push({ ...seg, start: span.start, end: span.end });
    }
  }

  // Runs: pieces chained with gaps up to RUN_BRIDGE_SEC; short ones are not sleep.
  const kept: (T & { breakBefore?: boolean })[] = [...staged];
  let run: (T & { breakBefore?: boolean })[] = [];
  let runSec = 0;
  let reach = -Infinity;
  const closeRun = () => {
    if (runSec >= MIN_RUN_SEC) kept.push(...run);
    run = [];
    runSec = 0;
  };
  for (const piece of pieces) {
    if (run.length > 0 && piece.start - reach > RUN_BRIDGE_SEC) closeRun();
    run.push(piece);
    runSec += piece.end - piece.start;
    reach = piece.end;
  }
  closeRun();
  kept.sort((a, b) => a.start - b.start || a.end - b.end);

  // Where a workout or a long stretch of nothing separates stage-less sleep from what came before, a new session starts.
  const workouts = mergeSpans([...evidence.workouts]);
  for (let i = 1; i < kept.length; i++) {
    const seg = kept[i];
    if (seg.stage) continue;
    const prev = kept[i - 1];
    if (seg.start < prev.end) continue;
    const next = workouts[firstEndingAfter(workouts, prev.end)];
    const workoutBetween = next !== undefined && next.start < seg.start;
    if (workoutBetween || (!prev.stage && seg.start - prev.end > UNSTAGED_BREAK_SEC)) seg.breakBefore = true;
  }
  return kept;
}
