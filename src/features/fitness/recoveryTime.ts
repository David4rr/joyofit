import type { DayStrain } from '@/features/today/strain';

/**
 * Recovery time: hours until the body is ready for another hard session.
 *
 * Watch: the largest `recoveryHours` still running among the workouts of the last 7 days, each counted down from the
 * end of its workout (the watch reports recovery in minutes; `WorkoutRecord` stores hours). Recoveries do not add up:
 * the longest one decides.
 *
 * Estimate (JoyoFit's own heuristic, no published formula): without a watch value, hours from a day's strain: nothing
 * below strain 5, then 6 h at 5 rising linearly to 48 h at 21. Today's strain counts in full (the day is not over);
 * yesterday's counts down from midnight.
 */
const DAY_SEC = 86400;
const WATCH_WINDOW_DAYS = 7;
export const STRAIN_FREE_BELOW = 5;
const MIN_HOURS = 6;
const MAX_HOURS = 48;
const STRAIN_TOP = 21;

export interface RecoveryLeft {
  /** Hours still to go, 0 when recovered. */
  hoursLeft: number;
  source: 'watch' | 'estimate';
}

/** Hours of recovery a day's strain asks for (estimate). */
export function recoveryHoursFromStrain(strain: number): number {
  if (!(strain >= STRAIN_FREE_BELOW)) return 0;
  const share = Math.min(1, (strain - STRAIN_FREE_BELOW) / (STRAIN_TOP - STRAIN_FREE_BELOW));
  return MIN_HOURS + (MAX_HOURS - MIN_HOURS) * share;
}

export function recoveryLeft(input: {
  nowSec: number;
  dayStart: number;
  workouts: readonly { end: number; recoveryHours?: number }[];
  strain: readonly Pick<DayStrain, 'day' | 'strain'>[];
}): RecoveryLeft | null {
  const { nowSec, dayStart, workouts, strain } = input;

  const withWatch = workouts.filter(
    (w) => typeof w.recoveryHours === 'number' && w.recoveryHours > 0 && w.end <= nowSec && w.end >= nowSec - WATCH_WINDOW_DAYS * DAY_SEC,
  );
  if (withWatch.length > 0) {
    const left = Math.max(...withWatch.map((w) => (w.recoveryHours as number) - (nowSec - w.end) / 3600));
    return { hoursLeft: Math.max(0, left), source: 'watch' };
  }

  const todayStrain = strain.find((d) => d.day === dayStart)?.strain;
  const yesterdayStrain = strain.find((d) => d.day === dayStart - DAY_SEC)?.strain;
  if (todayStrain === undefined && yesterdayStrain === undefined) return null;
  const today = todayStrain === undefined ? 0 : recoveryHoursFromStrain(todayStrain);
  const yesterday = yesterdayStrain === undefined ? 0 : recoveryHoursFromStrain(yesterdayStrain) - (nowSec - dayStart) / 3600;
  return { hoursLeft: Math.max(0, today, yesterday), source: 'estimate' };
}
