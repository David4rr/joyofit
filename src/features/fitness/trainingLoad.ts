import type { DayStrain } from '@/features/today/strain';

/**
 * Training load balance: the acute:chronic workload ratio (Gabbett 2016, BJSM) on TRIMP, the unit `dailyStrain` sums
 * before it saturates into the 0..21 strain. The acute load is the mean daily TRIMP of the last 7 days, the chronic
 * load the mean daily TRIMP of the last 28 (or of the days since the first one with heart rate, when the history is
 * shorter). Today is left out: it is not over. Days without stored heart rate count as rest. This one function feeds
 * the Readiness signal and the Kebugaran training status, so the two cannot disagree.
 *
 * Status bands are JoyoFit's, anchored on the published cut points (0.8 to 1.3 as the sweet spot, above 1.5 as the high
 * injury-risk zone): above 1.5 overreaching, 1.1 to 1.5 productive, 0.8 to 1.1 maintaining, 0.5 to 0.8 recovery, below
 * 0.5 detraining.
 */
export const ACUTE_DAYS = 7;
export const CHRONIC_DAYS = 28;
/** Days with heart rate the ratio needs before it is shown. */
export const MIN_LOAD_DAYS = 14;

const DAY_SEC = 86400;

export type TrainingStatus = 'productive' | 'maintaining' | 'recovery' | 'overreaching' | 'detraining';

export type LoadBalance =
  | {
      kind: 'ok';
      /** Mean daily TRIMP over the last 7 days. */
      acute: number;
      /** Mean daily TRIMP over the last 28 days (or the shorter span with data). */
      chronic: number;
      ratio: number;
      status: TrainingStatus;
      daysWithData: number;
    }
  | { kind: 'short'; daysWithData: number }
  | { kind: 'none'; daysWithData: number };

export function statusOfRatio(ratio: number): TrainingStatus {
  if (ratio > 1.5) return 'overreaching';
  if (ratio > 1.1) return 'productive';
  if (ratio >= 0.8) return 'maintaining';
  if (ratio >= 0.5) return 'recovery';
  return 'detraining';
}

/** ACWR on TRIMP at `dayStart` (local midnight, unix seconds) from per-day load, in any order. */
export function loadBalance(days: readonly Pick<DayStrain, 'day' | 'trimp'>[], dayStart: number): LoadBalance {
  const window = days
    .filter((d) => d.day < dayStart && d.day >= dayStart - CHRONIC_DAYS * DAY_SEC)
    .sort((a, b) => a.day - b.day);
  if (window.length < MIN_LOAD_DAYS) return { kind: 'short', daysWithData: window.length };
  const sum = (from: number) => window.filter((d) => d.day >= from).reduce((a, d) => a + d.trimp, 0);
  const acute = sum(dayStart - ACUTE_DAYS * DAY_SEC) / ACUTE_DAYS;
  // Over the days since the first one with heart rate, so a short history is not diluted by days before it.
  const span = Math.min(CHRONIC_DAYS, Math.round((dayStart - window[0].day) / DAY_SEC));
  const chronic = sum(dayStart - CHRONIC_DAYS * DAY_SEC) / span;
  if (chronic <= 0) return { kind: 'none', daysWithData: window.length };
  const ratio = acute / chronic;
  return { kind: 'ok', acute, chronic, ratio, status: statusOfRatio(ratio), daysWithData: window.length };
}
