/**
 * The running guide of a Lari-jalan session (`joyofit.coach.guide`) and the local notifications that call its phases while the app is not in
 * front (same approach as the lactate guide, `features/lactate/guideStore.ts`), and the saved 1 km re-test results (`joyofit.coach.retests`).
 * Phone only: nothing here is synced.
 */
import * as Notifications from 'expo-notifications';
import Storage from 'expo-sqlite/kv-store';
import { Platform } from 'react-native';

import { t } from '@/i18n';

import { spanText } from '../format';
import { parseRetests, withResult, type RetestResult } from './retest';
import { timedCues, type Segment } from './timeline';

const GUIDE_KEY = 'joyofit.coach.guide';
const RETESTS_KEY = 'joyofit.coach.retests';
const CHANNEL_ID = 'coach-guide';
const idOf = (n: number) => `coach-guide-${n}`;
/** A session lasts under an hour: a guide older than this is a forgotten one. */
const STALE_MS = 4 * 3600 * 1000;

export interface ActiveGuide {
  /** The plan session's key. */
  key: string;
  startedAt: number;
  /** Notifications scheduled for it, so they can all be taken down. */
  cues: number;
  /** Re-test only: when the 1 km began and ended (ms), and the watch's live distance at the start, metres. */
  testStartedAt: number | null;
  testEndedAt: number | null;
  testStartDistanceM: number | null;
}

export function getGuide(key: string, nowMs: number = Date.now()): ActiveGuide | null {
  const raw = Storage.getItemSync(GUIDE_KEY);
  if (raw === null) return null;
  try {
    const doc = JSON.parse(raw) as Partial<ActiveGuide>;
    const startedAt = Number(doc.startedAt);
    if (doc.key !== key || !Number.isFinite(startedAt) || nowMs - startedAt > STALE_MS || startedAt > nowMs + 60_000) return null;
    const optional = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
    return {
      key,
      startedAt,
      cues: optional(doc.cues) ?? 0,
      testStartedAt: optional(doc.testStartedAt),
      testEndedAt: optional(doc.testEndedAt),
      testStartDistanceM: optional(doc.testStartDistanceM),
    };
  } catch {
    return null;
  }
}

export function saveGuide(guide: ActiveGuide): void {
  Storage.setItemSync(GUIDE_KEY, JSON.stringify(guide));
}

async function cancelCues(count: number): Promise<void> {
  for (let n = 0; n < count; n++) {
    try {
      await Notifications.cancelScheduledNotificationAsync(idOf(n));
    } catch {
      // nothing scheduled
    }
  }
}

async function permitted(): Promise<boolean> {
  let granted = (await Notifications.getPermissionsAsync()).granted;
  if (!granted) granted = (await Notifications.requestPermissionsAsync()).granted;
  if (!granted) return false;
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync(CHANNEL_ID, { name: t('coach:guide.channel'), importance: Notifications.AndroidImportance.HIGH });
  }
  return true;
}

/** Schedules `{title, body}` notifications `afterSec` seconds from now, numbered from `first`. Resolves with how many were scheduled. */
async function schedule(first: number, items: readonly { afterSec: number; title: string; body: string }[]): Promise<number> {
  let scheduled = 0;
  for (const [i, item] of items.entries()) {
    await Notifications.scheduleNotificationAsync({
      identifier: idOf(first + i),
      content: { title: item.title, body: item.body },
      trigger: { type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL, seconds: Math.max(1, Math.round(item.afterSec)), channelId: CHANNEL_ID },
    });
    scheduled += 1;
  }
  return scheduled;
}

/**
 * Starts the guide of a walk/run session now and schedules a notification for every segment change. Without the notification permission the
 * guide still works on screen. Resolves with whether the cues were scheduled.
 */
export async function startRunGuide(key: string, segments: readonly Segment[], nowMs: number = Date.now()): Promise<boolean> {
  const previous = getGuide(key, nowMs);
  if (previous) await cancelCues(previous.cues);
  const base: ActiveGuide = { key, startedAt: nowMs, cues: 0, testStartedAt: null, testEndedAt: null, testStartDistanceM: null };
  saveGuide(base);
  try {
    if (!(await permitted())) return false;
    const items = timedCues(segments).map((cue) => ({
      afterSec: cue.afterSec,
      title: t(`coach:guide.cue.${cue.kind}.title`),
      body: cue.kind === 'done' ? t('coach:guide.cue.done.body') : t(`coach:guide.cue.${cue.kind}.body`, { time: spanText(cue.lengthSec) }),
    }));
    const cues = await schedule(0, items);
    saveGuide({ ...base, cues });
    return true;
  } catch {
    return false;
  }
}

/** Starts the re-test guide: the warm-up runs, and one notification tells when it is over. */
export async function startRetestGuide(key: string, warmupSec: number, nowMs: number = Date.now()): Promise<boolean> {
  const previous = getGuide(key, nowMs);
  if (previous) await cancelCues(previous.cues);
  const base: ActiveGuide = { key, startedAt: nowMs, cues: 0, testStartedAt: null, testEndedAt: null, testStartDistanceM: null };
  saveGuide(base);
  try {
    if (!(await permitted())) return false;
    const cues = await schedule(0, [{ afterSec: warmupSec, title: t('coach:guide.retest.ready.title'), body: t('coach:guide.retest.ready.body') }]);
    saveGuide({ ...base, cues });
    return true;
  } catch {
    return false;
  }
}

/** The 1 km began: the warm-up notification is no longer wanted. */
export async function markTestStart(guide: ActiveGuide, nowMs: number, distanceM: number | null): Promise<ActiveGuide> {
  await cancelCues(guide.cues);
  const next = { ...guide, cues: 0, testStartedAt: nowMs, testStartDistanceM: distanceM };
  saveGuide(next);
  return next;
}

/** The 1 km ended: one notification ends the cool-down walk. */
export async function markTestEnd(guide: ActiveGuide, nowMs: number, cooldownSec: number): Promise<ActiveGuide> {
  let cues = 0;
  try {
    if (await permitted()) cues = await schedule(0, [{ afterSec: cooldownSec, title: t('coach:guide.cue.done.title'), body: t('coach:guide.cue.done.body') }]);
  } catch {
    cues = 0;
  }
  const next = { ...guide, cues, testEndedAt: nowMs };
  saveGuide(next);
  return next;
}

export async function stopGuide(guide: ActiveGuide | null): Promise<void> {
  Storage.removeItemSync(GUIDE_KEY);
  if (guide) await cancelCues(guide.cues);
}

/**
 * Shows a notification now (a heart-rate cue while the screen may be off). Only when the permission is already granted: a guide
 * never opens a permission prompt in the middle of a run. A missed one is not worth interrupting the session for.
 */
export async function notifyNow(title: string, body: string): Promise<void> {
  try {
    if (!(await Notifications.getPermissionsAsync()).granted) return;
    await Notifications.scheduleNotificationAsync({ content: { title, body }, trigger: Platform.OS === 'android' ? { channelId: CHANNEL_ID } : null });
  } catch {
    // no notification: the buzz and the screen still tell
  }
}

export function loadRetests(): RetestResult[] {
  return parseRetests(Storage.getItemSync(RETESTS_KEY));
}

export function saveRetest(result: RetestResult): RetestResult[] {
  const next = withResult(loadRetests(), result);
  Storage.setItemSync(RETESTS_KEY, JSON.stringify(next));
  return next;
}
