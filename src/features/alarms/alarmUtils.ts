import { t } from '@/i18n';
import { ALARM_DAYS, ALARM_SLOTS, type WatchAlarm, type WatchSmartAlarm } from '@/wear';

const pad = (n: number) => String(n).padStart(2, '0');

/** Weekday bit of `ALARM_DAYS` to its key under `watch:alarms.days`. */
const DAY_KEYS = { 1: 'mon', 2: 'tue', 4: 'wed', 8: 'thu', 16: 'fri', 32: 'sat', 64: 'sun' } as const;
type DayBit = keyof typeof DAY_KEYS;

/** Three-letter weekday name ("Sen", "Mon"). */
export function dayName(bit: number): string {
  return t(`watch:alarms.days.${DAY_KEYS[bit as DayBit]}`);
}

/** Two-letter weekday for a round chip, unique within the week ("Sn" and "Sl", not "Se" twice). */
export function dayInitials(bit: number): string {
  return t(`watch:alarms.dayChips.${DAY_KEYS[bit as DayBit]}`);
}

export function formatAlarmTime(hour: number, minute: number): string {
  return `${pad(hour)}:${pad(minute)}`;
}

const WEEKDAYS = 1 | 2 | 4 | 8 | 16;
const WEEKEND = 32 | 64;
const EVERY_DAY = WEEKDAYS | WEEKEND;

/** "Once", "Every day", "Weekdays", "Weekends" or the day names. */
export function describeRepeat(repeat: number): string {
  if (repeat === 0) return t('watch:alarms.repeat.once');
  if (repeat === EVERY_DAY) return t('watch:alarms.repeat.everyDay');
  if (repeat === WEEKDAYS) return t('watch:alarms.repeat.weekdays');
  if (repeat === WEEKEND) return t('watch:alarms.repeat.weekends');
  return ALARM_DAYS.filter((day) => (repeat & day.bit) !== 0)
    .map((day) => dayName(day.bit))
    .join(' ');
}

/** The lowest free watch slot (1 to 5), or null when all five are used. */
export function firstFreeSlot(alarms: readonly WatchAlarm[]): number | null {
  for (let slot = 1; slot <= ALARM_SLOTS; slot += 1) {
    if (!alarms.some((alarm) => alarm.slot === slot)) return slot;
  }
  return null;
}

/** Whole number inside `[min, max]`, or null when the text is not one. */
export function parseBounded(text: string, min: number, max: number): number | null {
  const trimmed = text.trim();
  if (!/^\d{1,3}$/.test(trimmed)) return null;
  const value = Number(trimmed);
  return value >= min && value <= max ? value : null;
}

export const DEFAULT_SMART_ALARM: WatchSmartAlarm = {
  enabled: false,
  hour: 7,
  minute: 0,
  repeat: 0,
  aheadMinutes: 5,
};
