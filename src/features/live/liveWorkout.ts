import { fmtDecimal, fmtInt, t } from '@/i18n';
import type { LiveWorkout } from '@/wear';

/** Workout time now: the watch's last figure plus the time since it, while running (the watch pushes about every second). */
export function elapsedSec(live: LiveWorkout, nowMs: number): number {
  const base = live.durationSec ?? 0;
  if (live.status !== 'running' || live.durationSec === null) return base;
  // Capped so a stalled stream (link lost) does not keep counting for minutes.
  return base + Math.min(Math.max(0, (nowMs - live.updatedAt) / 1000), MAX_EXTRAPOLATE_SEC);
}

const MAX_EXTRAPOLATE_SEC = 30;

/** Pace suits running and walking (per km), speed suits cycling. Huawei types: 3 cycling, 7 indoor cycling. */
export function prefersSpeed(live: LiveWorkout): boolean {
  return live.sportType === 3 || live.sportType === 7;
}

/** `5.2 g` under 10 g, whole grams above. */
export function formatGrams(grams: number): string {
  return grams < 10 ? fmtDecimal(grams, 1) : fmtInt(grams);
}

/** Distance as a tile shows it: `850` m, then `1.24` km. */
export function distanceParts(meters: number): { value: string; unit: string } {
  return meters >= 1000 ? { value: fmtDecimal(meters / 1000, 2), unit: 'km' } : { value: fmtInt(meters), unit: 'm' };
}

/** `5:32` (minutes per km) */
export function paceValue(secPerKm: number): string {
  const total = Math.round(secPerKm);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

/** The status as the screen words it, in the app language. */
export function statusLabel(status: LiveWorkout['status']): string {
  return t(`sharing:live.status.${status}`);
}

/** True while the watch is still recording (the live screen and the Today banner show it). */
export function isActive(live: LiveWorkout | null): live is LiveWorkout {
  return live !== null && live.status !== 'ended';
}

/**
 * Huawei's five zones by share of maximum heart rate (50, 60, 70, 80, 90 %; `HeartRateThresholdConfig`), named the way
 * Huawei Health names them. Below 50 % is no zone.
 */
export function heartZone(heartRate: number, maxHeartRate: number): { zone: number; label: string } | null {
  const pct = heartRate / maxHeartRate;
  if (pct < 0.5) return null;
  if (pct < 0.6) return { zone: 1, label: t('sharing:live.zones.warmup') };
  if (pct < 0.7) return { zone: 2, label: t('sharing:live.zones.fatBurning') };
  if (pct < 0.8) return { zone: 3, label: t('sharing:live.zones.aerobic') };
  if (pct < 0.9) return { zone: 4, label: t('sharing:live.zones.anaerobic') };
  return { zone: 5, label: t('sharing:live.zones.extreme') };
}
