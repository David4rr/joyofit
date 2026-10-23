import { describe, expect, test } from 'bun:test';

import { buildPlan, defaultWeekdays } from './actions';
import type { CoachPlan } from './doc';
import { sessionFeedback } from './feedback';
import { matchWorkouts, type MatchWorkout } from './match';
import { allSessions, generatePlan } from './plans/generate';
import {
  RETEST_DISTANCE_M,
  RETEST_WEEKS,
  RUNWALK_CONTINUOUS,
  RUNWALK_DAYS,
  RUNWALK_KEEP_ZONE,
  RUNWALK_STEPS,
  RUNWALK_WALK_ZONE,
  RUNWALK_WEEKS,
  isRunWalkRetest,
} from './plans/runWalk';
import type { PlannedSession } from './plans/types';
import { FRESH_HR_STATE, HIGH_HOLD_MS, LOW_HOLD_MS, STALE_HR_MS, bandStatus, liveHr, nextHrCue, type HrCueInput, type HrCueState } from './runwalk/hrCue';
import { COMPARABLE_HR_GAP, MIN_HR_READINGS, finishRetest, parseRetests, retestHistory, withResult, type RetestResult } from './runwalk/retest';
import { positionAt, runSegments, timedCues, totalSec } from './runwalk/timeline';
import { suggest, type SuggestionInput } from './suggest';
import { dayStartSec } from './time';
import type { WorkoutAnalysis } from '@/features/workouts/analysis/types';

const MONDAY = '2026-10-12';

function planOf(): CoachPlan {
  const choice = { kind: 'run' as const, goal: 'runWalk' as const, level: 'beginner' as const, daysPerWeek: 3, setting: null, weekdays: defaultWeekdays(3) };
  return buildPlan(choice, dayStartSec(MONDAY) * 1000 + 6 * 3600_000);
}

const plan = planOf();
const weeks = generatePlan(plan);
const sessions = allSessions(weeks);

