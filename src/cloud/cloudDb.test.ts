import { Database } from 'bun:sqlite';
import { describe, expect, it } from 'bun:test';
import type { SQLiteDatabase } from 'expo-sqlite';

import migrations from '../../modules/huawei-wear/schema/joyofit-db-migrations.json';
import {
  adoptAccount,
  countPendingRows,
  getCloudState,
  getCloudValue,
  getUploadedStats,
  getWorkoutCloudInfo,
  listPendingWorkouts,
  setCloudState,
  upsertCloudWorkout,
  WORKOUT_FAILED_KEY,
  WORKOUT_PULL_CURSOR_KEY,
} from '@/db/cloud';

import { loadOverview } from './overview';
import { buildWorkoutDoc, encodePoints, type WatchPoint } from './workoutDoc';
import { noFailures, recordFailure } from './workoutFailures';
import { deleteLocalWorkout, restoreWorkout } from './workoutStore';

const START = 1_792_058_016;
const BUILD = '1.0+1';

/** The real schema in memory, behind the slice of expo-sqlite the cloud code uses. */
function openDb() {
  const raw = new Database(':memory:');
  for (const statements of migrations) raw.exec(statements.join(';\n'));
  const flat = (params: unknown[]) => (params.length === 1 && Array.isArray(params[0]) ? params[0] : params) as never[];
  const txn = {
    getAllAsync: async (sql: string, ...params: unknown[]) => raw.query(sql).all(...flat(params)),
    getFirstAsync: async (sql: string, ...params: unknown[]) => raw.query(sql).get(...flat(params)),
    runAsync: async (sql: string, ...params: unknown[]) => {
      const r = raw.query(sql).run(...flat(params));
      return { lastInsertRowId: Number(r.lastInsertRowid), changes: r.changes };
    },
  };
  const db = {
    ...txn,
    withTransactionAsync: async (task: () => Promise<void>) => task(),
    withExclusiveTransactionAsync: async (task: (t: typeof txn) => Promise<void>) => {
      raw.exec('BEGIN');
      try {
        await task(txn);
        raw.exec('COMMIT');
      } catch (e) {
        raw.exec('ROLLBACK');
        throw e;
      }
    },
  } as unknown as SQLiteDatabase;
  const one = <T>(sql: string, ...params: unknown[]) => raw.query(sql).get(...(params as never[])) as T;
  const all = <T>(sql: string, ...params: unknown[]) => raw.query(sql).all(...(params as never[])) as T[];
  return { raw, db, one, all };
}

type Fixture = ReturnType<typeof openDb>;

function addWorkout(f: Fixture, start: number, over: { imported?: number; complete?: number; points?: number } = {}): number {
  f.raw.exec(
    `INSERT INTO workouts (workout_number, start, end, sport_type, sport_name, duration, distance, calories, avg_hr, max_hr, steps, summary_json, complete, imported)
     VALUES (1, ${start}, ${start + 600}, 1, 'Running', 600, 1000, 50, 130, 160, 10, '{}', ${over.complete ?? 1}, ${over.imported ?? 0})`,
  );
  const id = f.one<{ id: number }>('SELECT id FROM workouts WHERE start = ?', start).id;
  for (let i = 0; i < (over.points ?? 3); i++) {
    f.raw.exec(`INSERT INTO workout_points (workout_id, ts, lat, lon, alt, hr) VALUES (${id}, ${start + i}, -6.2, 106.8, 10, 120)`);
  }
  return id;
}

const uploaded = (f: Fixture, start: number, over: { rev?: number; engineRev?: number; bytes?: number } = {}) =>
  upsertCloudWorkout(f.db, {
    start,
    rev: over.rev ?? f.one<{ rev: number }>('SELECT rev FROM workouts WHERE start = ?', start).rev,
    engineRev: over.engineRev ?? 2,
    version: 1,
    hash: 'abc',
    bytes: over.bytes ?? 30_000,
    uploadedAt: 1_800_000_000,
  });

describe('listPendingWorkouts', () => {
  it('lists every workout without a cloud row, newest first, whatever its source or state', async () => {
    const f = openDb();
    addWorkout(f, START);
    addWorkout(f, START + 10_000, { imported: 1 });
    addWorkout(f, START + 20_000, { complete: 0 });
    const pending = await listPendingWorkouts(f.db, 2);
    expect(pending.map((p) => p.start)).toEqual([START + 20_000, START + 10_000, START]);
    expect(pending.every((p) => p.points === 3)).toBe(true);
  });

  it('skips a workout whose cloud copy is current', async () => {
    const f = openDb();
    addWorkout(f, START);
    await uploaded(f, START);
    expect(await listPendingWorkouts(f.db, 2)).toEqual([]);
  });

  it('lists a workout again when its rev moved after the upload', async () => {
    const f = openDb();
    addWorkout(f, START);
    await uploaded(f, START);
    f.raw.exec(`UPDATE workouts SET complete = 0 WHERE start = ${START}`);
    expect((await listPendingWorkouts(f.db, 2)).map((p) => p.start)).toEqual([START]);
  });

  it('lists a workout again when its analysis came from an older engine', async () => {
    const f = openDb();
    addWorkout(f, START);
    await uploaded(f, START, { engineRev: 1 });
    expect(await listPendingWorkouts(f.db, 1)).toEqual([]);
    expect((await listPendingWorkouts(f.db, 2)).map((p) => p.start)).toEqual([START]);
  });
});

