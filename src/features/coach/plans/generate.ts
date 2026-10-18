import type { CoachPlan } from '../doc';
import { sessionKey } from '../doc';
import { addDays, daysBetween, localDay } from '../time';
import { recipeFor, runSession, weekPhase } from './run';
import type { PlannedSession, PlannedWeek } from './types';

/** Scale of a week: the weekly adaptation, 100 % when none was decided. */
export function weekScalePct(plan: Pick<CoachPlan, 'adjust'>, week: number): number {
  return plan.adjust[String(week)]?.scalePct ?? 100;
}

/**
 * Every week and session of a plan. Pure: the same parameters give the same sessions on every phone, which is why the
 * plan document stores parameters and adaptations, not sessions. A session before the day the plan was made is kept
 * (it shows greyed) but flagged `beforeStart`, so the first week is never already behind.
 */
export function generatePlan(plan: CoachPlan): PlannedWeek[] {
  if (plan.kind !== 'run') return [];
  const raceGoal = recipeFor(plan.goal, plan.level).raceM !== null;
  const createdDay = localDay(Math.floor(plan.createdAt / 1000));
  const weeks: PlannedWeek[] = [];
  for (let week = 0; week < plan.weeks; week++) {
    const startDay = addDays(plan.startDay, week * 7);
    const scalePct = weekScalePct(plan, week);
    const sessions: PlannedSession[] = plan.weekdays.slice(0, plan.daysPerWeek).map((weekday, slot) => {
      const day = addDays(startDay, weekday);
      const built = runSession(plan, week, slot, scalePct / 100);
      return {
        key: sessionKey(plan.id, week, slot),
        week,
        slot,
        day,
        weekday,
        kind: plan.kind,
        type: built.type,
        minutes: built.minutes,
        hard: built.hard,
        run: built.run,
        strength: null,
        scalePct,
        beforeStart: daysBetween(createdDay, day) < 0,
      };
    });
    weeks.push({ index: week, startDay, phase: weekPhase(week, plan.weeks, raceGoal), scalePct, sessions });
  }
  return weeks;
}

/** The week index that contains `day`: -1 before the plan starts, `plan.weeks` or more after it ends. */
export function weekIndexAt(plan: Pick<CoachPlan, 'startDay'>, day: string): number {
  return Math.floor(daysBetween(plan.startDay, day) / 7);
}

/** All sessions of the plan in date order. */
export function allSessions(weeks: readonly PlannedWeek[]): PlannedSession[] {
  return weeks.flatMap((w) => w.sessions);
}
