import { buildNights } from '@/features/sleep/nights';
import { BASE_SLEEP_NEED_SEC, sleepDebtSec, sleepNeedSec } from '@/features/today/readiness';
import type { SleepSegment } from '@/wear';

/**
 * How much sleep tonight needs: `readiness.ts`'s need (7 h 30 min base, plus up to 1 h from today's strain / 21) plus a
 * quarter of the sleep debt of the last 7 nights, at most 1 h. The strain and debt terms are JoyoFit's heuristic; there is
 * no published formula for them.
 */
export const DEBT_NIGHTS = 7;
const DAY_SEC = 86400;

export interface SleepNeedTonight {
  needSec: number;
  baseSec: number;
  /** What today's strain added. */
  strainExtraSec: number;
  /** What the debt added; 0 when there is no debt or too few nights to tell. */
  debtExtraSec: number;
  /** Total shortfall over the nights counted; null with too few nights. */
  debtSec: number | null;
  /** Nights with a sleep record behind the debt. */
  nights: number;
}

/** Seconds actually asleep per night (naps left out) of the last `DEBT_NIGHTS` days, newest first. */
export function recentNightsAsleep(segments: readonly SleepSegment[], nowSec: number): number[] {
  return buildNights(segments, [])
    .filter((n) => !n.nap && n.end > nowSec - DEBT_NIGHTS * DAY_SEC && n.end <= nowSec)
    .map((n) => n.asleepSeconds);
}

export function sleepNeedTonight(input: { todayStrain: number | null; nightsAsleepSec: readonly number[] }): SleepNeedTonight {
  const { todayStrain, nightsAsleepSec } = input;
  const debtSec = sleepDebtSec(nightsAsleepSec);
  const withStrain = sleepNeedSec(todayStrain);
  const needSec = sleepNeedSec(todayStrain, debtSec ?? 0);
  return {
    needSec,
    baseSec: BASE_SLEEP_NEED_SEC,
    strainExtraSec: withStrain - BASE_SLEEP_NEED_SEC,
    debtExtraSec: needSec - withStrain,
    debtSec,
    nights: nightsAsleepSec.length,
  };
}
