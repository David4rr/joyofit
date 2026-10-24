/**
 * An LTHR estimate that needs no test: the hardest 20 minutes of a recent run. Joe Friel's 20-minute field test gives the threshold heart rate
 * as 95 % of the average heart rate of a 20-minute all-out effort (Friel, "The Triathlete's Training Bible"; the same figure TrainingPeaks
 * documents for the 20-minute test). A normal run is rarely all-out, so the estimate is only offered when the window averages at least 80 %
 * of the maximum heart rate; an easy run would understate the threshold. The 30-minute time trial (`trial.ts`) stays the accurate way.
 * Pure: the caller loads the runs and their points.
 */
import { gearSport } from '@/features/gear/model';

import { hardestMeasureWindow, type TrialPoint } from './trial';

/** Only runs of the last 6 weeks count: fitness moves. */
export const RUN_LOOKBACK_DAYS = 42;
/** Friel: LTHR is 95 % of the average heart rate of a 20-minute hard effort. */
export const LTHR_SHARE_OF_20_MIN = 0.95;
/** The hardest window must average at least this share of the maximum heart rate to be taken for a hard effort. */
export const MIN_WINDOW_SHARE_OF_MAX = 0.8;

export interface HardestRunInput {
  workoutId: number;
  /** Unix seconds the run started. */
  start: number;
  /** Huawei sport type of the workout. */
  sportType: number;
  points: readonly TrialPoint[];
}

export interface HardestRunEstimate {
  lthr: number;
  /** Mean heart rate of the hardest 20 minutes, whole bpm. */
  windowMeanHr: number;
  /** Unix seconds the run started (shown as its date). */
  at: number;
  workoutId: number;
}

/** Whether a Huawei sport type is a run (outdoor, treadmill, trail), the only sports this estimate looks at. */
export const isRunSport = (sportType: number): boolean => gearSport(sportType) === 'run';

/**
 * The estimate from the hardest 20-minute window across `runs` started within the last 42 days of `nowSec`, or null when there is none:
 * no run with heart-rate coverage of a window (the first 10 minutes of a run never count), or the best window is under 80 % of `maxHr`.
 */
export function lthrFromHardestRun(runs: readonly HardestRunInput[], maxHr: number, nowSec: number): HardestRunEstimate | null {
  const since = nowSec - RUN_LOOKBACK_DAYS * 86_400;
  let best: { meanHr: number; run: HardestRunInput } | null = null;
  for (const run of runs) {
    if (!isRunSport(run.sportType) || run.start < since) continue;
    const window = hardestMeasureWindow(run.points);
    if (window && (!best || window.meanHr > best.meanHr)) best = { meanHr: window.meanHr, run };
  }
  if (!best || best.meanHr < maxHr * MIN_WINDOW_SHARE_OF_MAX) return null;
  return {
    lthr: Math.min(maxHr, Math.round(best.meanHr * LTHR_SHARE_OF_20_MIN)),
    windowMeanHr: Math.round(best.meanHr),
    at: best.run.start,
    workoutId: best.run.workoutId,
  };
}
