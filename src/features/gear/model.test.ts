import { describe, expect, it } from 'bun:test';

import {
  EMPTY_GEAR_DOC,
  gearChoices,
  gearReminder,
  gearSport,
  gearTotals,
  kindFits,
  mergeGearDocs,
  newGearId,
  planDefaultAssignments,
  retirementLevel,
  sameGearDoc,
  stravaGearFits,
  type Gear,
  type GearDoc,
} from './model';

const gear = (over: Partial<Gear> = {}): Gear => ({
  id: 'g1',
  kind: 'shoes',
  name: 'Nike Pegasus 41',
  brand: 'Nike',
  model: 'Pegasus 41',
  photoUri: null,
  startDistanceM: 0,
  retireAtM: 700_000,
  stravaGearId: null,
  stravaGearName: null,
  retiredAt: null,
  createdAt: 1000,
  updatedAt: 1000,
  deletedAt: null,
  notified: 0,
  ...over,
});

describe('sports and kinds', () => {
  it('maps Huawei sport types to run, walk and ride', () => {
    expect(gearSport(1)).toBe('run');
    expect(gearSport(5)).toBe('run');
    expect(gearSport(11)).toBe('run');
    expect(gearSport(2)).toBe('walk');
    expect(gearSport(4)).toBe('walk');
    expect(gearSport(13)).toBe('walk');
    expect(gearSport(3)).toBe('ride');
    expect(gearSport(7)).toBe('ride');
    expect(gearSport(6)).toBeNull();
    expect(gearSport(999)).toBeNull();
  });

  it('keeps shoes on foot sports, bikes on rides, other anywhere', () => {
    expect(kindFits('shoes', 'run')).toBe(true);
    expect(kindFits('shoes', 'walk')).toBe(true);
    expect(kindFits('shoes', 'ride')).toBe(false);
    expect(kindFits('bike', 'ride')).toBe(true);
    expect(kindFits('bike', 'run')).toBe(false);
    expect(kindFits('other', null)).toBe(true);
    expect(kindFits('shoes', null)).toBe(false);
  });

  it('knows which Strava gear fits a sport from its id prefix', () => {
    expect(stravaGearFits('g123', 'run')).toBe(true);
    expect(stravaGearFits('g123', 'ride')).toBe(false);
    expect(stravaGearFits('b123', 'ride')).toBe(true);
    expect(stravaGearFits('b123', 'walk')).toBe(false);
    expect(stravaGearFits('g123', null)).toBe(false);
  });

  it('offers gear in use that fits, by name', () => {
    const list = [gear({ id: 'a', name: 'B' }), gear({ id: 'b', name: 'A' }), gear({ id: 'c', retiredAt: 5 }), gear({ id: 'd', deletedAt: 5 }), gear({ id: 'e', kind: 'bike' })];
    expect(gearChoices(list, 'run').map((g) => g.id)).toEqual(['b', 'a']);
    expect(gearChoices(list, 'ride').map((g) => g.id)).toEqual(['e']);
  });
});

describe('totals and reminders', () => {
  it('adds the starting distance and the moving time of the workouts', () => {
    const totals = gearTotals({ startDistanceM: 100_000 }, [
      { start: 0, end: 1800, duration: 1800, distance: 5000 },
      { start: 5000, end: 7000, duration: 1500, distance: 4000 },
    ]);
    expect(totals).toEqual({ distanceM: 109_000, seconds: 1800 + 1500, workouts: 2 });
  });

  it('reminds from 90 % and again at the limit, never without one', () => {
    expect(retirementLevel(629_999, 700_000)).toBe(0);
    expect(retirementLevel(630_000, 700_000)).toBe(1);
    expect(retirementLevel(700_000, 700_000)).toBe(2);
    expect(retirementLevel(900_000, null)).toBe(0);
    expect(retirementLevel(900_000, 0)).toBe(0);
  });

  it('words the reminder in whole kilometres and skips retired gear', () => {
    expect(gearReminder(gear(), 650_400)).toEqual({ level: 1, km: 650, retireKm: 700 });
    expect(gearReminder(gear(), 700_000)).toEqual({ level: 2, km: 700, retireKm: 700 });
    expect(gearReminder(gear(), 100_000)).toBeNull();
    expect(gearReminder(gear({ retiredAt: 1 }), 800_000)).toBeNull();
    expect(gearReminder(gear({ deletedAt: 1 }), 800_000)).toBeNull();
  });
});

