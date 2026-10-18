import type { FamilyRules } from '@/cloud/family';
import { clockOf } from '@/features/family/format';
import { t } from '@/i18n';

/** The ranges the Worker accepts (`rulesSchema` in `server/src/family/types.ts`). */
export const NO_SYNC_HOURS = { min: 3, max: 48 } as const;
export const NO_STEPS_HOUR = { min: 9, max: 14 } as const;
/** Quiet hours move in half hours. */
export const QUIET_STEP_MIN = 30;
/** What the Worker starts with, and what a bad quiet time falls back to. */
export const DEFAULT_QUIET = { quietStart: '21:30', quietEnd: '06:30' } as const;

const DAY_MIN = 24 * 60;

/** A whole number of hours inside the range; a value that is not a number falls to the low end. */
export function clampHours(hours: number, range: { min: number; max: number }): number {
  const whole = Number.isFinite(hours) ? Math.round(hours) : range.min;
  return Math.min(range.max, Math.max(range.min, whole));
}

const CLOCK = /^([01]\d|2[0-3]):([0-5]\d)$/;

export const isClock = (value: string) => CLOCK.test(value);

/** `HH:MM` moved by `deltaMin` minutes, wrapping around midnight (`00:00` minus 30 is `23:30`). */
export function shiftClock(value: string, deltaMin: number): string {
  const [h, m] = value.split(':').map(Number);
  const total = (((h * 60 + m + deltaMin) % DAY_MIN) + DAY_MIN) % DAY_MIN;
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

/**
 * Rules as the Worker will take them: hours inside their ranges, quiet hours that are valid times (a bad one falls back
 * to `fallback`'s). The rest passes through.
 */
export function normalizeRules(rules: FamilyRules, fallback: Pick<FamilyRules, 'quietStart' | 'quietEnd'>): FamilyRules {
  return {
    ...rules,
    noSync: { ...rules.noSync, hours: clampHours(rules.noSync.hours, NO_SYNC_HOURS) },
    noSteps: { ...rules.noSteps, hour: clampHours(rules.noSteps.hour, NO_STEPS_HOUR) },
    quietStart: isClock(rules.quietStart) ? rules.quietStart : fallback.quietStart,
    quietEnd: isClock(rules.quietEnd) ? rules.quietEnd : fallback.quietEnd,
  };
}

/** An `HH:MM` clock in the app language: `21.30` (id), `9:30 PM` (en). */
export function clockText(value: string): string {
  const [h, m] = value.split(':').map(Number);
  return clockOf(new Date(2000, 0, 1, h, m));
}

/** `21.30 sampai 06.30`. */
export function quietText(rules: Pick<FamilyRules, 'quietStart' | 'quietEnd'>): string {
  return t('family:rules.quietRange', { from: clockText(rules.quietStart), to: clockText(rules.quietEnd) });
}