describe('Lari-jalan plan', () => {
  test('is 8 weeks of 3 sessions, built from the goal alone', () => {
    expect(plan.weeks).toBe(RUNWALK_WEEKS);
    expect(plan.daysPerWeek).toBe(RUNWALK_DAYS);
    expect(weeks.length).toBe(8);
    for (const week of weeks) expect(week.sessions.length).toBe(3);
    // Same parameters, same plan.
    expect(generatePlan(planOf())).toEqual(weeks);
  });

  test('week 1 starts with 1 minute of jogging and 2 minutes of walking, guided by heart rate', () => {
    const first = weeks[0]!.sessions[0]!;
    expect(first.type).toBe('walkrun');
    expect(first.hard).toBe(false);
    expect(first.run!.walkRun).toEqual({ warmupMin: 5, runSec: 60, walkSec: 120, reps: 8, cooldownMin: 5 });
    expect(first.minutes).toBe(34);
    expect(first.run!.zone).toBe(RUNWALK_KEEP_ZONE);
    expect(first.run!.walkAtZone).toBe(RUNWALK_WALK_ZONE);
    expect(RUNWALK_KEEP_ZONE).toBe(3);
    expect(RUNWALK_WALK_ZONE).toBe(4);
  });

  test('the jog grows week by week while the walk stays; the last weeks are one continuous jog of 15 to 30 minutes', () => {
    const intervalWeeks = RUNWALK_STEPS.length;
    let previousJog = 0;
    for (let w = 0; w < intervalWeeks; w++) {
      const spec = weeks[w]!.sessions[0]!.run!.walkRun!;
      expect(spec.runSec).toBeGreaterThan(previousJog);
      expect(spec.walkSec).toBe(120);
      // No step more than doubles the jog of the week before.
      if (previousJog > 0) expect(spec.runSec / previousJog).toBeLessThanOrEqual(2);
      previousJog = spec.runSec;
    }
    expect(RUNWALK_STEPS[0]!.runSec).toBe(60);
    expect(RUNWALK_STEPS[intervalWeeks - 1]!.runSec).toBe(480);

    const mains: number[] = [];
    for (const week of weeks.slice(intervalWeeks)) {
      for (const s of week.sessions) {
        if (s.type === 'retest') continue;
        expect(s.type).toBe('easy');
        const spec = s.run!.walkRun!;
        expect(spec.reps).toBe(1);
        expect(spec.walkSec).toBe(0);
        expect(s.run!.walkAtZone).toBe(RUNWALK_WALK_ZONE);
        mains.push(spec.runSec / 60);
      }
    }
    expect(mains).toEqual([15, 20, 20, 25, 30]);
    expect(Math.max(...mains)).toBe(30);
    expect(RUNWALK_CONTINUOUS.flat().every((m) => m >= 15 && m <= 30)).toBe(true);
    // Never more than 8 minutes of jogging in a row before the first continuous jog, then a 15 minute bridge.
    expect(mains[0]).toBeLessThan(2 * (RUNWALK_STEPS[intervalWeeks - 1]!.runSec / 60));
  });

  test('every fourth week is lighter, and no session is hard', () => {
    expect(weeks.map((w) => w.phase)).toEqual(['build', 'build', 'build', 'cutback', 'build', 'build', 'build', 'build']);
    const minutes = (w: number) => weeks[w]!.sessions[0]!.minutes;
    expect(minutes(3)).toBeLessThan(minutes(2));
    expect(sessions.every((s) => !s.hard)).toBe(true);
    expect(sessions.every((s) => s.minutes >= 25 && s.minutes <= 45)).toBe(true);
  });

  test('the 1 km re-test is the last session of weeks 1, 5 and 8, at the heart rate of zone 3', () => {
    expect([...RETEST_WEEKS]).toEqual([0, 4, 7]);
    const tests = sessions.filter((s) => s.type === 'retest');
    expect(tests.map((s) => [s.week, s.slot])).toEqual([[0, 2], [4, 2], [7, 2]]);
    for (const s of tests) {
      expect(s.hard).toBe(false);
      expect(s.run!.distanceM).toBe(RETEST_DISTANCE_M);
      expect(s.run!.zone).toBe(3);
      expect(s.run!.retest).toEqual({ warmupMin: 10, cooldownMin: 5 });
      expect(s.run!.walkAtZone).toBeNull();
      expect(s.minutes).toBe(27);
    }
    expect(isRunWalkRetest(4, 2)).toBe(true);
    expect(isRunWalkRetest(4, 1)).toBe(false);
    // About a month apart, the last one at the end of the plan.
    expect(RETEST_WEEKS[1]! - RETEST_WEEKS[0]!).toBe(4);
    expect(RETEST_WEEKS[RETEST_WEEKS.length - 1]).toBe(plan.weeks - 1);
  });

  test('the weekly adaptation scales the jogging but keeps the plan gentle', () => {
    const scaled = generatePlan({ ...plan, adjust: { '1': { scalePct: 75, reason: 'overreaching', at: 1 } } });
    const planned = weeks[1]!.sessions[0]!;
    const cut = scaled[1]!.sessions[0]!;
    expect(cut.run!.walkRun!.reps).toBeLessThan(planned.run!.walkRun!.reps);
    expect(cut.run!.walkRun!.reps).toBeGreaterThanOrEqual(3);
    expect(cut.run!.walkRun!.runSec).toBe(planned.run!.walkRun!.runSec);
    const lowContinuous = generatePlan({ ...plan, adjust: { '6': { scalePct: 75, reason: 'low_recovery', at: 1 } } })[6]!.sessions[0]!;
    expect(lowContinuous.run!.walkRun!.runSec / 60).toBeGreaterThanOrEqual(15);
    // The re-test is not volume: the adaptation never touches it.
    const scaledTest = generatePlan({ ...plan, adjust: { '4': { scalePct: 75, reason: 'overreaching', at: 1 } } })[4]!.sessions[2]!;
    expect(scaledTest).toEqual({ ...weeks[4]!.sessions[2]!, scalePct: 75 });
  });
});

