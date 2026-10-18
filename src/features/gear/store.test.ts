import { Database } from 'bun:sqlite';
import { describe, expect, it } from 'bun:test';
import type { SQLiteDatabase } from 'expo-sqlite';

import migrationsJson from '../../../modules/huawei-wear/schema/joyofit-db-migrations.json';
import {
  allGearTotals,
  assignWorkout,
  deleteGear,
  dismissReminder,
  ensureGearSchema,
  gearOfWorkout,
  getAssignment,
  getGear,
  getStravaGearSent,
  listGear,
  readGearDoc,
  reconcileDefaults,
  saveGear,
  setDefault,
  setGearRetired,
  setStravaGearSent,
  writeGearDoc,
  type GearInput,
} from './store';

/** The slice of expo-sqlite the store uses, over bun:sqlite with the app's real schema. */
async function open() {
  const raw = new Database(':memory:');
  for (const statements of migrationsJson) raw.exec(statements.join(';\n'));
  const db = {
    execAsync: async (sql: string) => void raw.exec(sql),
    runAsync: async (sql: string, ...params: unknown[]) => raw.query(sql).run(...(params as never[])),
    getAllAsync: async (sql: string, ...params: unknown[]) => raw.query(sql).all(...(params as never[])),
    getFirstAsync: async (sql: string, ...params: unknown[]) => raw.query(sql).get(...(params as never[])),
    withTransactionAsync: async (task: () => Promise<void>) => {
      raw.exec('BEGIN');
      try {
        await task();
        raw.exec('COMMIT');
      } catch (error) {
        raw.exec('ROLLBACK');
        throw error;
      }
    },
  } as unknown as SQLiteDatabase;
  await ensureGearSchema(db);
  return { raw, db };
}

const workout = (raw: Database, start: number, sportType: number, distance: number, duration = 1800, complete = 1) =>
  raw.exec(
    `INSERT INTO workouts (workout_number, start, end, sport_type, sport_name, duration, distance, calories, steps, summary_json, complete)
     VALUES (${start}, ${start}, ${start + duration}, ${sportType}, 'x', ${duration}, ${distance}, 0, 0, '{}', ${complete})`,
  );

const shoes = (over: Partial<GearInput> = {}): GearInput => ({
  kind: 'shoes',
  name: ' Pegasus ',
  brand: 'Nike',
  model: '  ',
  photoUri: null,
  startDistanceM: 100_000,
  retireAtM: 700_000,
  stravaGearId: null,
  stravaGearName: null,
  ...over,
});

