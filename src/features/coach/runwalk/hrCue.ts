import { zoneIndex, type HrZones } from '@/features/hrzones/zones';
import { RUNWALK_RESUME_ZONE } from '../plans/runWalk';
import type { HrZone } from '../plans/types';
import type { SegmentKind } from './timeline';

/**
 * The heart-rate cue of a Lari-jalan jog, from the live heart rate the watch sends (one reading about every second).
 *
 *  - While the jog segment runs, a heart rate in `walkAtZone` or above for `HIGH_HOLD_MS` in a row cues "walk now" (once:
 *    a single high reading, a strap slip or a hill does not). The person's own zones decide the bpm.
 *  - After that cue, a heart rate in `RUNWALK_RESUME_ZONE` or below for `LOW_HOLD_MS` in a row cues "you can jog again".
 *  - A new segment starts clean. Walk and warm-up segments never cue.
 * The cues are advice for how you feel; the plan's own timeline keeps running underneath.
 */

export const HIGH_HOLD_MS = 8_000;
export const LOW_HOLD_MS = 10_000;
/** A reading older than this is not a live heart rate any more (the watch went quiet or the link dropped). */
export const STALE_HR_MS = 10_000;

export type HrCue = 'walk' | 'resume';

export interface HrCueState {
  /** Index of the segment this state belongs to; a different index starts over. */
  segmentIndex: number;
  /** When the heart rate first reached the walk zone in the current stretch of high readings. */
  highSince: number | null;
  /** The walk cue was given and the heart rate has not come back down yet. */
  walking: boolean;
  /** When the heart rate first fell back to the resume zone in the current stretch. */
  lowSince: number | null;
}

export const FRESH_HR_STATE: HrCueState = { segmentIndex: -1, highSince: null, walking: false, lowSince: null };

export interface HrCueInput {
  /** The live heart rate, null when there is none or it is stale. */
  hr: number | null;
  nowMs: number;
  zones: Pick<HrZones, 'bounds'>;
  walkAtZone: HrZone;
  segmentKind: SegmentKind | null;
  segmentIndex: number;
}

export function nextHrCue(state: HrCueState, input: HrCueInput): { state: HrCueState; cue: HrCue | null } {
  if (input.segmentKind !== 'jog') return { state: { ...FRESH_HR_STATE, segmentIndex: input.segmentIndex }, cue: null };
  const current = state.segmentIndex === input.segmentIndex ? state : { ...FRESH_HR_STATE, segmentIndex: input.segmentIndex };
  if (input.hr === null) return { state: current, cue: null };

  const zone = zoneIndex(input.hr, input.zones);
  if (!current.walking) {
    if (zone < input.walkAtZone) return { state: { ...current, highSince: null }, cue: null };
    const highSince = current.highSince ?? input.nowMs;
    if (input.nowMs - highSince >= HIGH_HOLD_MS) return { state: { ...current, highSince: null, walking: true, lowSince: null }, cue: 'walk' };
    return { state: { ...current, highSince }, cue: null };
  }

  if (zone > RUNWALK_RESUME_ZONE) return { state: { ...current, lowSince: null }, cue: null };
  const lowSince = current.lowSince ?? input.nowMs;
  if (input.nowMs - lowSince >= LOW_HOLD_MS) return { state: { ...current, walking: false, lowSince: null, highSince: null }, cue: 'resume' };
  return { state: { ...current, lowSince }, cue: null };
}

/** The live heart rate if it is recent enough to act on. */
export function liveHr(reading: { heartRate: number | null; updatedAt: number; status: string } | null, nowMs: number): number | null {
  if (!reading || reading.status !== 'running' || reading.heartRate === null || reading.heartRate <= 0) return null;
  return nowMs - reading.updatedAt <= STALE_HR_MS ? reading.heartRate : null;
}

export type BandStatus = 'below' | 'in' | 'above';

/** Where a heart rate sits against a band of bpm, for the re-test's "hold this rate". */
export function bandStatus(hr: number, from: number, to: number): BandStatus {
  return hr < from ? 'below' : hr > to ? 'above' : 'in';
}
