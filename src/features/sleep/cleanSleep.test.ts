import { describe, expect, it } from 'bun:test';
import type { SQLiteDatabase } from 'expo-sqlite';

import { listSleepSince } from '@/db/queries';
import { lastSleepSession, type SleepSpan } from '@/features/today/stats';
import type { SleepSegment } from '@/wear';

import {
  cleanUnstagedSleep,
  MIN_RUN_SEC,
  NO_EVIDENCE,
  workoutSpan,
  type SleepEvidence,
  type Span,
} from './cleanSleep';
import { buildNights } from './nights';

const H = 3600;
const MIN = 60;

/** Unix seconds of `HH:MM[:SS]` on 2026-10-`day`, Western Indonesia Time (UTC+7), as the user's phone showed it. */
function wib(day: number, clock: string): number {
  const [h, m, s = 0] = clock.split(':').map(Number);
  return Date.UTC(2026, 9, day, h - 7, m, s) / 1000;
}

/** `TruSleep` state ranges as `SleepSync.segmentsFromState` stores them: raw kind 6, no stage. */
function state(start: number, end: number): SleepSegment {
  return { start, end, type: 6, stage: null };
}

/**
 * Builds the ranges of a stage-changes list as the Sleep screen printed it: the first period starts at `first`,
 * every row after it says when it begins and how long it lasts.
 */
function ranges(rows: readonly (readonly [day: number, clock: string, minutes: number])[]): SleepSegment[] {
  return rows.map(([day, clock, minutes]) => {
    const start = wib(day, clock);
    return state(start, start + minutes * MIN);
  });
}

const evidence = (e: Partial<SleepEvidence>): SleepEvidence => ({ ...NO_EVIDENCE, ...e });

/** Every minute of `[start, end)` as the watch's step table would hold it for a run. */
function minutes(start: number, end: number): number[] {
  const out: number[] = [];
  for (let t = start; t < end; t += MIN) out.push(t);
  return out;
}

/**
 * Salim's Watch Fit 2, Friday 16 Oct: "Nap, 18:50 to 20:24, 7 min asleep". Four fragments of 1 to 3 minutes with
 * "26 min", "3 min" and "58 min not recorded" between them (salim-0.jpg).
 */
const HRV_NAP = ranges([
  [16, '18:50', 1],
  [16, '19:17', 2],
  [16, '19:22', 1],
  [16, '20:21', 3],
]);

/**
 * Saturday 17 Oct, "Nap, 06:06 to 09:05, 1 h 50 min asleep", 17 stage changes (salim-1.jpg). Rows are
 * start and minutes asleep; the 33 minute block at 06:37 has the length of a morning workout.
 */
const MORNING_FRAGMENTS = ranges([
  [17, '06:06', 5],
  [17, '06:12', 3],
  [17, '06:16', 3],
  [17, '06:20', 4],
  [17, '06:37', 33],
  [17, '07:16', 1],
  [17, '07:20', 2],
  [17, '07:24', 4],
  [17, '07:34', 3],
  [17, '07:40', 4],
  [17, '07:45', 16],
  [17, '08:02', 1],
  [17, '08:08', 3],
  [17, '08:12', 1],
  [17, '08:15', 2],
  [17, '08:26', 19],
  [17, '08:55', 4],
  [17, '09:03', 2],
]);

/**
 * Sunday 18 Oct, "Night, 22:41 to 06:38, Sleep (no stages), 5 h 25 min" (salim-2.jpg), 22 stage changes: the
 * minutes below add up to those 5 h 25 min. A 3 h 59 min block of real sleep from 00:00, then fragments, and at 04:34
 * a block of 32 minutes: the morning run he started from the watch.
 */
const NIGHT_WITH_RUN = ranges([
  [17, '22:41', 7],
  [18, '00:00', 239],
  [18, '04:03', 5],
  [18, '04:12', 1],
  [18, '04:16', 3],
  [18, '04:21', 1],
  [18, '04:31', 2],
  [18, '04:34', 32],
  [18, '05:07', 2],
  [18, '05:12', 2],
  [18, '05:19', 1],
  [18, '05:22', 3],
  [18, '05:26', 5],
  [18, '05:34', 1],
  [18, '05:37', 1],
  [18, '05:39', 2],
  [18, '05:45', 5],
  [18, '06:03', 1],
  [18, '06:05', 2],
  [18, '06:19', 5],
  [18, '06:27', 2],
  [18, '06:32', 2],
  [18, '06:37', 1],
]);

