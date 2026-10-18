/**
 * Gear: shoes, bikes and anything else a workout is done with, with a lifetime distance and a retirement distance, like
 * Garmin Connect's gear. Pure functions and types, no React Native imports, so they run under `bun test`.
 *
 * Distances are metres, times Unix seconds (`updatedAt` milliseconds: it only orders edits). A workout is tied to gear
 * by its `start` (the key every other per-workout table uses: `strava_upload`, `cloud_workout`).
 */
import { stravaSport } from '../strava/activityFile';
import { workoutTimes } from '../workouts/times';

export type GearKind = 'shoes' | 'bike' | 'other';
export const GEAR_KINDS: readonly GearKind[] = ['shoes', 'bike', 'other'];

/** The sports a default gear can be set for. */
export type GearSport = 'run' | 'walk' | 'ride';
export const GEAR_SPORTS: readonly GearSport[] = ['run', 'walk', 'ride'];

/** `notified`: 0 nothing said yet, 1 the "near retirement" reminder was shown, 2 the "retire" reminder was shown. */
export type GearNotified = 0 | 1 | 2;

export interface Gear {
  id: string;
  kind: GearKind;
  name: string;
  brand: string | null;
  model: string | null;
  /** A file on this phone; never synced. */
  photoUri: string | null;
  /** Distance done before the gear was added to JoyoFit. */
  startDistanceM: number;
  /** The distance at which the gear is worn out, or null for no limit. */
  retireAtM: number | null;
  /** The Strava gear this one is linked to (`b12345` bike, `g12345` shoes) and its name there, for display. */
  stravaGearId: string | null;
  stravaGearName: string | null;
  /** Unix seconds the user retired it, or null while in use. Retired gear is not offered as a default. */
  retiredAt: number | null;
  createdAt: number;
  updatedAt: number;
  /** Tombstone, so a deletion reaches the other phone through the cloud. */
  deletedAt: number | null;
  notified: GearNotified;
}

export interface GearDefault {
  sport: GearSport;
  gearId: string | null;
  /** Unix seconds: only workouts that start at or after this get the default. */
  since: number;
  updatedAt: number;
}

export type AssignmentSource = 'default' | 'manual';

export interface GearAssignment {
  workoutStart: number;
  /** Null is an explicit "no gear": the default is not applied again. */
  gearId: string | null;
  source: AssignmentSource;
  updatedAt: number;
}

/** What goes to the cloud (`PUT /v1/gear`): everything except the photo, which stays on the phone. */
export interface GearDoc {
  version: 1;
  gear: Omit<Gear, 'photoUri'>[];
  defaults: GearDefault[];
  assignments: GearAssignment[];
}

// ---------------------------------------------------------------------------------------------------------------------
// Sports and kinds
// ---------------------------------------------------------------------------------------------------------------------

/** The sport class of a Huawei sport type: running, walking or hiking, cycling. Null for sports with no gear default. */
export function gearSport(huaweiSportType: number): GearSport | null {
  switch (stravaSport(huaweiSportType).fitSport) {
    case 1:
      return 'run';
    case 11:
    case 17:
      return 'walk';
    case 2:
      return 'ride';
    default:
      return null;
  }
}

/** Shoes for feet, bikes for rides; `other` fits any sport. */
export function kindFits(kind: GearKind, sport: GearSport | null): boolean {
  if (kind === 'other') return true;
  if (sport === null) return false;
  return kind === 'shoes' ? sport !== 'ride' : sport === 'ride';
}

/** The kind a default for this sport is picked from. */
export function defaultKind(sport: GearSport): GearKind {
  return sport === 'ride' ? 'bike' : 'shoes';
}

/** Strava's gear ids start with `g` for shoes and `b` for bikes. */
export function stravaKind(stravaGearId: string): GearKind {
  return stravaGearId.startsWith('b') ? 'bike' : stravaGearId.startsWith('g') ? 'shoes' : 'other';
}

/** The gear can go onto a Strava activity of this sport: Strava keeps bikes on rides and shoes on foot sports. */
export function stravaGearFits(stravaGearId: string, sport: GearSport | null): boolean {
  if (sport === null) return false;
  return stravaGearId.startsWith('b') ? sport === 'ride' : sport !== 'ride';
}

/** Gear that can be chosen for a workout of this sport, in use first. Deleted gear is never offered. */
export function gearChoices(gear: readonly Gear[], sport: GearSport | null): Gear[] {
  return gear
    .filter((g) => g.deletedAt === null && g.retiredAt === null && kindFits(g.kind, sport))
    .sort((a, b) => a.name.localeCompare(b.name));
}

// ---------------------------------------------------------------------------------------------------------------------
// Totals and reminders
// ---------------------------------------------------------------------------------------------------------------------

export interface AssignedWorkout {
  start: number;
  end: number;
  /** The watch's active seconds. */
  duration: number;
  distance: number;
}

export interface GearTotals {
  /** Starting distance plus the distance of every workout done with it. */
  distanceM: number;
  /** Moving seconds of those workouts (what a Strava activity shows as moving time). */
  seconds: number;
  workouts: number;
}

export function gearTotals(gear: Pick<Gear, 'startDistanceM'>, workouts: readonly AssignedWorkout[]): GearTotals {
  let distance = gear.startDistanceM;
  let seconds = 0;
  for (const w of workouts) {
    distance += Math.max(w.distance, 0);
    seconds += workoutTimes(w).movingSec;
  }
  return { distanceM: distance, seconds, workouts: workouts.length };
}

