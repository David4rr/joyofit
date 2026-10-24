import { describe, expect, it } from 'bun:test';

import { lastSleepSession } from '@/features/today/stats';
import type { SleepSegment } from '@/wear';

import { cleanUnstagedSleep, NO_EVIDENCE, workoutSpan } from './cleanSleep';
import { buildNights, sleepByDay } from './nights';

/** Unix seconds of `HH:MM` on 2026-10-`day`, device local time like the app. */
const at = (day: number, clock: string) => {
  const [h, m] = clock.split(':').map(Number);
  return Math.floor(new Date(2026, 9, day, h, m).getTime() / 1000);
};
const seg = (day: number, from: string, toDay: number, to: string): SleepSegment => ({
  start: at(day, from),
  end: at(toDay, to),
  type: 6,
  stage: null,
});

describe('evening doze before the night (Salim, 23 Oct)', () => {
  const doze = seg(23, '21:55', 23, '22:42');
  const night = seg(24, '02:00', 24, '05:13');
  // The way the app reads them: stage-less ranges go through the cleaning step first (it marks the 3 h gap `breakBefore`).
  const clean = (segments: SleepSegment[], workouts: { start: number; end: number }[] = []) =>
    cleanUnstagedSleep(segments, { ...NO_EVIDENCE, workouts });

  it('joins the night: one session, doze start, wake day, awake gap, not a nap', () => {
    const cleaned = clean([doze, night]);
    expect(cleaned[1].breakBefore).toBe(true);
    const nights = buildNights(cleaned, []);
    expect(nights).toHaveLength(1);
    const n = nights[0];
    expect(n.start).toBe(at(23, '21:55'));
    expect(n.end).toBe(at(24, '05:13'));
    expect(n.day).toBe('2026-10-24');
    expect(n.asleepSeconds).toBe(4 * 3600);
    expect(n.nap).toBe(false);
    expect(n.seconds.awake).toBe(at(24, '02:00') - at(23, '22:42'));
    expect(n.awakenings).toBe(1);
    expect(sleepByDay(nights).get(at(24, '00:00'))).toEqual({ asleepSeconds: 4 * 3600, napSeconds: 0, hasNight: true });
  });

  it('Today card agrees', () => {
    const summary = lastSleepSession(clean([doze, night]));
    expect(summary?.start).toBe(at(23, '21:55'));
    expect(summary?.end).toBe(at(24, '05:13'));
    expect(summary?.totalSeconds).toBe(4 * 3600);
    expect(summary?.naps).toEqual([]);
  });

  it('an afternoon nap (before 19:00) is still a nap', () => {
    const nap = seg(23, '14:00', 23, '15:00');
    const nights = buildNights(clean([nap, night]), []);
    expect(nights).toHaveLength(2);
    const found = nights.find((n) => n.start === at(23, '14:00'));
    expect(found?.nap).toBe(true);
    expect(found?.day).toBe('2026-10-23');
    expect(lastSleepSession(clean([nap, night]))?.start).toBe(at(24, '02:00'));
  });

  it('a doze with no session within 8 h after it stays a nap on its day', () => {
    const lone = buildNights(clean([doze]), []);
    expect(lone).toHaveLength(1);
    expect(lone[0].nap).toBe(true);
    expect(lone[0].day).toBe('2026-10-23');
    const later = seg(24, '06:43', 24, '10:00');
    expect(buildNights(clean([doze, later]), [])).toHaveLength(2);
    expect(lastSleepSession(clean([doze, later]))?.start).toBe(at(24, '06:43'));
  });

  it('a workout in between keeps them apart', () => {
    const cleaned = clean([doze, night], [workoutSpan(at(23, '23:00'), at(23, '23:40'), 40 * 60)]);
    expect(buildNights(cleaned, [])).toHaveLength(2);
    expect(lastSleepSession(cleaned)?.start).toBe(at(24, '02:00'));
  });
});