describe('uploaded stats and the per-workout info', () => {
  it('sums the cloud copies and the stored points behind them, not the workouts still to send', async () => {
    const f = openDb();
    addWorkout(f, START, { points: 4 });
    addWorkout(f, START + 1000, { points: 5 });
    addWorkout(f, START + 2000, { points: 100 });
    await uploaded(f, START, { bytes: 1000 });
    await uploaded(f, START + 1000, { bytes: 2500 });
    expect(await getUploadedStats(f.db)).toEqual({ workouts: 2, bytes: 3500, points: 9 });
    expect(await getUploadedStats(openDb().db)).toEqual({ workouts: 0, bytes: 0, points: 0 });
  });

  it('reads one workout against its cloud row', async () => {
    const f = openDb();
    addWorkout(f, START, { points: 6 });
    expect(await getWorkoutCloudInfo(f.db, START)).toMatchObject({ points: 6, cloud: null });
    await uploaded(f, START, { bytes: 4242 });
    expect((await getWorkoutCloudInfo(f.db, START))?.cloud?.bytes).toBe(4242);
    expect(await getWorkoutCloudInfo(f.db, START + 1)).toBeNull();
  });
});

describe('countPendingRows', () => {
  it('counts step samples and sleep segments only, not workouts, and not imported rows', async () => {
    const f = openDb();
    addWorkout(f, START);
    f.raw.exec(`INSERT INTO step_samples (timestamp, steps, calories, distance) VALUES (60, 1, 1, 1), (120, 1, 1, 1)`);
    f.raw.exec(`INSERT INTO step_samples (timestamp, steps, calories, distance, imported) VALUES (180, 1, 1, 1, 1)`);
    f.raw.exec(`INSERT INTO sleep_segments (start, end, type) VALUES (0, 60, 1)`);
    expect(await countPendingRows(f.db)).toBe(3);
  });
});

describe('loadOverview', () => {
  it('counts the workouts to send, estimates their size and leaves out the ones the cloud refused', async () => {
    const f = openDb();
    addWorkout(f, START, { points: 1000 });
    addWorkout(f, START + 10_000, { points: 500 });
    const refusedRev = f.one<{ rev: number }>('SELECT rev FROM workouts WHERE start = ?', START + 10_000).rev;
    await setCloudState(f.db, { [WORKOUT_FAILED_KEY]: JSON.stringify(recordFailure(noFailures(BUILD), START + 10_000, refusedRev, 'bad_doc: x')) });

    const overview = await loadOverview(f.db, BUILD);
    expect(overview.pendingWorkouts).toBe(1);
    expect(overview.pendingBytes).toBe(1000 * 9 + 8192);
    expect(overview.refusedWorkouts).toBe(1);
    expect(overview.refusedError).toBe('bad_doc: x');

    // The next app build tries the refused workout again.
    const next = await loadOverview(f.db, '1.1+2');
    expect(next.pendingWorkouts).toBe(2);
    expect(next.refusedWorkouts).toBe(0);
    expect(next.refusedError).toBeNull();
  });
});

describe('adoptAccount', () => {
  it('forgets what the cloud copy was when another account signs in', async () => {
    const f = openDb();
    addWorkout(f, START);
    await adoptAccount(f.db, 'user-a', 'a@example.com');
    await uploaded(f, START);
    await setCloudState(f.db, { [WORKOUT_PULL_CURSOR_KEY]: '{"updatedAt":1,"start":2}', [WORKOUT_FAILED_KEY]: '{}' });
    f.raw.exec(`UPDATE cloud_cursor SET uploaded = 99`);

    expect(await adoptAccount(f.db, 'user-a', 'a2@example.com')).toBe(false);
    expect((await getCloudState(f.db)).email).toBe('a2@example.com');
    expect(await getUploadedStats(f.db)).toMatchObject({ workouts: 1 });

    expect(await adoptAccount(f.db, 'user-b', 'b@example.com')).toBe(true);
    expect((await getCloudState(f.db)).userId).toBe('user-b');
    expect(await getUploadedStats(f.db)).toMatchObject({ workouts: 0 });
    expect(await getCloudValue(f.db, WORKOUT_PULL_CURSOR_KEY)).toBeNull();
    expect(await getCloudValue(f.db, WORKOUT_FAILED_KEY)).toBeNull();
    expect(f.all<{ uploaded: number }>('SELECT uploaded FROM cloud_cursor').every((r) => r.uploaded === 0)).toBe(true);
    expect((await listPendingWorkouts(f.db, 2)).map((p) => p.start)).toEqual([START]);
  });

  it('is not a change the first time an account signs in', async () => {
    const f = openDb();
    expect(await adoptAccount(f.db, 'user-a', 'a@example.com')).toBe(false);
    expect((await getCloudState(f.db)).userId).toBe('user-a');
  });
});

