import type { RunSpec } from '../plans/types';

/**
 * The timeline of a walk/run session and where a wall clock stands in it. Wall-clock based like the lactate guide
 * (`features/lactate/guide.ts`): the phase is right after the app was in the background or restarted. Pure: `now` is a parameter.
 */

export type SegmentKind = 'warmup' | 'jog' | 'walk' | 'cooldown';

export interface Segment {
  kind: SegmentKind;
  /** Seconds after the start of the guide. */
  startSec: number;
  lengthSec: number;
}

/**
 * The segments of a session with a `walkRun` spec: the warm-up, then each jog with the walk after it, then the cool-down.
 * The walk after the last jog is not a segment of its own: it is the first part of the cool-down walk, so the total stays
 * the planned minutes and the person is not told to walk twice in a row. A session without a `walkRun` spec has none.
 */
export function runSegments(run: RunSpec | null): Segment[] {
  const spec = run?.walkRun;
  if (!spec) return [];
  const lengths: { kind: SegmentKind; lengthSec: number }[] = [];
  if (spec.warmupMin > 0) lengths.push({ kind: 'warmup', lengthSec: spec.warmupMin * 60 });
  for (let rep = 0; rep < spec.reps; rep++) {
    lengths.push({ kind: 'jog', lengthSec: spec.runSec });
    if (spec.walkSec > 0 && rep < spec.reps - 1) lengths.push({ kind: 'walk', lengthSec: spec.walkSec });
  }
  const cooldownSec = spec.cooldownMin * 60 + (spec.walkSec > 0 ? spec.walkSec : 0);
  if (cooldownSec > 0) lengths.push({ kind: 'cooldown', lengthSec: cooldownSec });
  let at = 0;
  return lengths.map((segment) => {
    const placed = { ...segment, startSec: at };
    at += segment.lengthSec;
    return placed;
  });
}

export const totalSec = (segments: readonly Segment[]): number => segments.reduce((sum, s) => sum + s.lengthSec, 0);

export interface GuidePosition {
  /** Index in the segment list; the last index once the guide is done. */
  index: number;
  segment: Segment | null;
  next: Segment | null;
  /** Seconds left in the current segment; 0 when done. */
  leftSec: number;
  elapsedSec: number;
  totalSec: number;
  done: boolean;
}

export function positionAt(segments: readonly Segment[], startedAt: number, nowMs: number): GuidePosition {
  const total = totalSec(segments);
  const elapsed = Math.max(0, Math.floor((nowMs - startedAt) / 1000));
  if (segments.length === 0 || elapsed >= total) {
    return { index: Math.max(0, segments.length - 1), segment: null, next: null, leftSec: 0, elapsedSec: Math.min(elapsed, total), totalSec: total, done: true };
  }
  let index = segments.findIndex((s) => elapsed < s.startSec + s.lengthSec);
  if (index < 0) index = segments.length - 1;
  const segment = segments[index]!;
  return { index, segment, next: segments[index + 1] ?? null, leftSec: segment.startSec + segment.lengthSec - elapsed, elapsedSec: elapsed, totalSec: total, done: false };
}

export type CueKind = Exclude<SegmentKind, 'warmup'> | 'done';

export interface TimedCue {
  /** Seconds after the start of the guide. */
  afterSec: number;
  kind: CueKind;
  /** Length of the segment that starts, seconds; 0 for `done`. */
  lengthSec: number;
}

/** The moments the phone says something: where each segment after the first begins, and the end. */
export function timedCues(segments: readonly Segment[]): TimedCue[] {
  const cues: TimedCue[] = segments.flatMap((s, i): TimedCue[] => (i === 0 || s.kind === 'warmup' ? [] : [{ afterSec: s.startSec, kind: s.kind, lengthSec: s.lengthSec }]));
  if (segments.length > 0) cues.push({ afterSec: totalSec(segments), kind: 'done', lengthSec: 0 });
  return cues;
}

/** Android: wait, vibrate, wait, vibrate in ms (iOS plays one buzz). Distinct patterns, so the wrist says jog, walk and "walk now" apart. */
export const VIBRATION: Record<'jog' | 'walk' | 'cooldown' | 'done' | 'hrWalk' | 'hrResume', readonly number[]> = {
  jog: [0, 200, 100, 200],
  walk: [0, 600],
  cooldown: [0, 600],
  done: [0, 200, 100, 200, 100, 200],
  hrWalk: [0, 500, 150, 500, 150, 500],
  hrResume: [0, 200, 100, 200],
};
