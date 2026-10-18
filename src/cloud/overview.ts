import type { SQLiteDatabase } from 'expo-sqlite';

import { estimateBytes } from '@/cloud/estimate';
import { parseFailures, partitionPending } from '@/cloud/workoutFailures';
import {
  countPendingRows,
  getCloudState,
  getCloudValue,
  getUploadedStats,
  listPendingWorkouts,
  WORKOUT_FAILED_KEY,
  type CloudState,
} from '@/db/cloud';
import { ANALYSIS_ENGINE_REV } from '@/features/workouts/analysis/engineRev';

/** What the phone knows about its cloud sync without asking the network. */
export interface CloudOverview {
  state: CloudState;
  /** Step samples and sleep segments waiting for the JoyoFit cloud. */
  pendingRows: number;
  /** Workouts waiting for JoyoRogo (not counting the ones the cloud refused). */
  pendingWorkouts: number;
  /** Estimated gzip bytes of those workouts. */
  pendingBytes: number;
  /** Workouts the cloud refused in their current state, and the last reason. */
  refusedWorkouts: number;
  refusedError: string | null;
}

export async function loadOverview(db: SQLiteDatabase, build: string): Promise<CloudOverview> {
  const [state, pendingRows, pending, uploaded, failedRaw] = await Promise.all([
    getCloudState(db),
    countPendingRows(db),
    listPendingWorkouts(db, ANALYSIS_ENGINE_REV),
    getUploadedStats(db),
    getCloudValue(db, WORKOUT_FAILED_KEY),
  ]);
  const failures = parseFailures(failedRaw, build);
  const { todo, refused } = partitionPending(pending, failures);
  const points = todo.reduce((sum, w) => sum + w.points, 0);
  return {
    state,
    pendingRows,
    pendingWorkouts: todo.length,
    pendingBytes: estimateBytes(todo.length, points, uploaded),
    refusedWorkouts: refused.length,
    refusedError: refused.length > 0 ? failures.lastError : null,
  };
}
