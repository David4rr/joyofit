import type { WorkoutRow } from '@/db/queries';
import { fmtClock, fmtDate, fmtDecimal, fmtInt, t } from '@/i18n';
import { formatElapsed, type WorkoutSummary } from '@/features/workouts/summary';
import { averagePaceSec, averageSpeedMs, workoutTimes } from '@/features/workouts/times';

export type ShareStatKey =
  | 'distance'
  | 'time'
  | 'pace'
  | 'speed'
  | 'hr'
  | 'calories'
  | 'elevation'
  | 'steps'
  | 'sleep'
  | 'recovery'
  | 'strain'
  | 'readiness';

/** One number on the share image; the unit is drawn smaller next to the value. */
export interface ShareStat {
  key: ShareStatKey;
  label: string;
  value: string;
  unit?: string;
}

/** How a sport reports its average effort: swimming per 100 m, running and walking per km, the rest as km/h. */
export type EffortKind = 'pace100m' | 'paceKm' | 'speed';

/** Matched against the watch's English sport name, like `sportIcon`. */
export function effortKind(sportName: string): EffortKind {
  if (/swim|diving|apnea|scuba/i.test(sportName)) return 'pace100m';
  if (/walk|hik|run|trail/i.test(sportName)) return 'paceKm';
  return 'speed';
}

/** Longer than an hour per unit means the watch had no real movement to average over. */
const MAX_PACE_SEC = 3600;
/** Below this the average over distance and time is mostly GPS noise. */
const MIN_DERIVED_SECONDS = 30;

/**
 * The sport's average pace or speed, as Strava computes it: the watch's distance over the moving time (see
 * `workoutTimes`), the watch's own figure only when the workout has no usable distance or time.
 */
export function effortStat(workout: WorkoutRow, summary: WorkoutSummary): ShareStat | null {
  const kind = effortKind(workout.sportName);
  const { movingSec } = workoutTimes(workout);
  const derivable = movingSec >= MIN_DERIVED_SECONDS;
  if (kind === 'speed') {
    const metersPerSecond = (derivable ? averageSpeedMs(workout.distance, movingSec) : null) ?? summary.avgSpeed;
    if (metersPerSecond === undefined || metersPerSecond === null || !(metersPerSecond > 0)) return null;
    return { key: 'speed', label: t('sharing:share.stats.avgSpeed'), value: fmtDecimal(metersPerSecond * 3.6, 1), unit: 'km/h' };
  }
  const per100 = kind === 'pace100m';
  const watchPace = per100 ? summary.avgPaceSecPer100m : summary.avgPaceSecPerKm;
  const pace = (derivable ? averagePaceSec(workout.distance, movingSec, per100 ? 100 : 1000) : null) ?? watchPace;
  if (pace === undefined || pace === null || !(pace > 0) || pace > MAX_PACE_SEC) return null;
  return { key: 'pace', label: t('sharing:share.stats.avgPace'), value: formatElapsed(pace), unit: per100 ? t('sharing:share.units.per100m') : t('sharing:share.units.perKm') };
}

/**
 * The numbers worth putting on a share image, in display order: distance (or time when there is no distance)
 * leads. Every field the workout does not have is left out rather than shown as a dash.
 */
export function buildShareStats(workout: WorkoutRow, summary: WorkoutSummary): ShareStat[] {
  const stats: ShareStat[] = [];
  if (workout.distance > 0) {
    const km = workout.distance >= 1000;
    stats.push({
      key: 'distance',
      label: t('sharing:share.stats.distance'),
      value: km ? fmtDecimal(workout.distance / 1000, 2) : fmtInt(workout.distance),
      unit: km ? 'km' : 'm',
    });
  }
  const { movingSec } = workoutTimes(workout);
  if (movingSec > 0) {
    stats.push({ key: 'time', label: t('sharing:share.stats.time'), value: formatElapsed(movingSec) });
  }
  const effort = effortStat(workout, summary);
  if (effort) stats.push(effort);
  if (workout.avgHr !== null && workout.avgHr > 0) {
    stats.push({ key: 'hr', label: t('sharing:share.stats.avgHr'), value: fmtInt(workout.avgHr), unit: 'bpm' });
  }
  if (workout.calories > 0) {
    stats.push({ key: 'calories', label: t('sharing:share.stats.calories'), value: fmtInt(workout.calories), unit: 'kcal' });
  }
  if (summary.elevationGain !== undefined && summary.elevationGain >= 1) {
    stats.push({ key: 'elevation', label: t('sharing:share.stats.elevation'), value: fmtInt(summary.elevationGain), unit: 'm' });
  }
  return stats;
}

/** `12 Okt 2026 · 07.30` / `Oct 12, 2026 · 7:30 AM`, in the app language. Unix seconds, local time. */
export function formatShareDate(sec: number): string {
  return `${fmtDate(sec, 'medium')} · ${fmtClock(sec)}`;
}
