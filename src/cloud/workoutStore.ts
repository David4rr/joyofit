import type { SQLiteDatabase } from 'expo-sqlite';

import { upsertCloudWorkout } from '@/db/cloud';
import { decodePoints, type WatchWorkoutDoc } from '@/cloud/workoutDoc';

/** Point rows per INSERT: 10 bound values each stay under SQLite's 999-variable limit (as the FIT import). */
const CHUNK = 90;

/** What the server said about the document being restored. */
export interface RestoredFrom {
  version: number;
  /** SHA-256 of the gzip bytes. */
  hash: string;
  /** Gzip bytes. */
  bytes: number;
}

type RestoreDb = Pick<SQLiteDatabase, 'withExclusiveTransactionAsync'>;

/**
 * Writes a workout downloaded from the cloud into the local tables: the `workouts` row, all its points, and the
 * `cloud_workout` row carrying the NEW local `rev`, so the workout is not uploaded again. All in one transaction, and the
 * insert ignores a `start` the phone already has: a local row is never overwritten. False when the phone had it.
 */
export async function restoreWorkout(db: RestoreDb, doc: WatchWorkoutDoc, from: RestoredFrom): Promise<boolean> {
  const w = doc.workout;
  const points = decodePoints(doc.points);
  let restored = false;
  await db.withExclusiveTransactionAsync(async (txn) => {
    const inserted = await txn.runAsync(
      `INSERT OR IGNORE INTO workouts
         (workout_number, start, end, sport_type, sport_name, duration, distance, calories, avg_hr, max_hr, steps, summary_json, complete, imported)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [w.workoutNumber, w.start, w.end, w.sportType, w.sportName, w.duration, w.distance, w.calories, w.avgHr, w.maxHr, w.steps, w.summaryJson, w.complete ? 1 : 0, w.imported ? 1 : 0],
    );
    if (inserted.changes === 0) return;
    const id = inserted.lastInsertRowId;
    for (let i = 0; i < points.length; i += CHUNK) {
      const chunk = points.slice(i, i + CHUNK);
      await txn.runAsync(
        `INSERT INTO workout_points (workout_id, ts, lat, lon, alt, hr, speed, cadence, stride, power)
         VALUES ${chunk.map(() => '(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').join(', ')}`,
        chunk.flatMap((p) => [id, p.ts, p.lat, p.lon, p.alt, p.hr, p.speed, p.cadence, p.stride, p.power]),
      );
    }
    // The insert trigger has just given the row its `rev`.
    const row = await txn.getFirstAsync<{ rev: number }>('SELECT rev FROM workouts WHERE id = ?', id);
    await upsertCloudWorkout(txn, {
      start: w.start,
      rev: row?.rev ?? 0,
      engineRev: doc.engineRev,
      version: from.version,
      hash: from.hash,
      bytes: from.bytes,
      uploadedAt: Math.floor(Date.now() / 1000),
    });
    restored = true;
  });
  return restored;
}

/** Drops the local copy of the workout that started at `start`, its points and its `cloud_workout` row (a delete made elsewhere). */
export async function deleteLocalWorkout(db: RestoreDb, start: number): Promise<void> {
  await db.withExclusiveTransactionAsync(async (txn) => {
    await txn.runAsync('DELETE FROM workout_points WHERE workout_id IN (SELECT id FROM workouts WHERE start = ?)', start);
    await txn.runAsync('DELETE FROM workouts WHERE start = ?', start);
    await txn.runAsync('DELETE FROM cloud_workout WHERE start = ?', start);
  });
}
