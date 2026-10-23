import type { RunSession } from './run';
import type { HrZone, RunSpec } from './types';

/**
 * Lari-jalan: an 8-week restart plan for someone who is heavier, or has been off running for a long time, and whose heart
 * rate climbs fast ("1 km at 10:00/km already reaches zone 4"). JoyoFit's own progression, not a published programme;
 * `docs/coach.md` lists the same numbers. Three sessions a week, `RUNWALK_WEEKS` weeks.
 *
 *  - Weeks 1 to 6 are walk/run (`RUNWALK_STEPS`): a 5 minute brisk walk, then jog and walk in turns, then a 5 minute walk.
 *    The jog starts at 1 minute against 2 minutes of walking and grows to 8 minutes; the walk stays at 2 minutes.
 *  - Weeks 7 and 8 are one continuous jog (`RUNWALK_CONTINUOUS`): 15, 20 and 20 minutes, then 25 and 30, with the same warm-up and
 *    cool-down. The first one is a bridge from 8-minute blocks, not a jump to 20.
 *  - The pace is not the target, the heart rate is: keep the jog in zones 2 to 3, and the app tells you to walk when your
 *    rate reaches zone 4 (`walkAtZone`), then to jog again once it is back in zone 2. The cue is the person's own zones.
 *  - A 1 km re-test (`retest`: brisk-walk warm-up, 1 km at the heart rate of zone 3, walk down) replaces the last session of
 *    weeks 1, 5 and 8 (`RETEST_WEEKS`): about four weeks apart, then the end of the plan. The pace you reach at that heart
 *    rate is the number to compare; the first one is the baseline.
 *  - Every fourth week is a cut-back at 80 % and the weekly adaptation applies (`plans/run.ts`), like every other plan.
 *  - Brisk walking and easy cycling are only suggested on the rest days (`suggest.ts`); they are never planned sessions.
 */

export const RUNWALK_WEEKS = 8;
export const RUNWALK_DAYS = 3;

/** The jog stays in zones 2 to this one. */
export const RUNWALK_KEEP_ZONE: HrZone = 3;
/** The jog turns into a walk when the heart rate reaches this zone. */
export const RUNWALK_WALK_ZONE: HrZone = 4;
/** After a walk cue, the jog starts again once the heart rate is back in this zone or below. */
export const RUNWALK_RESUME_ZONE: HrZone = 2;

export const RUNWALK_WARMUP_MIN = 5;
export const RUNWALK_COOLDOWN_MIN = 5;
const MIN_REPS = 3;
const MIN_CONTINUOUS_MIN = 15;

export interface RunWalkStep {
  runSec: number;
  walkSec: number;
  reps: number;
}

/** The walk/run weeks 1 to 6, one step a week. The jog grows, the walk does not. */
export const RUNWALK_STEPS: readonly RunWalkStep[] = [
  { runSec: 60, walkSec: 120, reps: 8 },
  { runSec: 90, walkSec: 120, reps: 7 },
  { runSec: 120, walkSec: 120, reps: 6 },
  { runSec: 180, walkSec: 120, reps: 5 },
  { runSec: 300, walkSec: 120, reps: 4 },
  { runSec: 480, walkSec: 120, reps: 3 },
];

/** Minutes of the continuous jog per session slot, weeks 7 and 8. The last slot of week 8 is the final re-test, so that row has two. */
export const RUNWALK_CONTINUOUS: readonly (readonly number[])[] = [
  [15, 20, 20],
  [25, 30],
];

export const RETEST_DISTANCE_M = 1000;
export const RETEST_WARMUP_MIN = 10;
export const RETEST_COOLDOWN_MIN = 5;
/** Minutes counted for the 1 km itself in the session's total (a slow jog at 12 min/km). */
export const RETEST_ALLOWANCE_MIN = 12;
/** Week indexes (0-based) whose last session is the re-test. */
export const RETEST_WEEKS: readonly number[] = [0, 4, 7];

export const isRunWalkRetest = (week: number, slot: number): boolean => slot === RUNWALK_DAYS - 1 && RETEST_WEEKS.includes(week);

const walkAtZone = RUNWALK_WALK_ZONE;
const roundTo5 = (minutes: number): number => Math.max(MIN_CONTINUOUS_MIN, Math.round(minutes / 5) * 5);

/** The session of a week and slot. `factor` is the cut-back of the week times the weekly adaptation (1 = as planned). */
export function runWalkSession(week: number, slot: number, factor: number): RunSession {
  if (isRunWalkRetest(week, slot)) {
    const retest = { warmupMin: RETEST_WARMUP_MIN, cooldownMin: RETEST_COOLDOWN_MIN };
    const run: RunSpec = { type: 'retest', zone: RUNWALK_KEEP_ZONE, distanceM: RETEST_DISTANCE_M, walkRun: null, tempo: null, intervals: null, retest, walkAtZone: null };
    return { type: 'retest', minutes: RETEST_WARMUP_MIN + RETEST_ALLOWANCE_MIN + RETEST_COOLDOWN_MIN, hard: false, run };
  }

  const intervalWeeks = RUNWALK_STEPS.length;
  if (week < intervalWeeks) {
    const step = RUNWALK_STEPS[week]!;
    const reps = Math.max(MIN_REPS, Math.round(step.reps * factor));
    const walkRun = { warmupMin: RUNWALK_WARMUP_MIN, runSec: step.runSec, walkSec: step.walkSec, reps, cooldownMin: RUNWALK_COOLDOWN_MIN };
    const minutes = RUNWALK_WARMUP_MIN + RUNWALK_COOLDOWN_MIN + Math.round((reps * (step.runSec + step.walkSec)) / 60);
    const run: RunSpec = { type: 'walkrun', zone: RUNWALK_KEEP_ZONE, distanceM: null, walkRun, tempo: null, intervals: null, retest: null, walkAtZone };
    return { type: 'walkrun', minutes, hard: false, run };
  }

  const row = RUNWALK_CONTINUOUS[Math.min(RUNWALK_CONTINUOUS.length - 1, week - intervalWeeks)]!;
  const base = row[Math.min(row.length - 1, slot)]!;
  const main = roundTo5(base * factor);
  const walkRun = { warmupMin: RUNWALK_WARMUP_MIN, runSec: main * 60, walkSec: 0, reps: 1, cooldownMin: RUNWALK_COOLDOWN_MIN };
  const run: RunSpec = { type: 'easy', zone: RUNWALK_KEEP_ZONE, distanceM: null, walkRun, tempo: null, intervals: null, retest: null, walkAtZone };
  return { type: 'easy', minutes: RUNWALK_WARMUP_MIN + main + RUNWALK_COOLDOWN_MIN, hard: false, run };
}
