import type { SQLiteDatabase } from 'expo-sqlite';

import { listWorkoutPoints, listWorkoutsSince, type WorkoutRow } from '@/db/queries';
import { workoutStrain } from '@/features/today/strain';
import { parseSummary } from '@/features/workouts/summary';

import type { AnalysisHistory } from './analyze';
import { bestEffortsForHistory, type EffortSeconds } from './efforts';
import type { TrimpEntry } from './effort';
import type { SimilarCandidate } from './similar';
import { isFootKind, sportKind } from './sport';

const DAY_SEC = 86400;
const HISTORY_DAYS = 120;
const TRIMP_DAYS = 28;
const MAX_SAME_SPORT = 40;
const MAX_TRIMP_WORKOUTS = 60;
const MIN_BPM = 20;
const MAX_BPM = 250;

/**
 * What `analyzeWorkout` needs from the workouts before this one: best-effort seconds and similar-workout candidates from
 * the last 120 days of the same sport (newest 40), and the TRIMP of every workout of the last 28 days (newest 60). One
 * summary query, then each workout's points once and in turn: only for the on-foot best efforts and for the TRIMP set.
 */
export async function loadAnalysisHistory(db: SQLiteDatabase, workout: WorkoutRow, maxHr: number): Promise<AnalysisHistory> {
  const rows = await listWorkoutsSince(db, workout.start - HISTORY_DAYS * DAY_SEC, workout.start, workout.id);
  const sameSport = rows.filter((r) => r.workout.sportName === workout.sportName).slice(0, MAX_SAME_SPORT);
  const recent = rows.filter((r) => r.workout.start > workout.start - TRIMP_DAYS * DAY_SEC).slice(0, MAX_TRIMP_WORKOUTS);

  const similar: SimilarCandidate[] = sameSport.map(({ workout: w, summaryJson }) => {
    const summary = parseSummary(summaryJson);
    return {
      id: w.id,
      start: w.start,
      duration: w.duration,
      distance: w.distance,
      sportName: w.sportName,
      kind: sportKind(w.sportName, summary.kind),
      avgHr: w.avgHr,
      gain: typeof summary.elevationGain === 'number' ? summary.elevationGain : null,
    };
  });

  const kind = sportKind(workout.sportName);
  const effortIds = new Set(isFootKind(kind) ? sameSport.map((r) => r.workout.id) : []);
  const trimpIds = new Set(recent.map((r) => r.workout.id));
  const efforts: EffortSeconds[] = [];
  const trimps: TrimpEntry[] = [];
  for (const { workout: w } of rows) {
    const wantsEffort = effortIds.has(w.id);
    if (!wantsEffort && !trimpIds.has(w.id)) continue;
    const points = await listWorkoutPoints(db, w.id);
    if (wantsEffort) {
      const best = bestEffortsForHistory(points, kind);
      if (Object.keys(best).length > 0) efforts.push(best);
    }
    if (trimpIds.has(w.id)) {
      const strain = workoutStrain(
        points.filter((p) => p.hr !== null && p.hr >= MIN_BPM && p.hr <= MAX_BPM),
        maxHr,
      );
      if (strain) trimps.push({ start: w.start, trimp: strain.trimp });
    }
  }
  return { efforts, trimps, similar };
}