describe('Lari-jalan session timeline', () => {
  test('a walk/run session is warm-up, each jog and walk, and a cool-down that carries the last walk', () => {
    const s = weeks[0]!.sessions[0]!;
    const segments = runSegments(s.run);
    expect(segments.map((x) => x.kind)).toEqual(['warmup', ...Array.from({ length: 8 }, (_, i) => (i < 7 ? ['jog', 'walk'] : ['jog'])).flat(), 'cooldown']);
    expect(segments.filter((x) => x.kind === 'jog').length).toBe(8);
    expect(segments[0]).toEqual({ kind: 'warmup', startSec: 0, lengthSec: 300 });
    expect(segments[1]).toEqual({ kind: 'jog', startSec: 300, lengthSec: 60 });
    expect(segments[2]).toEqual({ kind: 'walk', startSec: 360, lengthSec: 120 });
    // The walk after the 8th jog is the start of the 5 minute cool-down: 7 minutes in all.
    expect(segments[segments.length - 1]!.lengthSec).toBe(5 * 60 + 120);
    expect(totalSec(segments)).toBe(s.minutes * 60);
    for (let i = 1; i < segments.length; i++) expect(segments[i]!.startSec).toBe(segments[i - 1]!.startSec + segments[i - 1]!.lengthSec);
  });

  test('every walk/run and continuous session of the plan adds up to its planned minutes, give or take the rounding to a minute', () => {
    for (const s of sessions.filter((x) => x.run?.walkRun)) expect(Math.abs(totalSec(runSegments(s.run)) - s.minutes * 60)).toBeLessThanOrEqual(30);
    const continuous = sessions.find((s) => s.type === 'easy')!;
    expect(runSegments(continuous.run).map((x) => x.kind)).toEqual(['warmup', 'jog', 'cooldown']);
  });

  test('a session without a walk/run spec has no timeline', () => {
    expect(runSegments(sessions.find((s) => s.type === 'retest')!.run)).toEqual([]);
    expect(runSegments(null)).toEqual([]);
  });

  test('the position follows the wall clock, also after a restart', () => {
    const segments = runSegments(weeks[0]!.sessions[0]!.run);
    const start = 1_000_000;
    const at = (sec: number) => positionAt(segments, start, start + sec * 1000);
    expect(at(0)).toMatchObject({ index: 0, leftSec: 300, done: false });
    expect(at(299)).toMatchObject({ index: 0, leftSec: 1 });
    expect(at(300)).toMatchObject({ index: 1, leftSec: 60, done: false });
    expect(at(300).segment!.kind).toBe('jog');
    expect(at(300).next!.kind).toBe('walk');
    expect(at(361).segment!.kind).toBe('walk');
    const end = totalSec(segments);
    expect(at(end - 1).segment!.kind).toBe('cooldown');
    expect(at(end)).toMatchObject({ done: true, leftSec: 0, segment: null, elapsedSec: end });
    expect(at(end + 9999).done).toBe(true);
    // A clock before the start (a changed phone time) stays at the beginning.
    expect(positionAt(segments, start, start - 5000)).toMatchObject({ index: 0, done: false });
  });

  test('a cue for every change after the first segment, and one for the end', () => {
    const segments = runSegments(weeks[0]!.sessions[0]!.run);
    const cues = timedCues(segments);
    expect(cues.length).toBe(segments.length);
    expect(cues[0]).toEqual({ afterSec: 300, kind: 'jog', lengthSec: 60 });
    expect(cues[1]).toEqual({ afterSec: 360, kind: 'walk', lengthSec: 120 });
    expect(cues[cues.length - 1]).toEqual({ afterSec: totalSec(segments), kind: 'done', lengthSec: 0 });
    // Few enough to schedule as local notifications.
    for (const s of sessions) expect(timedCues(runSegments(s.run)).length).toBeLessThanOrEqual(30);
  });
});

