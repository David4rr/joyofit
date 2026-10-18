import type { FamilyChip, FamilyDay, FamilyLink, FamilyWatchingItem } from '@/cloud/family';
import { fmtClock, fmtDate, fmtInt, fmtPercent, getLocale, INTL_TAG, t } from '@/i18n';

const MINUTE_MS = 60_000;
const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

const clock24 = new Map<string, Intl.DateTimeFormat>();

/** The wall clock of a date: `07.05` (id, 24-hour with a leading zero as the screens always wrote it), `7:05 AM` (en). */
export function clockOf(at: Date): string {
  const locale = getLocale();
  if (locale !== 'id') return fmtClock(at, locale);
  let format = clock24.get(locale);
  if (!format) {
    format = new Intl.DateTimeFormat(INTL_TAG[locale], { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
    clock24.set(locale, format);
  }
  return format.format(at);
}

const pad = (n: number) => String(n).padStart(2, '0');

export function chipLabel(chip: FamilyChip): string {
  return t(`family:chip.${chip}`);
}

/** Lower is calmer. A check outranks a missing feed: something looked off, where no data says nothing either way. */
const CHIP_SEVERITY: Record<FamilyChip, number> = { ok: 0, nosync: 1, check: 2 };

/**
 * The chip that needs the watcher most, over the people whose link is live; null when none is. Waiting, paused and frozen
 * links carry no data, so they do not count.
 */
export function worstChip(items: readonly FamilyWatchingItem[]): FamilyChip | null {
  let worst: FamilyChip | null = null;
  for (const item of items) {
    if (!isLive(item)) continue;
    if (worst === null || CHIP_SEVERITY[item.chip] > CHIP_SEVERITY[worst]) worst = item.chip;
  }
  return worst;
}

/**
 * The line under "Keluarga" on Today, next to the worst chip: who has that chip, or how many people are watched when all is
 * well. With nobody live, whether a request is still waiting.
 */
export function familyCardLine(items: readonly FamilyWatchingItem[]): string {
  const live = items.filter(isLive);
  const worst = worstChip(items);
  if (worst === null) return items.some((item) => item.status === 'pending') ? t('family:card.waiting') : t('family:card.noData');
  if (worst === 'ok') return live.length === 1 ? live[0].label : t('family:card.watched', { count: live.length });
  return live
    .filter((item) => item.chip === worst)
    .map((item) => item.label)
    .join(', ');
}

/** The link carries data now: consented, not paused, not revoked and inside the free limit. (`status` is already `paused` while a pause runs.) */
export function isLive(link: FamilyLink): boolean {
  return link.status === 'active' && !link.frozen;
}

/** The monitored person has paused sharing and the pause has not ended. */
export function isPaused(link: Pick<FamilyLink, 'pausedUntil'>, nowMs: number): boolean {
  return link.pausedUntil === -1 || (link.pausedUntil !== null && link.pausedUntil > nowMs);
}

/** The clock (`10.42`, `10:42 AM`); a day other than today gets `kemarin`, `besok` or `12 Okt` in front. Local time. */
export function clockLabel(ms: number, nowMs: number): string {
  const at = new Date(ms);
  const clock = clockOf(at);
  const today = new Date(nowMs);
  today.setHours(0, 0, 0, 0);
  const dayDiff = Math.round((new Date(at).setHours(0, 0, 0, 0) - today.getTime()) / DAY_MS);
  if (dayDiff === 0) return clock;
  if (dayDiff === -1) return t('family:fmt.yesterday', { clock });
  if (dayDiff === 1) return t('family:fmt.tomorrow', { clock });
  return t('family:fmt.dayClock', { day: fmtDate(at, 'short'), clock });
}

/** `baru saja`, `5 menit lalu`, `3 jam lalu`, `2 hari lalu`. */
export function agoLabel(ms: number, nowMs: number): string {
  const ago = Math.max(0, nowMs - ms);
  if (ago < MINUTE_MS) return t('family:fmt.justNow');
  if (ago < HOUR_MS) return t('family:fmt.minutesAgo', { count: Math.floor(ago / MINUTE_MS) });
  if (ago < DAY_MS) return t('family:fmt.hoursAgo', { count: Math.floor(ago / HOUR_MS) });
  return t('family:fmt.daysAgo', { count: Math.floor(ago / DAY_MS) });
}

/** `Data per 10.42 (3 jam lalu)`, or that there is no data yet. */
export function dataAtText(dataAt: number | null, nowMs: number): string {
  if (dataAt === null) return t('family:fmt.noData');
  return t('family:fmt.dataAt', { clock: clockLabel(dataAt, nowMs), ago: agoLabel(dataAt, nowMs) });
}

/** `4.230` (id) / `4,230` (en): thousands in the app language's separator. */
export function stepsText(steps: number | null): string {
  return steps === null ? t('family:fmt.none') : fmtInt(steps);
}

/** `7 jam 5 menit`, `45 menit`, `8 jam`. */
export function sleepText(minutes: number | null): string {
  if (minutes === null) return t('family:fmt.none');
  const total = Math.round(minutes);
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (h === 0) return t('family:fmt.sleepM', { m });
  return m === 0 ? t('family:fmt.sleepH', { h }) : t('family:fmt.sleepHm', { h, m });
}

/**
 * `62 bpm`, with the usual value after it once the server has one (`62 bpm, biasanya 60`). The baseline is the median of
 * 14 days and needs 7 of them; before that there is no comparison to make.
 */
export function restingHrText(restingHr: number | null, baseline: number | null): string {
  if (restingHr === null) return t('family:fmt.none');
  const bpm = Math.round(restingHr);
  return baseline === null ? t('family:fmt.bpm', { bpm }) : t('family:fmt.bpmUsual', { bpm, usual: Math.round(baseline) });
}

/** Why there is no comparison yet, for the detail screen; null when there is one. */
export function baselineNote(baseline: { restingHr: number | null; days: number }): string | null {
  if (baseline.restingHr !== null) return null;
  return t('family:fmt.baselineNote', { count: baseline.days });
}

export function batteryText(battery: number | null): string {
  return battery === null ? t('family:fmt.unknown') : fmtPercent(battery);
}

export function lastViewedText(lastViewedAt: number | null, nowMs: number): string {
  return lastViewedAt === null ? t('family:fmt.neverViewed') : t('family:fmt.lastViewed', { ago: agoLabel(lastViewedAt, nowMs) });
}

/** The subtitle of the Keluarga row in Settings: how many people this account watches and is watched by. */
export function familySettingsSubtitle(watching: number, watchedBy: number): string {
  if (watching > 0 && watchedBy > 0) {
    return t('family:fmt.settingsBoth', {
      watching: t('family:fmt.settingsWatchingInline', { count: watching }),
      watchedBy: t('family:fmt.settingsWatchedByInline', { count: watchedBy }),
    });
  }
  if (watching > 0) return t('family:fmt.settingsWatching', { count: watching });
  if (watchedBy > 0) return t('family:fmt.settingsWatchedBy', { count: watchedBy });
  return t('family:fmt.settingsIdle');
}

export type PauseChoice = 'hour' | 'today' | 'manual';

/**
 * The `pausedUntil` a choice stands for: an hour from now, the next local midnight, or `-1` for "sampai kunyalakan"
 * (until the person turns it on again).
 */
export function pauseUntil(choice: PauseChoice, nowMs: number): number {
  if (choice === 'hour') return nowMs + HOUR_MS;
  if (choice === 'manual') return -1;
  const midnight = new Date(nowMs);
  midnight.setHours(24, 0, 0, 0);
  return midnight.getTime();
}

/** `Dijeda sampai 14.30`, `Dijeda sampai kamu menyalakannya lagi`; null when not paused. */
export function pauseText(pausedUntil: number | null, nowMs: number): string | null {
  if (!isPaused({ pausedUntil }, nowMs)) return null;
  return pausedUntil === -1 ? t('family:fmt.pausedManual') : t('family:fmt.pausedUntil', { clock: clockLabel(pausedUntil!, nowMs) });
}

/** The earliest end of a running pause, to wake up and resume uploading; null when nothing is paused for a set time. */
export function nextPauseEnd(links: readonly Pick<FamilyLink, 'pausedUntil'>[], nowMs: number): number | null {
  let next: number | null = null;
  for (const { pausedUntil } of links) {
    if (pausedUntil !== null && pausedUntil > nowMs && (next === null || pausedUntil < next)) next = pausedUntil;
  }
  return next;
}

export function snoozeText(snoozeUntil: number | null, nowMs: number): string | null {
  if (snoozeUntil === null || snoozeUntil <= nowMs) return null;
  return t('family:fmt.snoozedUntil', { clock: clockLabel(snoozeUntil, nowMs) });
}

/** Local midnight (unix seconds) of a `YYYY-MM-DD` date, the form the trend chart's axis takes. */
export function dateToLocalMidnightSec(date: string): number {
  const [y, m, d] = date.split('-').map(Number);
  return Math.floor(new Date(y, m - 1, d).getTime() / 1000);
}

const addDaysToDate = (date: string, n: number): string => {
  const [y, m, d] = date.split('-').map(Number);
  // Noon keeps a daylight-saving jump from changing the date.
  const at = new Date(y, m - 1, d + n, 12);
  return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`;
};

export interface DaySeries {
  /** One value per calendar day, oldest first; null where the day has no value. */
  values: (number | null)[];
  /** `YYYY-MM-DD` of the first value; null when there are no days. */
  firstDate: string | null;
}

/** The day with the latest date (the server's order is not relied on); null when there are none. */
export function newestDay(days: readonly FamilyDay[]): FamilyDay | null {
  return days.reduce<FamilyDay | null>((newest, day) => (newest === null || day.date > newest.date ? day : newest), null);
}

/**
 * The last `count` calendar days that end with the newest day the server sent, one value per day. Days the server left
 * out (nothing uploaded, or not shared) are gaps, never zeros.
 */
export function daySeries(days: readonly FamilyDay[], count: number, pick: (day: FamilyDay) => number | null): DaySeries {
  const newest = newestDay(days);
  if (newest === null) return { values: [], firstDate: null };
  const last = newest.date;
  const byDate = new Map(days.map((day) => [day.date, pick(day)]));
  const firstDate = addDaysToDate(last, 1 - count);
  const values = Array.from({ length: count }, (_, i) => byDate.get(addDaysToDate(firstDate, i)) ?? null);
  return { values, firstDate };
}