const RUN: Span = workoutSpan(wib(18, '04:34:05'), wib(18, '05:06:40'), 31 * MIN);

const totalSec = (segments: readonly SleepSegment[]) => segments.reduce((sum, s) => sum + s.end - s.start, 0);

describe('the fixtures are the screenshots', () => {
  it('the night adds up to the 5 h 25 min on screen, the nap to 1 h 50, the HRV nap to 7 min', () => {
    expect(totalSec(NIGHT_WITH_RUN)).toBe(5 * H + 25 * MIN);
    expect(totalSec(MORNING_FRAGMENTS)).toBe(H + 50 * MIN);
    expect(totalSec(HRV_NAP)).toBe(7 * MIN);
  });
});

describe('HRV and stress checks recorded as sleep (Watch Fit 2)', () => {
  it('the 16 Oct "nap" of four fragments is not sleep at all', () => {
    const cleaned = cleanUnstagedSleep(HRV_NAP, NO_EVIDENCE);
    expect(cleaned).toEqual([]);
    expect(buildNights(cleaned, [])).toEqual([]);
    expect(lastSleepSession(cleaned)).toBeNull();
  });

  it('the 17 Oct morning keeps only the 33 minute block and one chain of pieces a minute apart; the other fragments go', () => {
    const cleaned = cleanUnstagedSleep(MORNING_FRAGMENTS, NO_EVIDENCE);
    // 07:40 + 07:45 + 08:02: 21 minutes with gaps of one minute, a run. Every other run holds 15 minutes or less.
    expect(cleaned).toEqual([MORNING_FRAGMENTS[4], MORNING_FRAGMENTS[9], MORNING_FRAGMENTS[10], MORNING_FRAGMENTS[11]]);
  });

  it('and with the workout that block was, the 33 minutes are gone and the rest is a 21 minute nap', () => {
    const workout = workoutSpan(wib(17, '06:37'), wib(17, '07:10'), 33 * MIN);
    const cleaned = cleanUnstagedSleep(MORNING_FRAGMENTS, evidence({ workouts: [workout] }));
    expect(cleaned).toEqual([MORNING_FRAGMENTS[9], MORNING_FRAGMENTS[10], MORNING_FRAGMENTS[11]]);
    expect(buildNights(cleaned, [])[0].asleepSeconds).toBe(21 * MIN);
  });

  it('a spot HRV measurement in the middle of a 25 minute range splits it into two pieces too short to be sleep', () => {
    const start = wib(16, '15:00');
    const range = state(start, start + 25 * MIN);
    const spot = { start: start + 12 * MIN, end: start + 13 * MIN };
    expect(cleanUnstagedSleep([range], NO_EVIDENCE)).toEqual([range]);
    expect(cleanUnstagedSleep([range], evidence({ spots: [spot] }))).toEqual([]);
  });
});