// Zone limits of a 190 bpm maximum: zone 1 from 95, 2 from 114, 3 from 133, 4 from 152, 5 from 171.
const zones = { bounds: [95, 114, 133, 152, 171] };
const input = (over: Partial<HrCueInput>): HrCueInput => ({ hr: 120, nowMs: 0, zones, walkAtZone: 4, segmentKind: 'jog', segmentIndex: 1, ...over });

/** Feeds one reading a second for `seconds` and returns the cues that fired with the final state. */
function feed(state: HrCueState, hr: number | null, seconds: number, startMs: number, over: Partial<HrCueInput> = {}) {
  const cues: string[] = [];
  let current = state;
  for (let s = 0; s <= seconds; s++) {
    const step = nextHrCue(current, input({ hr, nowMs: startMs + s * 1000, ...over }));
    current = step.state;
    if (step.cue) cues.push(`${step.cue}@${s}`);
  }
  return { cues, state: current };
}

describe('heart-rate cue', () => {
  test('walk is cued once the heart rate has stayed in zone 4 for a few seconds, and only once', () => {
    const quick = feed(FRESH_HR_STATE, 160, HIGH_HOLD_MS / 1000 - 1, 0);
    expect(quick.cues).toEqual([]);
    const held = feed(FRESH_HR_STATE, 160, 30, 0);
    expect(held.cues).toEqual([`walk@${HIGH_HOLD_MS / 1000}`]);
    expect(held.state.walking).toBe(true);
  });

  test('uses the zones it is given: the same heart rate in a wider zone 4 is no cue', () => {
    const wide = { bounds: [95, 114, 133, 165, 180] };
    expect(feed(FRESH_HR_STATE, 160, 30, 0, { zones: wide }).cues).toEqual([]);
    expect(feed(FRESH_HR_STATE, 166, 30, 0, { zones: wide }).cues.length).toBe(1);
  });

  test('a single spike, or dipping out of the zone, starts the count again', () => {
    let state = feed(FRESH_HR_STATE, 160, 5, 0).state;
    state = nextHrCue(state, input({ hr: 140, nowMs: 6000 })).state;
    expect(state.highSince).toBeNull();
    const again = feed(state, 160, 7, 7000);
    expect(again.cues).toEqual([]);
  });

  test('after the walk cue, jogging again is cued when the heart rate is back in zone 2', () => {
    const walked = feed(FRESH_HR_STATE, 160, 10, 0);
    // Still in zone 3: not yet.
    expect(feed(walked.state, 140, 30, 20_000).cues).toEqual([]);
    const settled = feed(walked.state, 120, 30, 20_000);
    expect(settled.cues).toEqual([`resume@${LOW_HOLD_MS / 1000}`]);
    expect(settled.state.walking).toBe(false);
    // And it can cue walk again later in the same stretch.
    expect(feed(settled.state, 165, 30, 60_000).cues.length).toBe(1);
  });

  test('only a jog segment cues; a new segment starts clean; no reading means no cue', () => {
    expect(feed(FRESH_HR_STATE, 175, 30, 0, { segmentKind: 'walk' }).cues).toEqual([]);
    expect(feed(FRESH_HR_STATE, 175, 30, 0, { segmentKind: 'warmup' }).cues).toEqual([]);
    expect(feed(FRESH_HR_STATE, 175, 30, 0, { segmentKind: 'cooldown' }).cues).toEqual([]);
    expect(feed(FRESH_HR_STATE, null, 30, 0).cues).toEqual([]);
    const walking = feed(FRESH_HR_STATE, 160, 10, 0).state;
    // The next jog is a new segment: the old "walking" is forgotten and it can cue again.
    const next = feed(walking, 160, 10, 100_000, { segmentIndex: 3 });
    expect(next.cues).toEqual([`walk@${HIGH_HOLD_MS / 1000}`]);
  });

  test('only a recent live reading counts', () => {
    const reading = { heartRate: 150, updatedAt: 100_000, status: 'running' };
    expect(liveHr(reading, 100_000 + STALE_HR_MS)).toBe(150);
    expect(liveHr(reading, 100_000 + STALE_HR_MS + 1)).toBeNull();
    expect(liveHr({ ...reading, status: 'paused' }, 100_000)).toBeNull();
    expect(liveHr({ ...reading, heartRate: null }, 100_000)).toBeNull();
    expect(liveHr({ ...reading, heartRate: 0 }, 100_000)).toBeNull();
    expect(liveHr(null, 0)).toBeNull();
  });

  test('the re-test band says under, in or over', () => {
    expect(bandStatus(130, 133, 151)).toBe('below');
    expect(bandStatus(133, 133, 151)).toBe('in');
    expect(bandStatus(151, 133, 151)).toBe('in');
    expect(bandStatus(152, 133, 151)).toBe('above');
  });
});

