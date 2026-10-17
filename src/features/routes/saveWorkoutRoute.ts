import type { SQLiteDatabase } from 'expo-sqlite';

import { listWorkoutPoints, listWorkouts, type WorkoutRow } from '@/db/queries';

import { copy } from './copy';
import type { SavedRoute } from './routeModel';
import { saveRoute } from './routeStore';
import { workoutRouteDraft } from './workoutRoute';

export interface WorkoutWithGps {
  workout: WorkoutRow;
  /** Rows with a position. */
  gpsPoints: number;
}

/** Workouts that have a GPS track, newest first. */
export async function listWorkoutsWithGps(db: SQLiteDatabase): Promise<WorkoutWithGps[]> {
  const counts = await db.getAllAsync<{ id: number; n: number }>(
    'SELECT workout_id AS id, COUNT(*) AS n FROM workout_points WHERE lat IS NOT NULL AND lon IS NOT NULL GROUP BY workout_id HAVING COUNT(*) >= 2',
  );
  const byId = new Map(counts.map((row) => [row.id, row.n]));
  const out: WorkoutWithGps[] = [];
  for (const workout of await listWorkouts(db)) {
    const gpsPoints = byId.get(workout.id);
    if (gpsPoints !== undefined) out.push({ workout, gpsPoints });
  }
  return out;
}

/** Saves the GPS track of a stored workout as a route. Throws a readable Error when the workout has no usable track. */
export async function saveWorkoutAsRoute(
  db: SQLiteDatabase,
  workout: Pick<WorkoutRow, 'id' | 'sportName' | 'start'>,
): Promise<SavedRoute> {
  const rows = await listWorkoutPoints(db, workout.id);
  const draft = workoutRouteDraft(copy.workoutPicker.defaultName(workout.sportName, workout.start), rows);
  if (draft === null) throw new Error(copy.workoutPicker.noGps);
  return saveRoute(draft);
}