describe('a workout started from the watch is not sleep (18 Oct)', () => {
  it('with the run stored, the night is 00:00 to 03:59 and the fragments around the run are gone', () => {
    const cleaned = cleanUnstagedSleep(NIGHT_WITH_RUN, evidence({ workouts: [RUN] }));
    expect(cleaned).toEqual([state(wib(18, '00:00'), wib(18, '03:59'))]);

    const [night, ...rest] = buildNights(cleaned, []);
    expect(rest).toEqual([]);
    expect(night.start).toBe(wib(18, '00:00'));
    expect(night.end).toBe(wib(18, '03:59'));
    expect(night.asleepSeconds).toBe(239 * MIN);
    expect(night.nap).toBe(false);
    expect(lastSleepSession(cleaned)?.totalSeconds).toBe(239 * MIN);
  });

  it('with only the steps of the run (no workout row yet) the result is the same', () => {
    const cleaned = cleanUnstagedSleep(NIGHT_WITH_RUN, evidence({ activeMinutes: minutes(wib(18, '04:34'), wib(18, '05:06')) }));
    expect(cleaned).toEqual([state(wib(18, '00:00'), wib(18, '03:59'))]);
  });

  it('sleep on both sides of a workout is two sessions, each with its own totals', () => {
    const before = state(wib(18, '23:00'), wib(19, '04:30'));
    const after = state(wib(19, '05:30'), wib(19, '08:00'));
    const run = workoutSpan(wib(19, '04:40'), wib(19, '05:20'), 40 * MIN);
    const cleaned = cleanUnstagedSleep([before, after], evidence({ workouts: [run] }));
    expect(cleaned).toEqual([before, { ...after, breakBefore: true }]);

    const nights = buildNights(cleaned, []);
    expect(nights.map((n) => [n.start, n.end, n.asleepSeconds, n.nap])).toEqual([
      [after.start, after.end, 150 * MIN, true],
      [before.start, before.end, 330 * MIN, false],
    ]);
    // The same split for Today's last sleep: only what follows the run.
    expect(lastSleepSession(cleaned)?.totalSeconds).toBe(150 * MIN);
  });

  it('a workout that lies inside one range cuts it and the second piece starts a new session', () => {
    const range = state(wib(18, '00:00'), wib(18, '07:00'));
    const run = workoutSpan(wib(18, '04:34'), wib(18, '05:06'), 32 * MIN);
    const cleaned = cleanUnstagedSleep([range], evidence({ workouts: [run] }));
    expect(cleaned).toEqual([
      state(wib(18, '00:00'), wib(18, '04:34')),
      { ...state(wib(18, '05:06'), wib(18, '07:00')), breakBefore: true },
    ]);
  });
});

describe('minimum sleep and long awake gaps on a watch without stages', () => {
  it('a nap needs 20 minutes of continuous sleep', () => {
    const at = wib(16, '14:00');
    expect(cleanUnstagedSleep([state(at, at + MIN_RUN_SEC - MIN)], NO_EVIDENCE)).toEqual([]);
    expect(cleanUnstagedSleep([state(at, at + MIN_RUN_SEC)], NO_EVIDENCE)).toHaveLength(1);
  });

  it('fragments a few minutes apart add up to a run only when the gaps are short', () => {
    const at = wib(16, '14:00');
    const close = [state(at, at + 10 * MIN), state(at + 11 * MIN, at + 22 * MIN)];
    const far = [state(at, at + 10 * MIN), state(at + 15 * MIN, at + 26 * MIN)];
    expect(cleanUnstagedSleep(close, NO_EVIDENCE)).toHaveLength(2);
    expect(cleanUnstagedSleep(far, NO_EVIDENCE)).toEqual([]);
  });

  it('a minute of steps inside a night (a trip to the bathroom) does not split it', () => {
    const range = state(wib(18, '23:00'), wib(19, '06:00'));
    const trip = wib(19, '02:10');
    const cleaned = cleanUnstagedSleep([range], evidence({ activeMinutes: [trip] }));
    expect(cleaned).toEqual([state(range.start, trip), state(trip + MIN, range.end)]);
    const nights = buildNights(cleaned, []);
    expect(nights).toHaveLength(1);
    expect(nights[0].asleepSeconds).toBe(7 * H - MIN);
  });

  it('half an hour of walking inside a range ends the night there', () => {
    const range = state(wib(18, '23:00'), wib(19, '06:00'));
    const walk = minutes(wib(19, '02:00'), wib(19, '02:30'));
    const cleaned = cleanUnstagedSleep([range], evidence({ activeMinutes: walk }));
    expect(cleaned.map((s) => [s.start, s.end, s.breakBefore ?? false])).toEqual([
      [range.start, wib(19, '02:00'), false],
      [wib(19, '02:30'), range.end, false],
    ]);
  });

  it('more than an hour with nothing recorded between two stage-less runs is two sessions', () => {
    const a = state(wib(18, '23:00'), wib(19, '02:00'));
    const b = state(wib(19, '03:30'), wib(19, '06:00'));
    const cleaned = cleanUnstagedSleep([a, b], NO_EVIDENCE);
    expect(cleaned).toEqual([a, { ...b, breakBefore: true }]);
    expect(buildNights(cleaned, [])).toHaveLength(2);
  });

  it('half an hour with nothing recorded is still one session', () => {
    const a = state(wib(18, '23:00'), wib(19, '02:00'));
    const b = state(wib(19, '02:30'), wib(19, '06:00'));
    const cleaned = cleanUnstagedSleep([a, b], NO_EVIDENCE);
    expect(cleaned).toEqual([a, b]);
    expect(buildNights(cleaned, [])).toHaveLength(1);
  });

  it('two overlapping stage-less ranges of one night count once', () => {
    const a = state(wib(18, '23:00'), wib(19, '05:00'));
    const b = { ...state(wib(19, '01:00'), wib(19, '06:00')), type: 1 };
    const cleaned = cleanUnstagedSleep([a, b], NO_EVIDENCE);
    expect(totalSec(cleaned)).toBe(7 * H);
  });
});