const meta = { planId: 'p1', sessionKey: 'p1:0:2', fromBpm: 133, toBpm: 151 };

describe('1 km re-test result', () => {
  test('the pace is the time over the measured distance', () => {
    const r = finishRetest({ startedAt: 0, endedAt: 660_000, distanceM: 1010, hrSum: 145 * 40, hrCount: 40 }, meta);
    expect(r.measured).toBe('gps');
    expect(r.secKm).toBe(Math.round(660 / 1.01));
    expect(r.avgHr).toBe(145);
    expect(r.at).toBe(660_000);
    expect(r.fromBpm).toBe(133);
  });

  test('without a live distance (or a tap far short of 1 km) the km is taken as 1 km and the result says so', () => {
    expect(finishRetest({ startedAt: 0, endedAt: 600_000, distanceM: null, hrSum: 0, hrCount: 0 }, meta)).toMatchObject({ secKm: 600, measured: 'tap', avgHr: null });
    expect(finishRetest({ startedAt: 0, endedAt: 600_000, distanceM: 600, hrSum: 0, hrCount: 0 }, meta)).toMatchObject({ secKm: 600, measured: 'tap' });
  });

  test('an average heart rate needs enough readings', () => {
    const few = finishRetest({ startedAt: 0, endedAt: 600_000, distanceM: 1000, hrSum: 150 * (MIN_HR_READINGS - 1), hrCount: MIN_HR_READINGS - 1 }, meta);
    expect(few.avgHr).toBeNull();
    const enough = finishRetest({ startedAt: 0, endedAt: 600_000, distanceM: 1000, hrSum: 150 * MIN_HR_READINGS, hrCount: MIN_HR_READINGS }, meta);
    expect(enough.avgHr).toBe(150);
  });

  const result = (n: number, secKm: number, avgHr: number | null, planId = 'p1'): RetestResult => ({
    planId,
    sessionKey: `${planId}:${n}:2`,
    at: n * 1_000_000,
    secKm,
    avgHr,
    fromBpm: 133,
    toBpm: 151,
    measured: 'gps',
  });

  test('later tests are compared with the first when the heart rates match, never otherwise', () => {
    const steps = retestHistory([result(4, 640, 146), result(0, 700, 144), result(7, 610, 160), result(9, 600, 149)], 'p1');
    expect(steps.map((s) => s.result.secKm)).toEqual([700, 640, 610, 600]);
    expect(steps[0]).toMatchObject({ deltaSecKm: null, comparable: false });
    expect(steps[1]).toMatchObject({ deltaSecKm: -60, comparable: true });
    // 16 bpm above the first test's rate: not the same effort.
    expect(steps[2]).toMatchObject({ deltaSecKm: null, comparable: false });
    expect(steps[3]).toMatchObject({ deltaSecKm: -100, comparable: true });
    expect(149 - 144).toBeLessThanOrEqual(COMPARABLE_HR_GAP);
  });

  test('a test with no heart rate is not compared, and another plan is not mixed in', () => {
    const steps = retestHistory([result(0, 700, null), result(4, 650, 145), result(5, 400, 145, 'other')], 'p1');
    expect(steps.length).toBe(2);
    expect(steps[1]).toMatchObject({ deltaSecKm: null, comparable: false });
    expect(retestHistory([], 'p1')).toEqual([]);
  });

  test('saved results survive a round trip, a repeated test replaces its session, and junk is dropped', () => {
    const a = result(0, 700, 144);
    const b = result(4, 650, 145);
    const saved = withResult(withResult([], a), b);
    expect(parseRetests(JSON.stringify(saved))).toEqual(saved);
    expect(withResult(saved, { ...a, secKm: 690 }).filter((r) => r.sessionKey === a.sessionKey)).toEqual([{ ...a, secKm: 690 }]);
    expect(parseRetests('not json')).toEqual([]);
    expect(parseRetests(null)).toEqual([]);
    expect(parseRetests(JSON.stringify([a, { planId: 1 }, { ...b, secKm: -3 }, 'x']))).toEqual([a]);
  });
});

