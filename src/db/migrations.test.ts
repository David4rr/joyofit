import { Database } from 'bun:sqlite';
import { describe, expect, it } from 'bun:test';
import type { SQLiteDatabase } from 'expo-sqlite';

import migrationsJson from '../../modules/huawei-wear/schema/joyofit-db-migrations.json';
import { migrate } from './migrations';

/** The slice of expo-sqlite that `migrate` uses, over bun:sqlite. */
function wrap(raw: Database): SQLiteDatabase {
  return {
    execAsync: async (sql: string) => {
      raw.exec(sql);
    },
    getFirstAsync: async (sql: string) => raw.query(sql).get(),
    withExclusiveTransactionAsync: async (task: (txn: unknown) => Promise<void>) => {
      raw.exec('BEGIN');
      try {
        await task({ execAsync: async (sql: string) => raw.exec(sql) });
        raw.exec('COMMIT');
      } catch (e) {
        raw.exec('ROLLBACK');
        throw e;
      }
    },
  } as unknown as SQLiteDatabase;
}

const columns = (raw: Database, table: string) =>
  raw
    .query<{ name: string }, []>(`PRAGMA table_info(${table})`)
    .all()
    .map((c) => c.name);

describe('migration 12: per-sample columns of workout_points', () => {
  it('only adds nullable columns, once, and leaves the stored workouts and points as they were', async () => {
    const raw = new Database(':memory:');
    // A phone that has run the app since migration 3 and holds a recorded workout.
    for (const statements of migrationsJson.slice(0, 3)) raw.exec(statements.join(';\n'));
    raw.exec('PRAGMA user_version = 3');
    raw.exec(
      `INSERT INTO workouts (workout_number, start, end, sport_type, sport_name, duration, distance, calories, avg_hr, max_hr, steps, summary_json, complete)
       VALUES (1, 1700000000, 1700000600, 1, 'Running', 600, 5000, 321, 135, 170, 100, '{"kind":"RUNNING"}', 1)`,
    );
    raw.exec(
      `INSERT INTO workout_points (workout_id, ts, lat, lon, alt, hr)
       VALUES (1, 1700000001, -6.2, 106.8, 12.5, 140), (1, 1700000002, NULL, NULL, NULL, 142)`,
    );

    await migrate(wrap(raw));

    expect(raw.query<{ user_version: number }, []>('PRAGMA user_version').get()?.user_version).toBe(migrationsJson.length);
    expect(columns(raw, 'workout_points')).toEqual(['workout_id', 'ts', 'lat', 'lon', 'alt', 'hr', 'speed', 'cadence', 'stride', 'power']);
    expect(raw.query('SELECT ts, lat, lon, alt, hr, speed, cadence, stride, power FROM workout_points ORDER BY ts').all()).toEqual([
      { ts: 1700000001, lat: -6.2, lon: 106.8, alt: 12.5, hr: 140, speed: null, cadence: null, stride: null, power: null },
      { ts: 1700000002, lat: null, lon: null, alt: null, hr: 142, speed: null, cadence: null, stride: null, power: null },
    ]);
    expect(raw.query('SELECT workout_number, distance, summary_json FROM workouts').all()).toEqual([
      { workout_number: 1, distance: 5000, summary_json: '{"kind":"RUNNING"}' },
    ]);

    // A second start applies nothing: ALTER TABLE ADD COLUMN would throw on a duplicate column.
    await migrate(wrap(raw));
    expect(columns(raw, 'workout_points')).toHaveLength(10);
  });

  it('only appends nullable columns to workout_points, never rebuilds a table or deletes', () => {
    const statements = migrationsJson[11] as string[];
    expect(statements).toEqual([
      'ALTER TABLE workout_points ADD COLUMN speed REAL',
      'ALTER TABLE workout_points ADD COLUMN cadence INTEGER',
      'ALTER TABLE workout_points ADD COLUMN stride REAL',
      'ALTER TABLE workout_points ADD COLUMN power INTEGER',
    ]);
  });
});

describe('migration 13: cloud_workout', () => {
  it('only creates the table that records what was uploaded or restored per workout', () => {
    expect(migrationsJson[12] as string[]).toEqual([
      'CREATE TABLE cloud_workout (start INTEGER PRIMARY KEY NOT NULL, rev INTEGER NOT NULL, engine_rev INTEGER NOT NULL, version INTEGER NOT NULL, hash TEXT NOT NULL, bytes INTEGER NOT NULL, uploaded_at INTEGER NOT NULL)',
    ]);
  });

  it('applies on top of a phone at version 12 and keeps its workouts', async () => {
    const raw = new Database(':memory:');
    for (const statements of migrationsJson.slice(0, 12)) raw.exec(statements.join(';\n'));
    raw.exec('PRAGMA user_version = 12');
    raw.exec(
      `INSERT INTO workouts (workout_number, start, end, sport_type, sport_name, duration, distance, calories, steps, summary_json, complete)
       VALUES (1, 1700000000, 1700000600, 1, 'Running', 600, 5000, 321, 100, '{}', 1)`,
    );

    await migrate(wrap(raw));

    expect(raw.query<{ user_version: number }, []>('PRAGMA user_version').get()?.user_version).toBe(13);
    expect(columns(raw, 'cloud_workout')).toEqual(['start', 'rev', 'engine_rev', 'version', 'hash', 'bytes', 'uploaded_at']);
    expect(raw.query('SELECT COUNT(*) AS n FROM workouts').get()).toEqual({ n: 1 });
  });
});
