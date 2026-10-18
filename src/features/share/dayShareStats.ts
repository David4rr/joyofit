import { headlineLabel, type Readiness } from '@/features/today/readiness';
import type { SleepSummary } from '@/features/today/stats';
import { STRAIN_MAX, type DayStrain } from '@/features/today/strain';
import { fmtDate, fmtDecimal, fmtInt, t } from '@/i18n';
import type { ShareStat } from '@/features/share/shareStats';

export interface DayShareInput {
  steps: number;
  sleep: SleepSummary | null;
  readiness: Readiness;
  strain: DayStrain | null;
}

/** `7j 12mnt` / `7h 12m`, or `42mnt` under an hour: short enough for one cell of the card. */
export function formatSleepShort(seconds: number): string {
  const minutes = Math.round(seconds / 60);
  return minutes >= 60
    ? t('sharing:share.sleepShort.hm', { h: Math.floor(minutes / 60), m: String(minutes % 60).padStart(2, '0') })
    : t('sharing:share.sleepShort.m', { m: minutes });
}

/**
 * The numbers of the Today card, steps first. Sleep excludes awake time when the watch staged it, like the Today screen.
 * A score that cannot be computed yet is left out instead of shown as a dash.
 */
export function buildDayShareStats({ steps, sleep, readiness, strain }: DayShareInput): ShareStat[] {
  const stats: ShareStat[] = [{ key: 'steps', label: t('sharing:share.stats.steps'), value: fmtInt(steps), unit: t('sharing:share.units.steps') }];
  if (sleep) {
    const awake = sleep.byStage.find((entry) => entry.stage === 'awake')?.seconds ?? 0;
    const asleep = sleep.byStage.length > 0 ? sleep.totalSeconds - awake : sleep.totalSeconds;
    stats.push({ key: 'sleep', label: t('sharing:share.stats.sleep'), value: formatSleepShort(asleep) });
  }
  if (readiness.recovery) {
    stats.push({ key: 'recovery', label: t('sharing:share.stats.recovery'), value: fmtInt(readiness.recovery.percent), unit: '%' });
  }
  if (strain) {
    stats.push({ key: 'strain', label: t('sharing:share.stats.strain'), value: fmtDecimal(strain.strain, 1), unit: t('sharing:share.units.strainMax', { max: STRAIN_MAX }) });
  }
  if (readiness.headline) {
    stats.push({ key: 'readiness', label: t('sharing:share.stats.readiness'), value: headlineLabel(readiness.headline) });
  }
  return stats;
}

/** `Sabtu, 17 Okt` / `Saturday, Oct 17`, in the app language. Unix milliseconds. */
export function formatShareDay(ms: number): string {
  return fmtDate(new Date(ms), 'weekday');
}