describe('watches with stages are unaffected', () => {
  const night: SleepSegment[] = [
    { start: wib(18, '23:00'), end: wib(19, '02:00'), type: 6, stage: 'light' },
    { start: wib(19, '02:00'), end: wib(19, '04:00'), type: 7, stage: 'deep' },
    { start: wib(19, '04:00'), end: wib(19, '04:03'), type: 0x5658, stage: 'awake' },
    { start: wib(19, '04:03'), end: wib(19, '06:30'), type: 0x5656, stage: 'rem' },
  ];

  it('staged segments come back as stored, with every kind of evidence over them', () => {
    const all = evidence({
      workouts: [workoutSpan(wib(19, '03:00'), wib(19, '03:40'), 40 * MIN)],
      spots: [{ start: wib(19, '01:00'), end: wib(19, '01:01') }],
      activeMinutes: minutes(wib(19, '04:10'), wib(19, '04:40')),
    });
    expect(cleanUnstagedSleep(night, all)).toEqual(night);
  });

  it('a short staged nap is left to the 5-minute blip rule, not the 20-minute one', () => {
    const nap: SleepSegment = { start: wib(19, '14:00'), end: wib(19, '14:12'), type: 6, stage: 'light' };
    expect(cleanUnstagedSleep([nap], NO_EVIDENCE)).toEqual([nap]);
    const nights = buildNights([...night, nap], []);
    expect(nights.some((n) => n.nap && n.asleepSeconds === 12 * MIN)).toBe(true);
  });

  it('stage-less fragments next to a staged night are still dropped by the stray rule afterwards', () => {
    const stray = state(wib(19, '06:35'), wib(19, '07:10'));
    const cleaned = cleanUnstagedSleep([...night, stray], NO_EVIDENCE);
    expect(buildNights(cleaned, [])).toHaveLength(1);
    expect(buildNights(cleaned, [])[0].end).toBe(wib(19, '06:30'));
  });
});

describe('stored history is re-derived when it is read', () => {
  /** A database that answers the three evidence queries and the sleep query from fixtures. */
  function fakeDb(rows: SleepSegment[], opts: { workouts?: Span[]; spots?: Span[]; active?: number[] }) {
    const queries: string[] = [];
    const db = {
      async getAllAsync(sql: string, ...args: unknown[]) {
        queries.push(sql);
        if (sql.includes('FROM sleep_segments')) return rows.filter((r) => r.end >= (args[0] as number));
        if (sql.includes('FROM workouts')) {
          return (opts.workouts ?? []).map((w) => ({ start: w.start, end: w.end, duration: w.end - w.start }));
        }
        if (sql.includes('FROM hrv_readings')) return opts.spots ?? [];
        if (sql.includes('FROM step_samples')) return (opts.active ?? []).map((timestamp) => ({ timestamp }));
        throw new Error(`unexpected query: ${sql}`);
      },
    } as unknown as SQLiteDatabase;
    return { db, queries };
  }

  it('the night stored by an earlier build comes back as 00:00 to 03:59 once the run is in the workouts table', async () => {
    const { db } = fakeDb(NIGHT_WITH_RUN, { workouts: [RUN] });
    const sleep = await listSleepSince(db, wib(17, '12:00'));
    expect(sleep).toEqual([state(wib(18, '00:00'), wib(18, '03:59'))]);
  });

  it('staged history never reads the evidence tables', async () => {
    const staged: SleepSegment[] = [{ start: wib(18, '23:00'), end: wib(19, '06:00'), type: 6, stage: 'light' }];
    const { db, queries } = fakeDb(staged, {});
    const sleep: SleepSpan[] = await listSleepSince(db, 0);
    expect(sleep).toEqual(staged);
    expect(queries).toHaveLength(1);
  });
});