describe('default assignments', () => {
  const defaults = [{ sport: 'run' as const, gearId: 'g1', since: 1000, updatedAt: 1 }];

  it('assigns only workouts of the sport, since the default was set, with no row yet', () => {
    const workouts = [
      { start: 900, sportType: 1 },
      { start: 1000, sportType: 1 },
      { start: 2000, sportType: 1 },
      { start: 3000, sportType: 2 },
      { start: 4000, sportType: 1 },
    ];
    const plan = planDefaultAssignments(workouts, new Set([4000]), defaults, [gear()], 77);
    expect(plan).toEqual([
      { workoutStart: 1000, gearId: 'g1', source: 'default', updatedAt: 77 },
      { workoutStart: 2000, gearId: 'g1', source: 'default', updatedAt: 77 },
    ]);
  });

  it('does nothing for retired, deleted, missing or wrong-kind gear', () => {
    const w = [{ start: 2000, sportType: 1 }];
    expect(planDefaultAssignments(w, new Set(), defaults, [gear({ retiredAt: 1 })], 1)).toEqual([]);
    expect(planDefaultAssignments(w, new Set(), defaults, [gear({ deletedAt: 1 })], 1)).toEqual([]);
    expect(planDefaultAssignments(w, new Set(), defaults, [], 1)).toEqual([]);
    expect(planDefaultAssignments(w, new Set(), defaults, [gear({ kind: 'bike' })], 1)).toEqual([]);
    expect(planDefaultAssignments(w, new Set(), [{ ...defaults[0]!, gearId: null }], [gear()], 1)).toEqual([]);
  });
});

describe('cloud merge', () => {
  const { photoUri: _photo, ...cloudGear } = gear();
  const base: GearDoc = { version: 1, gear: [cloudGear], defaults: [], assignments: [] };

  it('takes the newer edit per record and keeps records only one side has', () => {
    const local: GearDoc = {
      ...base,
      gear: [{ ...cloudGear, name: 'Local', updatedAt: 2000 }],
      assignments: [{ workoutStart: 1, gearId: 'g1', source: 'manual', updatedAt: 10 }],
    };
    const remote: GearDoc = {
      ...base,
      gear: [{ ...cloudGear, name: 'Remote', updatedAt: 3000 }, { ...cloudGear, id: 'g2', updatedAt: 1 }],
      assignments: [{ workoutStart: 1, gearId: null, source: 'manual', updatedAt: 5 }],
      defaults: [{ sport: 'ride', gearId: 'g2', since: 1, updatedAt: 1 }],
    };
    const merged = mergeGearDocs(local, remote);
    expect(merged.gear.map((g) => [g.id, g.name])).toEqual([['g1', 'Remote'], ['g2', 'Nike Pegasus 41']]);
    expect(merged.assignments).toEqual([{ workoutStart: 1, gearId: 'g1', source: 'manual', updatedAt: 10 }]);
    expect(merged.defaults).toHaveLength(1);
  });

  it('keeps a tombstone newer than the live copy', () => {
    const merged = mergeGearDocs(base, { ...base, gear: [{ ...cloudGear, deletedAt: 9, updatedAt: 9000 }] });
    expect(merged.gear[0]?.deletedAt).toBe(9);
  });

  it('is symmetric and idempotent, and sameGearDoc ignores order and key order', () => {
    const other: GearDoc = { ...base, gear: [{ ...cloudGear, id: 'g0', updatedAt: 4 }] };
    const ab = mergeGearDocs(base, other);
    expect(sameGearDoc(ab, mergeGearDocs(other, base))).toBe(true);
    expect(sameGearDoc(ab, mergeGearDocs(ab, other))).toBe(true);
    expect(sameGearDoc({ ...ab, gear: [...ab.gear].reverse() }, ab)).toBe(true);
    expect(sameGearDoc(ab, base)).toBe(false);
    expect(sameGearDoc(EMPTY_GEAR_DOC, EMPTY_GEAR_DOC)).toBe(true);
  });
});

describe('newGearId', () => {
  it('is short, url-safe and differs between calls', () => {
    const a = newGearId(1_700_000_000_000, () => 0.123);
    const b = newGearId(1_700_000_000_000, () => 0.456);
    expect(a).toMatch(/^[0-9a-z]+-[0-9a-z]{6}$/);
    expect(a).not.toBe(b);
  });
});
