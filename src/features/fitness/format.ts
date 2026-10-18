import { fmtDuration, fmtInt, t } from '@/i18n';

/** Where a number comes from, shown next to it: the watch measured it, or JoyoFit worked it out. */
export type Source = 'watch' | 'estimate';

export function sourceLabel(source: Source): string {
  return t(`health:fitness.source.${source}`);
}

/** `1 j 05 mnt` for 3900 s; `45 mnt` under an hour (`1 h 05 min` / `45 min` in English). */
export function formatHm(totalSec: number): string {
  return fmtDuration(totalSec);
}

/** Recovery left: `Sudah pulih` at under half an hour, else whole hours (`14 j`). */
export function formatRecovery(hoursLeft: number): { value: string; unit: string | undefined } {
  if (hoursLeft < 0.5) return { value: t('health:fitness.recovery.done'), unit: undefined };
  return { value: fmtInt(hoursLeft), unit: t('health:fitness.recovery.unit') };
}

/** `52:07` under an hour, `1:52:07` from an hour on. */
export function formatRaceTime(totalSec: number): string {
  const s = Math.round(totalSec);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const mm = h > 0 ? String(m).padStart(2, '0') : String(m);
  return `${h > 0 ? `${h}:` : ''}${mm}:${String(sec).padStart(2, '0')}`;
}