const BASE: SuggestionInput = {
  readiness: 'Balanced',
  feel: null,
  load: { status: 'maintaining', ratio: 1 },
  hrv: 'balanced',
  lastNightMin: 450,
  sleepDebtMin: 30,
  strainYesterday: 6,
  strainDayBefore: 5,
  activeStreak: 0,
  recoveryHoursLeft: 0,
  trainedToday: null,
  usualSport: 'run',
  planned: null,
  plannedDone: false,
  missed: null,
  planState: 'active',
  restIdeas: true,
};
const walkRunSession = sessions[0]!;
const retestSession = sessions.find((s) => s.type === 'retest')!;
const continuousSession = sessions.find((s) => s.type === 'easy')!;

describe('Lari-jalan in the daily suggestion', () => {
  test('a rested body does the session as written', () => {
    expect(suggest({ ...BASE, planned: walkRunSession }).kind).toBe('session');
    expect(suggest({ ...BASE, planned: walkRunSession }).effective).toEqual({ type: 'walkrun', minutes: 34, zone: 3 });
  });

  test('a tired body gets a brisk walk, never a run', () => {
    const tired = { ...BASE, readiness: 'Strained' as const, sleepDebtMin: 200 };
    for (const planned of [walkRunSession, continuousSession, retestSession]) {
      const s = suggest({ ...tired, planned });
      expect(s.band).toBe('tired');
      expect(s.kind).toBe('sessionEasier');
      expect(s.effective!.type).toBe('walk');
    }
    // A regular plan keeps its easy run on a tired day.
    const regular = generatePlan(buildPlan({ kind: 'run', goal: 'run10k', level: 'intermediate', daysPerWeek: 3, setting: null, weekdays: defaultWeekdays(3) }, dayStartSec(MONDAY) * 1000 + 6 * 3600_000))[0]!.sessions[1]!;
    expect(suggest({ ...tired, planned: regular }).effective!.type).toBe('easy');
  });

  test('a fair day scales the jogging but never the re-test', () => {
    const fair = { ...BASE, lastNightMin: 400, sleepDebtMin: 100 };
    expect(suggest({ ...fair, planned: walkRunSession }).kind).toBe('sessionScaled');
    const test = suggest({ ...fair, planned: retestSession });
    expect(test.band).toBe('ok');
    expect(test.kind).toBe('session');
    expect(test.effective!.minutes).toBe(retestSession.minutes);
  });

  test('a rest day suggests a brisk walk or an easy ride, only for this plan', () => {
    expect(suggest(BASE).kind).toBe('planRestDay');
    expect(suggest(BASE).restIdeas).toBe(true);
    expect(suggest({ ...BASE, restIdeas: false }).restIdeas).toBe(false);
    // The ideas are advice on a rest day: an exhausted body is just told to rest.
    expect(suggest({ ...BASE, readiness: 'Run down', hrv: 'low', lastNightMin: 300 }).restIdeas).toBe(false);
  });
});

function run(day: string, minutes: number, extra: Partial<MatchWorkout> = {}): MatchWorkout {
  return { start: dayStartSec(day) + 12 * 3600, duration: minutes * 60, distance: minutes * 100, sportName: 'Running', summaryKind: 'RUNNING', ...extra };
}