describe('gear store', () => {
  it('creates, trims, updates and re-arms the reminder when the limit changes', async () => {
    const { db } = await open();
    const id = await saveGear(db, shoes(), 1_000_000);
    expect(await getGear(db, id)).toMatchObject({ name: 'Pegasus', brand: 'Nike', model: null, startDistanceM: 100_000, retireAtM: 700_000, notified: 0 });
    await dismissReminder(db, id, 1);
    await saveGear(db, { ...shoes({ name: 'Pegasus 41' }), id }, 2_000_000);
    expect((await getGear(db, id))?.notified).toBe(1);
    await saveGear(db, { ...shoes({ retireAtM: 800_000 }), id }, 3_000_000);
    expect(await getGear(db, id)).toMatchObject({ notified: 0, updatedAt: 3_000_000 });
    expect(await listGear(db)).toHaveLength(1);
  });

  it('keeps the Strava link and name only together', async () => {
    const { db } = await open();
    const id = await saveGear(db, shoes({ stravaGearId: 'g1', stravaGearName: 'Pegasus (Strava)' }));
    expect(await getGear(db, id)).toMatchObject({ stravaGearId: 'g1', stravaGearName: 'Pegasus (Strava)' });
    await saveGear(db, { ...shoes({ stravaGearId: null, stravaGearName: 'stale' }), id });
    expect(await getGear(db, id)).toMatchObject({ stravaGearId: null, stravaGearName: null });
  });

  it('totals the starting distance and the workouts tied to a gear', async () => {
    const { raw, db } = await open();
    const id = await saveGear(db, shoes());
    workout(raw, 1000, 1, 5000);
    workout(raw, 5000, 1, 10_000, 3600);
    workout(raw, 9000, 1, 7000);
    await assignWorkout(db, 1000, id);
    await assignWorkout(db, 5000, id);
    await assignWorkout(db, 9000, null);
    const totals = (await allGearTotals(db)).get(id);
    expect(totals).toEqual({ distanceM: 115_000, seconds: 1800 + 3600, workouts: 2 });
    expect((await gearOfWorkout(db, 1000))?.id).toBe(id);
    expect(await gearOfWorkout(db, 9000)).toBeNull();
    expect(await gearOfWorkout(db, 123)).toBeNull();
  });

  it('applies a default once to later workouts without a choice, and never rewrites a choice', async () => {
    const { raw, db } = await open();
    const id = await saveGear(db, shoes());
    workout(raw, 1000, 1, 5000); // before the default
    workout(raw, 2_000_000_000, 1, 5000); // run, after
    workout(raw, 2_000_000_100, 2, 3000); // walk: no default for it
    workout(raw, 2_000_000_200, 1, 4000);
    workout(raw, 2_000_000_300, 1, 4000, 1800, 0); // still downloading
    await setDefault(db, 'run', id, 1_900_000_000_000);
    await assignWorkout(db, 2_000_000_200, null); // the person chose "no gear"
    expect(await reconcileDefaults(db, 5)).toBe(1);
    expect(await getAssignment(db, 2_000_000_000)).toMatchObject({ gearId: id, source: 'default' });
    expect(await getAssignment(db, 1000)).toBeNull();
    expect(await getAssignment(db, 2_000_000_100)).toBeNull();
    expect(await getAssignment(db, 2_000_000_200)).toMatchObject({ gearId: null, source: 'manual' });
    expect(await getAssignment(db, 2_000_000_300)).toBeNull();
    expect(await reconcileDefaults(db, 6)).toBe(0);
  });

  it('stops defaulting retired gear and clears a default when the gear is deleted', async () => {
    const { raw, db } = await open();
    const id = await saveGear(db, shoes());
    await setDefault(db, 'run', id, 1_000_000);
    await setGearRetired(db, id, true);
    workout(raw, 5_000_000, 1, 1000);
    expect(await reconcileDefaults(db)).toBe(0);
    await setGearRetired(db, id, false);
    expect(await reconcileDefaults(db)).toBe(1);
    await deleteGear(db, id);
    expect(await listGear(db)).toEqual([]);
    expect(await gearOfWorkout(db, 5_000_000)).toBeNull();
    expect((await readGearDoc(db)).defaults[0]?.gearId).toBeNull();
    expect((await readGearDoc(db)).gear[0]?.deletedAt).not.toBeNull();
  });

  it('round-trips the cloud document without the photo and the Strava name, and keeps them locally on a pull', async () => {
    const a = await open();
    const id = await saveGear(a.db, shoes({ photoUri: 'file:///p.jpg', stravaGearId: 'g9', stravaGearName: 'Strava name' }));
    await assignWorkout(a.db, 1000, id);
    const doc = await readGearDoc(a.db);
    expect(JSON.stringify(doc)).not.toContain('file:///p.jpg');
    expect(JSON.stringify(doc)).not.toContain('Strava name');
    expect(doc.gear[0]).toMatchObject({ id, stravaGearId: 'g9', stravaGearName: null });

    // The same phone takes a newer copy: its photo and Strava name survive.
    await writeGearDoc(a.db, { ...doc, gear: [{ ...doc.gear[0]!, name: 'Renamed', updatedAt: 9_999_999_999_999 }] });
    expect(await getGear(a.db, id)).toMatchObject({ name: 'Renamed', photoUri: 'file:///p.jpg', stravaGearName: 'Strava name' });
    // Another Strava gear id drops the old name.
    await writeGearDoc(a.db, { ...doc, gear: [{ ...doc.gear[0]!, stravaGearId: 'g10', updatedAt: 1 }] });
    expect((await getGear(a.db, id))?.stravaGearName).toBeNull();

    // A new phone gets everything but the photo.
    const b = await open();
    await writeGearDoc(b.db, doc);
    expect(await getGear(b.db, id)).toMatchObject({ name: 'Pegasus', photoUri: null, stravaGearId: 'g9' });
    expect(await getAssignment(b.db, 1000)).toMatchObject({ gearId: id });
  });

  it('remembers what Strava has per workout', async () => {
    const { db } = await open();
    expect(await getStravaGearSent(db, 1)).toBeNull();
    await setStravaGearSent(db, 1, 'g1');
    expect(await getStravaGearSent(db, 1)).toEqual({ stravaGearId: 'g1' });
    await setStravaGearSent(db, 1, null);
    expect(await getStravaGearSent(db, 1)).toEqual({ stravaGearId: null });
  });
});
