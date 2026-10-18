import type { SQLiteDatabase } from 'expo-sqlite';

import {
  gearTotals,
  newGearId,
  planDefaultAssignments,
  retirementLevel,
  type AssignedWorkout,
  type AssignmentSource,
  type Gear,
  type GearAssignment,
  type GearDefault,
  type GearDoc,
  type GearKind,
  type GearNotified,
  type GearSport,
  type GearTotals,
} from './model';

/**
 * Gear on the phone. The tables live in `joyofit.db` next to the workouts but are created here, from JS, not through
 * `joyofit-db-migrations.json`: that file is shipped inside the native module (Android asset, OTA fingerprint), so a new
 * entry would need a new binary, and a binary whose list is shorter than `user_version` refuses the database. The native
 * side never reads or writes these tables. Fold them into the list at the next native build.
 */
const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS gear (
     id TEXT PRIMARY KEY NOT NULL, kind TEXT NOT NULL, name TEXT NOT NULL, brand TEXT, model TEXT, photo_uri TEXT,
     start_distance_m REAL NOT NULL DEFAULT 0, retire_at_m REAL, strava_gear_id TEXT, strava_gear_name TEXT,
     retired_at INTEGER, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, deleted_at INTEGER,
     notified INTEGER NOT NULL DEFAULT 0)`,
  `CREATE TABLE IF NOT EXISTS gear_default (
     sport TEXT PRIMARY KEY NOT NULL, gear_id TEXT, since INTEGER NOT NULL, updated_at INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS workout_gear (
     workout_start INTEGER PRIMARY KEY NOT NULL, gear_id TEXT, source TEXT NOT NULL, updated_at INTEGER NOT NULL)`,
  // What Strava has as the gear of a workout's activity (local only), so an upload or a change is sent once.
  `CREATE TABLE IF NOT EXISTS strava_gear_sent (workout_start INTEGER PRIMARY KEY NOT NULL, strava_gear_id TEXT)`,
  `CREATE INDEX IF NOT EXISTS workout_gear_gear ON workout_gear (gear_id)`,
];

export async function ensureGearSchema(db: SQLiteDatabase): Promise<void> {
  for (const statement of SCHEMA) await db.execAsync(statement);
}

interface GearRow {
  id: string;
  kind: GearKind;
  name: string;
  brand: string | null;
  model: string | null;
  photoUri: string | null;
  startDistanceM: number;
  retireAtM: number | null;
  stravaGearId: string | null;
  stravaGearName: string | null;
  retiredAt: number | null;
  createdAt: number;
  updatedAt: number;
  deletedAt: number | null;
  notified: GearNotified;
}

const GEAR_COLUMNS = `id, kind, name, brand, model, photo_uri AS photoUri, start_distance_m AS startDistanceM,
  retire_at_m AS retireAtM, strava_gear_id AS stravaGearId, strava_gear_name AS stravaGearName, retired_at AS retiredAt,
  created_at AS createdAt, updated_at AS updatedAt, deleted_at AS deletedAt, notified`;

/** Gear not deleted, in use first, then by name. */
export function listGear(db: SQLiteDatabase): Promise<Gear[]> {
  return db.getAllAsync<GearRow>(
    `SELECT ${GEAR_COLUMNS} FROM gear WHERE deleted_at IS NULL ORDER BY retired_at IS NOT NULL, name COLLATE NOCASE`,
  );
}

export function getGear(db: SQLiteDatabase, id: string): Promise<Gear | null> {
  return db.getFirstAsync<GearRow>(`SELECT ${GEAR_COLUMNS} FROM gear WHERE id = ? AND deleted_at IS NULL`, id);
}

export interface GearInput {
  id?: string;
  kind: GearKind;
  name: string;
  brand: string | null;
  model: string | null;
  photoUri: string | null;
  startDistanceM: number;
  retireAtM: number | null;
  stravaGearId: string | null;
  stravaGearName: string | null;
}

/** Creates the gear (no `id`) or updates it; returns its id. Raising the retirement distance re-arms the reminder. */
export async function saveGear(db: SQLiteDatabase, input: GearInput, nowMs = Date.now()): Promise<string> {
  const id = input.id ?? newGearId(nowMs);
  const name = input.name.trim();
  const clean = (text: string | null) => (text && text.trim() ? text.trim() : null);
  await db.runAsync(
    `INSERT INTO gear (id, kind, name, brand, model, photo_uri, start_distance_m, retire_at_m, strava_gear_id, strava_gear_name,
                       created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (id) DO UPDATE SET kind = excluded.kind, name = excluded.name, brand = excluded.brand, model = excluded.model,
       photo_uri = excluded.photo_uri, start_distance_m = excluded.start_distance_m, retire_at_m = excluded.retire_at_m,
       strava_gear_id = excluded.strava_gear_id, strava_gear_name = excluded.strava_gear_name, updated_at = excluded.updated_at,
       notified = CASE WHEN excluded.retire_at_m IS NOT gear.retire_at_m THEN 0 ELSE gear.notified END`,
    id,
    input.kind,
    name,
    clean(input.brand),
    clean(input.model),
    input.photoUri,
    Math.max(0, input.startDistanceM),
    input.retireAtM !== null && input.retireAtM > 0 ? input.retireAtM : null,
    input.stravaGearId,
    input.stravaGearId ? input.stravaGearName : null,
    Math.floor(nowMs / 1000),
    nowMs,
  );
  return id;
}

/** Retires the gear (`on`) or puts it back in use. */
export async function setGearRetired(db: SQLiteDatabase, id: string, on: boolean, nowMs = Date.now()): Promise<void> {
  await db.runAsync(
    'UPDATE gear SET retired_at = ?, updated_at = ? WHERE id = ?',
    on ? Math.floor(nowMs / 1000) : null,
    nowMs,
    id,
  );
}

/** Marks the reminder of this level as seen, so it stops showing until the next level. */
export async function dismissReminder(db: SQLiteDatabase, id: string, level: GearNotified, nowMs = Date.now()): Promise<void> {
  await db.runAsync('UPDATE gear SET notified = ?, updated_at = ? WHERE id = ?', level, nowMs, id);
}

/** Deletes the gear (a tombstone, for the cloud). Its workouts keep their row and show no gear; a default on it is cleared. */
export async function deleteGear(db: SQLiteDatabase, id: string, nowMs = Date.now()): Promise<void> {
  await db.withTransactionAsync(async () => {
    await db.runAsync('UPDATE gear SET deleted_at = ?, updated_at = ? WHERE id = ?', Math.floor(nowMs / 1000), nowMs, id);
    await db.runAsync('UPDATE gear_default SET gear_id = NULL, updated_at = ? WHERE gear_id = ?', nowMs, id);
  });
}

// ---------------------------------------------------------------------------------------------------------------------
// Defaults and assignments
// ---------------------------------------------------------------------------------------------------------------------

export function listDefaults(db: SQLiteDatabase): Promise<GearDefault[]> {
  return db.getAllAsync<GearDefault>('SELECT sport, gear_id AS gearId, since, updated_at AS updatedAt FROM gear_default');
}

/** Sets (or, with null, clears) the default gear of a sport; it applies to workouts that start from now on. */
export async function setDefault(db: SQLiteDatabase, sport: GearSport, gearId: string | null, nowMs = Date.now()): Promise<void> {
  await db.runAsync(
    `INSERT INTO gear_default (sport, gear_id, since, updated_at) VALUES (?, ?, ?, ?)
     ON CONFLICT (sport) DO UPDATE SET gear_id = excluded.gear_id, since = excluded.since, updated_at = excluded.updated_at`,
    sport,
    gearId,
    Math.floor(nowMs / 1000),
    nowMs,
  );
}

export function getAssignment(db: SQLiteDatabase, workoutStart: number): Promise<GearAssignment | null> {
  return db.getFirstAsync<GearAssignment>(
    'SELECT workout_start AS workoutStart, gear_id AS gearId, source, updated_at AS updatedAt FROM workout_gear WHERE workout_start = ?',
    workoutStart,
  );
}

/** Ties a workout to a gear, or to "no gear" (null): either is a final choice the default does not override. */
export async function assignWorkout(
  db: SQLiteDatabase,
  workoutStart: number,
  gearId: string | null,
  source: AssignmentSource = 'manual',
  nowMs = Date.now(),
): Promise<void> {
  await db.runAsync(
    `INSERT INTO workout_gear (workout_start, gear_id, source, updated_at) VALUES (?, ?, ?, ?)
     ON CONFLICT (workout_start) DO UPDATE SET gear_id = excluded.gear_id, source = excluded.source, updated_at = excluded.updated_at`,
    workoutStart,
    gearId,
    source,
    nowMs,
  );
}

/** The gear of a workout, or null (no row, "no gear", or the gear was deleted). */
export function gearOfWorkout(db: SQLiteDatabase, workoutStart: number): Promise<Gear | null> {
  return db.getFirstAsync<GearRow>(
    `SELECT ${GEAR_COLUMNS} FROM gear WHERE deleted_at IS NULL AND id = (SELECT gear_id FROM workout_gear WHERE workout_start = ?)`,
    workoutStart,
  );
}

/** Gives the default gear to workouts that have no choice yet (see `planDefaultAssignments`). Returns how many were assigned. */
export async function reconcileDefaults(db: SQLiteDatabase, nowMs = Date.now()): Promise<number> {
  const defaults = (await listDefaults(db)).filter((d) => d.gearId !== null);
  if (defaults.length === 0) return 0;
  const since = Math.min(...defaults.map((d) => d.since));
  const workouts = await db.getAllAsync<{ start: number; sportType: number }>(
    `SELECT start, sport_type AS sportType FROM workouts
     WHERE start >= ? AND complete != 0 AND start NOT IN (SELECT workout_start FROM workout_gear)`,
    since,
  );
  if (workouts.length === 0) return 0;
  const plan = planDefaultAssignments(workouts, new Set(), defaults, await listGear(db), nowMs);
  if (plan.length === 0) return 0;
  await db.withTransactionAsync(async () => {
    for (const a of plan) {
      await db.runAsync(
        `INSERT OR IGNORE INTO workout_gear (workout_start, gear_id, source, updated_at) VALUES (?, ?, 'default', ?)`,
        a.workoutStart,
        a.gearId,
        a.updatedAt,
      );
    }
  });
  return plan.length;
}

// ---------------------------------------------------------------------------------------------------------------------
// Totals
// ---------------------------------------------------------------------------------------------------------------------

/** Lifetime distance, time and count per gear id (gear with no workout is still present with its starting distance). */
export async function allGearTotals(db: SQLiteDatabase): Promise<Map<string, GearTotals>> {
  const gear = await listGear(db);
  const rows = await db.getAllAsync<AssignedWorkout & { gearId: string }>(
    `SELECT w.gear_id AS gearId, k.start, k.end, k.duration, k.distance
     FROM workout_gear w JOIN workouts k ON k.start = w.workout_start WHERE w.gear_id IS NOT NULL`,
  );
  const byGear = new Map<string, AssignedWorkout[]>();
  for (const r of rows) byGear.set(r.gearId, [...(byGear.get(r.gearId) ?? []), r]);
  return new Map(gear.map((g) => [g.id, gearTotals(g, byGear.get(g.id) ?? [])]));
}

/** What a workout's reminder shows for a gear: its level now against what the person already dismissed. */
export function reminderPending(gear: Pick<Gear, 'retireAtM' | 'notified'>, distanceM: number): GearNotified {
  const level = retirementLevel(distanceM, gear.retireAtM);
  return level > gear.notified ? level : 0;
}

// ---------------------------------------------------------------------------------------------------------------------
// Strava gear sent
// ---------------------------------------------------------------------------------------------------------------------

export async function getStravaGearSent(db: SQLiteDatabase, workoutStart: number): Promise<{ stravaGearId: string | null } | null> {
  const row = await db.getFirstAsync<{ stravaGearId: string | null }>(
    'SELECT strava_gear_id AS stravaGearId FROM strava_gear_sent WHERE workout_start = ?',
    workoutStart,
  );
  return row;
}

export async function setStravaGearSent(db: SQLiteDatabase, workoutStart: number, stravaGearId: string | null): Promise<void> {
  await db.runAsync(
    `INSERT INTO strava_gear_sent (workout_start, strava_gear_id) VALUES (?, ?)
     ON CONFLICT (workout_start) DO UPDATE SET strava_gear_id = excluded.strava_gear_id`,
    workoutStart,
    stravaGearId,
  );
}

/** Forgets what Strava has (a different athlete connected: their activities are not the old ones). */
export function forgetStravaGearSent(db: SQLiteDatabase): Promise<unknown> {
  return db.runAsync('DELETE FROM strava_gear_sent');
}

// ---------------------------------------------------------------------------------------------------------------------
// Cloud document
// ---------------------------------------------------------------------------------------------------------------------

/** Everything that syncs: no photo, and the Strava gear name stays on the phone (the id is enough to link). */
export async function readGearDoc(db: SQLiteDatabase): Promise<GearDoc> {
  const gear = await db.getAllAsync<GearRow>(`SELECT ${GEAR_COLUMNS} FROM gear`);
  const assignments = await db.getAllAsync<GearAssignment>(
    'SELECT workout_start AS workoutStart, gear_id AS gearId, source, updated_at AS updatedAt FROM workout_gear',
  );
  return {
    version: 1,
    gear: gear.map(({ photoUri: _photo, stravaGearName: _name, ...rest }) => ({ ...rest, stravaGearName: null })),
    defaults: await listDefaults(db),
    assignments,
  };
}

/** Stores a merged document, keeping this phone's photos and Strava gear names. */
export async function writeGearDoc(db: SQLiteDatabase, doc: GearDoc): Promise<void> {
  await db.withTransactionAsync(async () => {
    for (const g of doc.gear) {
      await db.runAsync(
        `INSERT INTO gear (id, kind, name, brand, model, start_distance_m, retire_at_m, strava_gear_id, retired_at, created_at,
                           updated_at, deleted_at, notified)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (id) DO UPDATE SET kind = excluded.kind, name = excluded.name, brand = excluded.brand, model = excluded.model,
           start_distance_m = excluded.start_distance_m, retire_at_m = excluded.retire_at_m,
           strava_gear_name = CASE WHEN excluded.strava_gear_id IS gear.strava_gear_id THEN gear.strava_gear_name END,
           strava_gear_id = excluded.strava_gear_id, retired_at = excluded.retired_at, updated_at = excluded.updated_at,
           deleted_at = excluded.deleted_at, notified = excluded.notified`,
        g.id,
        g.kind,
        g.name,
        g.brand,
        g.model,
        g.startDistanceM,
        g.retireAtM,
        g.stravaGearId,
        g.retiredAt,
        g.createdAt,
        g.updatedAt,
        g.deletedAt,
        g.notified,
      );
    }
    for (const d of doc.defaults) {
      await db.runAsync(
        `INSERT INTO gear_default (sport, gear_id, since, updated_at) VALUES (?, ?, ?, ?)
         ON CONFLICT (sport) DO UPDATE SET gear_id = excluded.gear_id, since = excluded.since, updated_at = excluded.updated_at`,
        d.sport,
        d.gearId,
        d.since,
        d.updatedAt,
      );
    }
    for (const a of doc.assignments) {
      await db.runAsync(
        `INSERT INTO workout_gear (workout_start, gear_id, source, updated_at) VALUES (?, ?, ?, ?)
         ON CONFLICT (workout_start) DO UPDATE SET gear_id = excluded.gear_id, source = excluded.source, updated_at = excluded.updated_at`,
        a.workoutStart,
        a.gearId,
        a.source,
        a.updatedAt,
      );
    }
  });
}
