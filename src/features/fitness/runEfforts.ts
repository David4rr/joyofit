import type { SQLiteDatabase } from 'expo-sqlite';
import { useEffect, useState } from 'react';

import { listWorkoutPoints, type WorkoutRow } from '@/db/queries';
import { bestEffortsForHistory, type EffortSeconds } from '@/features/workouts/analysis/efforts';
import { sportKind } from '@/features/workouts/analysis/sport';
import type { FitnessWorkout } from '@/features/fitness/useFitnessData';

/** Days of runs the race predictor looks back over. */
export const RUN_WINDOW_DAYS = 90;

/** Best efforts per finished run; a download that completed never changes, so each run's points are read once. */
const cache = new Map<number, EffortSeconds>();

/** Runs of the last `RUN_WINDOW_DAYS` days, from the workouts already loaded. */
export function recentRuns(workouts: readonly FitnessWorkout[], nowSec: number): WorkoutRow[] {
  return workouts
    .filter(({ workout, summary }) => workout.start >= nowSec - RUN_WINDOW_DAYS * 86400 && sportKind(workout.sportName, summary.kind) === 'run')
    .map(({ workout }) => workout);
}

/** One best-effort set per run, using the workout analysis's own `bestEffortsForHistory`; runs with no GPS stretch of 400 m or more are left out. */
export async function loadRunEfforts(db: SQLiteDatabase, runs: readonly WorkoutRow[]): Promise<EffortSeconds[]> {
  const out: EffortSeconds[] = [];
  for (const run of runs) {
    let efforts = cache.get(run.id);
    if (efforts === undefined) {
      efforts = bestEffortsForHistory(await listWorkoutPoints(db, run.id), 'run');
      if (run.complete) cache.set(run.id, efforts);
    }
    if (Object.keys(efforts).length > 0) out.push(efforts);
  }
  return out;
}

/** Best efforts of `runs`, null while they are being read (they come from GPS points, one query per run). */
export function useRunEfforts(db: SQLiteDatabase, runs: readonly WorkoutRow[] | null): EffortSeconds[] | null {
  const [state, setState] = useState<{ runs: readonly WorkoutRow[]; efforts: EffortSeconds[] } | null>(null);
  useEffect(() => {
    if (runs === null) return;
    let cancelled = false;
    loadRunEfforts(db, runs).then(
      (efforts) => {
        if (!cancelled) setState({ runs, efforts });
      },
      () => {
        if (!cancelled) setState({ runs, efforts: [] });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [db, runs]);
  return state && state.runs === runs ? state.efforts : null;
}