/** Share of the retirement distance at which the first reminder shows. */
export const NEAR_RETIREMENT = 0.9;

/** 0 under 90 % of the retirement distance (or no limit), 1 from 90 %, 2 from 100 %. */
export function retirementLevel(distanceM: number, retireAtM: number | null): GearNotified {
  if (retireAtM === null || retireAtM <= 0) return 0;
  if (distanceM >= retireAtM) return 2;
  return distanceM >= retireAtM * NEAR_RETIREMENT ? 1 : 0;
}

export interface GearReminder {
  level: 1 | 2;
  /** Whole kilometres done and the retirement distance, for the sentence ("Sepatu kamu sudah 650 km"). */
  km: number;
  retireKm: number;
}

/** The reminder a gear shows now, or null: not for retired or deleted gear. */
export function gearReminder(gear: Pick<Gear, 'retireAtM' | 'retiredAt' | 'deletedAt'>, distanceM: number): GearReminder | null {
  if (gear.retiredAt !== null || gear.deletedAt !== null || gear.retireAtM === null) return null;
  const level = retirementLevel(distanceM, gear.retireAtM);
  if (level === 0) return null;
  return { level, km: Math.floor(distanceM / 1000), retireKm: Math.round(gear.retireAtM / 1000) };
}

// ---------------------------------------------------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------------------------------------------------

/**
 * The assignments to write for workouts that have none: a workout that started at or after the default's `since`, of a
 * sport with a default whose gear is still in use and fits. Workouts that already have a row (even "no gear") are left
 * alone, so a manual choice is final and changing a default never rewrites history.
 */
export function planDefaultAssignments(
  workouts: readonly { start: number; sportType: number }[],
  assigned: ReadonlySet<number>,
  defaults: readonly GearDefault[],
  gear: readonly Gear[],
  now: number,
): GearAssignment[] {
  const byId = new Map(gear.map((g) => [g.id, g]));
  const bySport = new Map(defaults.map((d) => [d.sport, d]));
  const plan: GearAssignment[] = [];
  for (const w of workouts) {
    if (assigned.has(w.start)) continue;
    const sport = gearSport(w.sportType);
    const def = sport ? bySport.get(sport) : undefined;
    if (!def || def.gearId === null || w.start < def.since) continue;
    const g = byId.get(def.gearId);
    if (!g || g.deletedAt !== null || g.retiredAt !== null || !kindFits(g.kind, sport)) continue;
    plan.push({ workoutStart: w.start, gearId: g.id, source: 'default', updatedAt: now });
  }
  return plan;
}

// ---------------------------------------------------------------------------------------------------------------------
// Cloud merge
// ---------------------------------------------------------------------------------------------------------------------

/** The newer edit wins; a tie keeps the local one. */
function newer<T extends { updatedAt: number }>(local: T, remote: T): T {
  return remote.updatedAt > local.updatedAt ? remote : local;
}

function mergeById<T extends { updatedAt: number }>(local: readonly T[], remote: readonly T[], key: (item: T) => string | number): T[] {
  const merged = new Map<string | number, T>();
  for (const item of local) merged.set(key(item), item);
  for (const item of remote) {
    const mine = merged.get(key(item));
    merged.set(key(item), mine ? newer(mine, item) : item);
  }
  return [...merged.values()];
}

const byKey = <T>(items: T[], key: (item: T) => string | number): T[] =>
  items.sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0));

/**
 * Two copies of the gear document become one, per record by `updatedAt` (a deleted gear is a record too). Sorted, so
 * merging the same two documents gives the same bytes. The result is what both sides should hold.
 */
export function mergeGearDocs(local: GearDoc, remote: GearDoc): GearDoc {
  return {
    version: 1,
    gear: byKey(mergeById(local.gear, remote.gear, (g) => g.id), (g) => g.id),
    defaults: byKey(mergeById(local.defaults, remote.defaults, (d) => d.sport), (d) => d.sport),
    assignments: byKey(mergeById(local.assignments, remote.assignments, (a) => a.workoutStart), (a) => a.workoutStart),
  };
}

/** The same document, field by field (arrays in the order `mergeGearDocs` gives). */
export function sameGearDoc(a: GearDoc, b: GearDoc): boolean {
  return JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
}

function canonical(doc: GearDoc): GearDoc {
  return {
    version: 1,
    gear: byKey([...doc.gear], (g) => g.id).map((g) => sortedKeys(g)),
    defaults: byKey([...doc.defaults], (d) => d.sport).map((d) => sortedKeys(d)),
    assignments: byKey([...doc.assignments], (x) => x.workoutStart).map((x) => sortedKeys(x)),
  };
}

function sortedKeys<T extends object>(value: T): T {
  return Object.fromEntries(Object.entries(value).sort(([x], [y]) => (x < y ? -1 : 1))) as T;
}

export const EMPTY_GEAR_DOC: GearDoc = { version: 1, gear: [], defaults: [], assignments: [] };

/** A new gear id: unique enough across phones, no dependency (`crypto.randomUUID` is not in Hermes everywhere). */
export function newGearId(now = Date.now(), random: () => number = Math.random): string {
  return `${now.toString(36)}-${Math.floor(random() * 36 ** 6).toString(36).padStart(6, '0')}`;
}