describe('Lari-jalan matched to watch workouts', () => {
  test('a walk workout counts for a session that is part walking, and 60 % of the time is enough', () => {
    const walk = { sportName: 'Walking', summaryKind: 'WALKING' };
    for (const s of [walkRunSession, continuousSession, retestSession] as PlannedSession[]) {
      const exact = matchWorkouts([s], {}, [run(s.day, s.minutes, walk)], 1);
      expect(Object.keys(exact)).toEqual([s.key]);
      const short = matchWorkouts([s], {}, [run(s.day, Math.ceil(s.minutes * 0.6), walk)], 1);
      expect(Object.keys(short)).toEqual([s.key]);
      expect(matchWorkouts([s], {}, [run(s.day, Math.floor(s.minutes * 0.5), walk)], 1)).toEqual({});
    }
  });

  test('a cycling workout does not', () => {
    expect(matchWorkouts([walkRunSession], {}, [run(walkRunSession.day, 60, { sportName: 'Cycling', summaryKind: 'CYCLING' })], 1)).toEqual({});
  });
});

function analysisOf(zoneSec: number[], over: Partial<WorkoutAnalysis> = {}): WorkoutAnalysis {
  const total = zoneSec.reduce((a, b) => a + b, 0);
  return {
    v: 1,
    sport: { name: 'Running', kind: 'run' },
    startedAt: 0,
    elapsedSec: total,
    movingSec: total,
    distanceM: 3000,
    elevation: null,
    series: null,
    splits: [],
    laps: [],
    hrZones: { maxHr: 190, source: 'age', bounds: [95, 114, 133, 152, 171, 190], sec: zoneSec, belowSec: 0 },
    paceZones: { thresholdSecKm: 300, zones: [] },
    bestEfforts: [],
    effort: null,
    load: null,
    calories: null,
    comparison: null,
    stats: { avgHr: null, maxHr: null, minHr: null, avgPaceSecKm: 200, bestPaceSecKm: null, avgSpeedMs: null, maxSpeedMs: null, avgCad: null, maxCad: null, avgPower: null, maxPower: null, normalizedPower: null, avgStrideM: null },
    ...over,
  } as WorkoutAnalysis;
}

describe('Lari-jalan post-workout feedback', () => {
  test('the continuous jog may use zone 3 but not zone 4 for long, and is never judged by pace', () => {
    const s = continuousSession;
    const sec = s.minutes * 60;
    const calm = sessionFeedback(s, analysisOf([sec * 0.3, sec * 0.4, sec * 0.3, 0, 0]))!;
    expect(calm.lines.find((l) => l.key === 'zone')).toMatchObject({ verdict: 'on', values: { target: 3 } });
    // A threshold pace of 300 s/km would call 200 s/km far too fast for an easy run: not for this plan.
    expect(calm.lines.map((l) => l.key)).toEqual(['duration', 'zone']);
    expect(calm.overall).toBe('onTarget');
    const hot = sessionFeedback(s, analysisOf([0, sec * 0.2, sec * 0.3, sec * 0.4, sec * 0.1]))!;
    expect(hot.lines.find((l) => l.key === 'zone')!.verdict).toBe('over');
    expect(hot.overall).toBe('tooHard');
  });

  test('the walk/run flags a heart rate that sat in zone 4 or above too long', () => {
    const s = walkRunSession;
    const sec = s.minutes * 60;
    expect(sessionFeedback(s, analysisOf([sec * 0.4, sec * 0.4, sec * 0.2, 0, 0]))!.lines.find((l) => l.key === 'zone')!.verdict).toBe('on');
    expect(sessionFeedback(s, analysisOf([0, sec * 0.2, sec * 0.3, sec * 0.4, sec * 0.1]))!.lines.find((l) => l.key === 'zone')!.verdict).toBe('over');
  });

  test('the re-test is checked for time only: its km is not the workout distance', () => {
    const s = retestSession;
    const f = sessionFeedback(s, analysisOf([s.minutes * 30, s.minutes * 30, 0, 0, 0], { distanceM: 2400 }))!;
    expect(f.lines.map((l) => l.key)).toEqual(['duration']);
    expect(f.overall).toBe('onTarget');
  });
});
