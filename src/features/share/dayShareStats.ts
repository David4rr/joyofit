import type { Readiness } from '@/features/today/readiness';
import type { SleepSummary } from '@/features/today/stats';
import { STRAIN_MAX, type DayStrain } from '@/features/today/strain';
import { formatCount } from '@/format';
import type { ShareStat } from '@/features/share/shareStats';

export interface DayShareInput {
  steps: number;
  sleep: SleepSummary | null;
  readiness: Readiness;
  strain: DayStrain | null;
}

/** `7h 12m`, or `42m` under an hour: short enough for one cell of the card. */
export function formatSleepShort(seconds: number): string {
  const minutes = Math.round(seconds / 60);
  return minutes >= 60 ? `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, '0')}m` : `${minutes}m`;
}

/**
 * The numbers of the Today card, steps first. Sleep excludes awake time when the watch staged it, like the Today screen.
 * A score that cannot be computed yet is left out instead of shown as a dash.
 */
export function buildDayShareStats({ steps, sleep, readiness, strain }: DayShareInput): ShareStat[] {
  const stats: ShareStat[] = [{ key: 'steps', label: 'Steps', value: formatCount(steps), unit: 'steps' }];
  if (sleep) {
    const awake = sleep.byStage.find((entry) => entry.stage === 'awake')?.seconds ?? 0;
    const asleep = sleep.byStage.length > 0 ? sleep.totalSeconds - awake : sleep.totalSeconds;
    stats.push({ key: 'sleep', label: 'Sleep', value: formatSleepShort(asleep) });
  }
  if (readiness.recovery) {
    stats.push({ key: 'recovery', label: 'Recovery', value: String(readiness.recovery.percent), unit: '%' });
  }
  if (strain) {
    stats.push({ key: 'strain', label: 'Strain', value: strain.strain.toFixed(1), unit: `/ ${STRAIN_MAX}` });
  }
  if (readiness.headline) {
    stats.push({ key: 'readiness', label: 'Readiness', value: readiness.headline });
  }
  return stats;
}

/** `Saturday, Oct 17`, in the phone's locale. Unix milliseconds. */
export function formatShareDay(ms: number): string {
  return new Date(ms).toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' });
}