describe('restoreWorkout', () => {
  const points: WatchPoint[] = Array.from({ length: 200 }, (_, i) => ({
    ts: START + i,
    lat: -6.2 + i * 0.0001,
    lon: 106.8,
    alt: 10 + i * 0.1,
    hr: 100 + (i % 50),
    speed: 3.1,
    cadence: 85,
    stride: 1.02,
    power: i % 2 === 0 ? 200 : null,
  }));
  const doc = buildWorkoutDoc({
    workout: {
      id: 1,
      workoutNumber: 4,
      start: START,
      end: START + 200,
      sportType: 3,
      sportName: 'Biking',
      duration: 190,
      distance: 900,
      calories: 33,
      avgHr: 125,
      maxHr: 149,
      steps: 0,
      complete: true,
      imported: true,
    },
    summaryJson: '{"kind":"BIKING"}',
    points,
    analysis: { startedAt: START * 1000 } as never,
    engineRev: 2,
  });
  const from = { version: 3, hash: 'deadbeef', bytes: 12_345 };

  it('writes the workout and every point column, and records it so it is not uploaded again', async () => {
    const f = openDb();
    expect(await restoreWorkout(f.db, doc, from)).toBe(true);

    expect(f.one('SELECT workout_number, start, end, sport_type, sport_name, duration, distance, calories, avg_hr, max_hr, steps, summary_json, complete, imported FROM workouts')).toEqual({
      workout_number: 4,
      start: START,
      end: START + 200,
      sport_type: 3,
      sport_name: 'Biking',
      duration: 190,
      distance: 900,
      calories: 33,
      avg_hr: 125,
      max_hr: 149,
      steps: 0,
      summary_json: '{"kind":"BIKING"}',
      complete: 1,
      imported: 1,
    });
    const rows = f.all<Record<string, number | null>>('SELECT ts, lat, lon, alt, hr, speed, cadence, stride, power FROM workout_points ORDER BY ts');
    expect(rows).toHaveLength(200);
    expect(rows[0]).toMatchObject({ ts: START, hr: 100, speed: 3.1, cadence: 85, stride: 1.02, power: 200 });
    expect(rows[1].power).toBeNull();
    expect(rows[199].lat).toBeCloseTo(-6.2 + 199 * 0.0001, 6);
    expect(rows[199].alt).toBeCloseTo(10 + 199 * 0.1, 2);

    const local = f.one<{ rev: number }>('SELECT rev FROM workouts WHERE start = ?', START);
    expect(local.rev).toBeGreaterThan(0);
    expect(f.one('SELECT start, rev, engine_rev, version, hash, bytes FROM cloud_workout')).toEqual({
      start: START,
      rev: local.rev,
      engine_rev: 2,
      version: 3,
      hash: 'deadbeef',
      bytes: 12_345,
    });
    expect(await listPendingWorkouts(f.db, 2)).toEqual([]);
    expect(encodePoints(points)?.n).toBe(200);
  });

  it('never overwrites a workout the phone already has', async () => {
    const f = openDb();
    addWorkout(f, START, { points: 2 });
    expect(await restoreWorkout(f.db, doc, from)).toBe(false);
    expect(f.one<{ sport_name: string }>('SELECT sport_name FROM workouts').sport_name).toBe('Running');
    expect(f.one<{ n: number }>('SELECT COUNT(*) AS n FROM workout_points').n).toBe(2);
    expect(f.one<{ n: number }>('SELECT COUNT(*) AS n FROM cloud_workout').n).toBe(0);
  });

  it('writes nothing when a point insert fails half way', async () => {
    const f = openDb();
    f.raw.exec('DROP TABLE workout_points');
    await expect(restoreWorkout(f.db, doc, from)).rejects.toThrow();
    expect(f.one<{ n: number }>('SELECT COUNT(*) AS n FROM workouts').n).toBe(0);
    expect(f.one<{ n: number }>('SELECT COUNT(*) AS n FROM cloud_workout').n).toBe(0);
  });
});

describe('deleteLocalWorkout', () => {
  it('removes the workout, its points and its cloud row, and only those', async () => {
    const f = openDb();
    addWorkout(f, START);
    addWorkout(f, START + 5000);
    await uploaded(f, START);
    await uploaded(f, START + 5000);
    await deleteLocalWorkout(f.db, START);
    expect(f.all<{ start: number }>('SELECT start FROM workouts').map((r) => r.start)).toEqual([START + 5000]);
    expect(f.one<{ n: number }>('SELECT COUNT(*) AS n FROM workout_points').n).toBe(3);
    expect(f.all<{ start: number }>('SELECT start FROM cloud_workout').map((r) => r.start)).toEqual([START + 5000]);
  });

  it('is fine for a workout the phone never had', async () => {
    const f = openDb();
    await deleteLocalWorkout(f.db, START);
    expect(f.one<{ n: number }>('SELECT COUNT(*) AS n FROM workouts').n).toBe(0);
  });
});
