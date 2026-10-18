import type { HrvReadingRow } from '@/db/queries';
import { t } from '@/i18n';
import { meanSd } from '@/features/today/recovery';

/**
 * HRV status: the mean ln(RMSSD) of the last 7 nights against your own range, after Plews (2013) and Buchheit (2014).
 * The range is the mean of the night readings of the 60 days before that week, plus and minus one standard deviation;
 * the week itself is left out so a drop does not pull its own baseline down (this is `recovery.ts`'s baseline arithmetic,
 * `meanSd`, over a longer window). Night readings only, so it needs the watch's overnight HRV: Android.
 *
 *  - balanced: the 7-night mean is inside the range.
 *  - low: below the range.
 *  - unbalanced: above the range. A week well above your usual is not a sign of better recovery by itself; it often follows illness or a break.
 *
 * Needs 3 nights in the last 7 and 14 in the baseline. The spread has a floor of 0.05 in ln units (about 5 %), or a few
 * near-identical nights would call every small change low.
 */
export const RECENT_DAYS = 7;
export const BASELINE_DAYS = 60;
export const MIN_RECENT_NIGHTS = 3;
export const MIN_BASELINE_NIGHTS = 14;
export const SD_FLOOR = 0.05;

export type HrvState = 'balanced' | 'unbalanced' | 'low';

export interface HrvStatus {
  state: HrvState;
  /** Milliseconds: the 7-night mean (back from ln), the baseline mean, and the range edges. */
  recentMs: number;
  baselineMs: number;
  lowMs: number;
  highMs: number;
  recentNights: number;
  baselineNights: number;
}

export type HrvStatusState = { status: HrvStatus } | { missing: string };

const DAY_SEC = 86400;

/** `readings` in any order; only `source: 'night'` counts. */
export function hrvStatus(readings: readonly HrvReadingRow[], nowSec: number): HrvStatusState {
  const nights = readings.filter((r) => r.source === 'night' && r.rmssd > 0 && r.end <= nowSec);
  const recent = nights.filter((r) => r.end > nowSec - RECENT_DAYS * DAY_SEC);
  const baseline = nights.filter((r) => r.end <= nowSec - RECENT_DAYS * DAY_SEC && r.end > nowSec - (RECENT_DAYS + BASELINE_DAYS) * DAY_SEC);
  if (baseline.length < MIN_BASELINE_NIGHTS) {
    return { missing: t('health:fitness.hrvMissing.baseline', { have: baseline.length, need: MIN_BASELINE_NIGHTS }) };
  }
  if (recent.length < MIN_RECENT_NIGHTS) {
    return { missing: t('health:fitness.hrvMissing.recent', { have: recent.length, need: MIN_RECENT_NIGHTS }) };
  }
  const base = meanSd(baseline.map((r) => Math.log(r.rmssd)));
  const sd = Math.max(base.sd, SD_FLOOR);
  const recentMean = meanSd(recent.map((r) => Math.log(r.rmssd))).mean;
  const lo = base.mean - sd;
  const hi = base.mean + sd;
  const state: HrvState = recentMean < lo ? 'low' : recentMean > hi ? 'unbalanced' : 'balanced';
  return {
    status: {
      state,
      recentMs: Math.exp(recentMean),
      baselineMs: Math.exp(base.mean),
      lowMs: Math.exp(lo),
      highMs: Math.exp(hi),
      recentNights: recent.length,
      baselineNights: baseline.length,
    },
  };
}
