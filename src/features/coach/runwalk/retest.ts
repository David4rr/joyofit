import { RETEST_DISTANCE_M } from '../plans/runWalk';

/**
 * The 1 km re-test of Lari-jalan: run 1 km holding the heart rate of zone 3 and note the pace. The heart rate is held fixed
 * and the pace is the outcome, so a faster pace at the same rate at the next test means more fitness. The first test is the
 * baseline; the next ones are shown against it.
 *
 *  - The time is the phone's own clock from the tap that starts the km to the end of it. The end is the moment the watch's
 *    live distance has grown by 1 km since the start, or a tap on "1 km done" when there is no live distance. With a live
 *    distance the pace is time over the measured distance (so a tap at 1.02 km is not counted as 1 km); with none, the km is
 *    assumed to be exactly 1 km and the result says so (`measured: 'tap'`).
 *  - The average heart rate is the mean of the live readings during the km; null when fewer than `MIN_HR_READINGS` came.
 *  - Two tests compare on pace only when both have an average heart rate and the two differ by at most `COMPARABLE_HR_GAP`
 *    bpm; otherwise the comparison says the rate was not the same and shows no verdict.
 *  - Kept on the phone (not in the synced coach document).
 */

export const MIN_HR_READINGS = 10;
export const COMPARABLE_HR_GAP = 5;
/** A live distance this close to the target or beyond is measured; shorter (a tap at 600 m) falls back to the assumed km. */
const MIN_MEASURED_M = 0.95 * RETEST_DISTANCE_M;
const MAX_RESULTS = 24;

export interface RetestResult {
  planId: string;
  /** `<planId>:<week>:<slot>` of the plan session. */
  sessionKey: string;
  /** When the km ended, ms. */
  at: number;
  /** Seconds per km. */
  secKm: number;
  /** Mean live heart rate during the km, bpm; null when too few readings. */
  avgHr: number | null;
  /** The bpm band of zone 3 the person was asked to hold, as it was when the test ran. */
  fromBpm: number;
  toBpm: number;
  /** `gps`: the watch's live distance measured the km; `tap`: the person tapped at the end and 1 km is assumed. */
  measured: 'gps' | 'tap';
}

export interface RetestMeasure {
  startedAt: number;
  endedAt: number;
  /** Live distance gained between the start and the end, metres; null without a live distance. */
  distanceM: number | null;
  hrSum: number;
  hrCount: number;
}

export function finishRetest(
  measure: RetestMeasure,
  meta: Pick<RetestResult, 'planId' | 'sessionKey' | 'fromBpm' | 'toBpm'>,
): RetestResult {
  const sec = Math.max(1, (measure.endedAt - measure.startedAt) / 1000);
  const gps = measure.distanceM !== null && measure.distanceM >= MIN_MEASURED_M;
  const meters = gps ? (measure.distanceM as number) : RETEST_DISTANCE_M;
  return {
    ...meta,
    at: measure.endedAt,
    secKm: Math.round((sec * 1000) / meters),
    avgHr: measure.hrCount >= MIN_HR_READINGS ? Math.round(measure.hrSum / measure.hrCount) : null,
    measured: gps ? 'gps' : 'tap',
  };
}

export interface RetestStep {
  result: RetestResult;
  /** Seconds per km against the first test; negative is faster. Null for the first test. */
  deltaSecKm: number | null;
  /** The heart rates were close enough for the pace to compare (false for the first test, which has nothing to compare to). */
  comparable: boolean;
}

/** The tests of one plan, oldest first, each against the first. */
export function retestHistory(results: readonly RetestResult[], planId: string): RetestStep[] {
  const mine = results.filter((r) => r.planId === planId).sort((a, b) => a.at - b.at);
  const first = mine[0];
  if (!first) return [];
  return mine.map((result, i) => {
    if (i === 0) return { result, deltaSecKm: null, comparable: false };
    const comparable = first.avgHr !== null && result.avgHr !== null && Math.abs(result.avgHr - first.avgHr) <= COMPARABLE_HR_GAP;
    return { result, deltaSecKm: comparable ? result.secKm - first.secKm : null, comparable };
  });
}

export function parseRetests(raw: string | null): RetestResult[] {
  if (raw === null) return [];
  try {
    const list: unknown = JSON.parse(raw);
    if (!Array.isArray(list)) return [];
    return list.filter(isResult).slice(-MAX_RESULTS);
  } catch {
    return [];
  }
}

/** A result saved for the same plan session replaces the old one (a repeated test), else it is added. */
export function withResult(results: readonly RetestResult[], result: RetestResult): RetestResult[] {
  return [...results.filter((r) => r.sessionKey !== result.sessionKey), result].slice(-MAX_RESULTS);
}

function isResult(value: unknown): value is RetestResult {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  const num = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
  return (
    typeof v.planId === 'string' &&
    typeof v.sessionKey === 'string' &&
    num(v.at) &&
    num(v.secKm) &&
    v.secKm > 0 &&
    (v.avgHr === null || num(v.avgHr)) &&
    num(v.fromBpm) &&
    num(v.toBpm) &&
    (v.measured === 'gps' || v.measured === 'tap')
  );
}
