import { gunzipSync, gzipSync, strFromU8, strToU8 } from 'fflate';

import type { WorkoutPointRow, WorkoutRow } from '@/db/queries';
import type { WorkoutAnalysis } from '@/features/workouts/analysis/types';

/**
 * The document JoyoFit keeps in JoyoRogo for one workout (JoyoRogo Pro cloud workouts). The source is
 * `packages/api/src/lib/watch-workout.ts` in the joyorogo repo (types, limits, `encodePoints` / `decodePoints`);
 * change both together. The server also validates with zod and the strict analysis schema; `parseWorkoutDoc` below
 * checks what a phone needs before it writes a downloaded document into its own tables.
 *
 * One workout is ONE gzip'd JSON document: the local `workouts` row, every `workout_points` row by column (delta
 * coded) and the derived `WorkoutAnalysis`.
 */

export const WATCH_WORKOUT_DOC_VERSION = 1;

/** The server's limits (`WATCH_WORKOUT_LIMITS`) that matter for what the phone sends or accepts. */
export const WATCH_WORKOUT_LIMITS = {
  /** Largest upload body and largest download the phone accepts (the gzip bytes). */
  gzipBytes: 6_000_000,
  points: 100_000,
} as const;

/** A point of the local `workout_points` table. Every source stores only the fields it has. */
export interface WatchPoint {
  /** Unix seconds. */
  ts: number;
  lat: number | null;
  lon: number | null;
  /** Metres. */
  alt: number | null;
  hr: number | null;
  /** Metres per second. */
  speed: number | null;
  /** Steps per minute (revolutions per minute when cycling). */
  cadence: number | null;
  /** Metres per step. */
  stride: number | null;
  /** Watts. */
  power: number | null;
}

/**
 * The points of one workout, by column. Every column has `n` entries (a column with no value at all is `null`):
 * - `dts`: seconds since the previous point, the first is 0; the first point is at `ts0`.
 * - `lat`, `lon`: degrees times 1e7 (1.1 cm), the first present value absolute and each later one the difference
 *   to the previous present value.
 * - `alt`: centimetres, same difference coding.
 * - `hr`, `cadence`, `power`: as they are, whole numbers.
 * - `speed`: millimetres per second, `stride`: millimetres, as they are.
 * A `null` entry means the point had no value; it does not move the difference base.
 */
export interface WatchPointColumns {
  n: number;
  ts0: number;
  dts: number[];
  lat: (number | null)[] | null;
  lon: (number | null)[] | null;
  alt: (number | null)[] | null;
  hr: (number | null)[] | null;
  speed: (number | null)[] | null;
  cadence: (number | null)[] | null;
  stride: (number | null)[] | null;
  power: (number | null)[] | null;
}

/** The `workouts` row, without its local id, `rev` and the points. */
export interface WatchWorkoutRecord {
  workoutNumber: number;
  /** Unix seconds; the key of the workout, locally and in the cloud. */
  start: number;
  end: number;
  sportType: number;
  sportName: string;
  /** Active seconds. */
  duration: number;
  /** Metres. */
  distance: number;
  calories: number;
  avgHr: number | null;
  maxHr: number | null;
  steps: number;
  complete: boolean;
  imported: boolean;
  /** The watch's summary JSON (laps, pace blocks, ...), verbatim. */
  summaryJson: string;
}

export interface WatchWorkoutDoc {
  v: typeof WATCH_WORKOUT_DOC_VERSION;
  /** Revision of the app's analysis engine the `analysis` was computed with (0 without an analysis). */
  engineRev: number;
  workout: WatchWorkoutRecord;
  points: WatchPointColumns | null;
  analysis: WorkoutAnalysis | null;
}

// --- Point columns ----------------------------------------------------------------------------------------

const SCALE = { lat: 1e7, lon: 1e7, alt: 100, speed: 1000, stride: 1000 } as const;

type Column = (number | null)[];

function deltaColumn(values: readonly (number | null)[], scale: number): Column | null {
  const out: Column = [];
  let prev = 0;
  let any = false;
  for (const value of values) {
    if (value === null || !Number.isFinite(value)) {
      out.push(null);
      continue;
    }
    const q = Math.round(value * scale);
    out.push(q - prev);
    prev = q;
    any = true;
  }
  return any ? out : null;
}

function plainColumn(values: readonly (number | null)[], scale: number): Column | null {
  let any = false;
  const out = values.map((value) => {
    if (value === null || !Number.isFinite(value)) return null;
    any = true;
    return Math.round(value * scale);
  });
  return any ? out : null;
}

function undoDelta(column: Column | null, n: number, scale: number): (number | null)[] {
  if (!column) return new Array<number | null>(n).fill(null);
  let acc = 0;
  return column.map((d) => {
    if (d === null) return null;
    acc += d;
    return acc / scale;
  });
}

function undoPlain(column: Column | null, n: number, scale: number): (number | null)[] {
  if (!column) return new Array<number | null>(n).fill(null);
  return column.map((v) => (v === null ? null : v / scale));
}

/** Points in time order (as `ORDER BY ts` returns them) to columns. */
export function encodePoints(points: readonly WatchPoint[]): WatchPointColumns | null {
  if (points.length === 0) return null;
  const ts0 = points[0]?.ts ?? 0;
  const dts = points.map((p, i) => (i === 0 ? 0 : p.ts - (points[i - 1]?.ts ?? p.ts)));
  return {
    n: points.length,
    ts0,
    dts,
    lat: deltaColumn(points.map((p) => p.lat), SCALE.lat),
    lon: deltaColumn(points.map((p) => p.lon), SCALE.lon),
    alt: deltaColumn(points.map((p) => p.alt), SCALE.alt),
    hr: plainColumn(points.map((p) => p.hr), 1),
    speed: plainColumn(points.map((p) => p.speed), SCALE.speed),
    cadence: plainColumn(points.map((p) => p.cadence), 1),
    stride: plainColumn(points.map((p) => p.stride), SCALE.stride),
    power: plainColumn(points.map((p) => p.power), 1),
  };
}

export function decodePoints(columns: WatchPointColumns | null): WatchPoint[] {
  if (!columns) return [];
  const { n } = columns;
  const lat = undoDelta(columns.lat, n, SCALE.lat);
  const lon = undoDelta(columns.lon, n, SCALE.lon);
  const alt = undoDelta(columns.alt, n, SCALE.alt);
  const hr = undoPlain(columns.hr, n, 1);
  const speed = undoPlain(columns.speed, n, SCALE.speed);
  const cadence = undoPlain(columns.cadence, n, 1);
  const stride = undoPlain(columns.stride, n, SCALE.stride);
  const power = undoPlain(columns.power, n, 1);
  const out: WatchPoint[] = [];
  let ts = columns.ts0;
  for (let i = 0; i < n; i++) {
    ts += columns.dts[i] ?? 0;
    out.push({
      ts,
      lat: lat[i] ?? null,
      lon: lon[i] ?? null,
      alt: alt[i] ?? null,
      hr: hr[i] ?? null,
      speed: speed[i] ?? null,
      cadence: cadence[i] ?? null,
      stride: stride[i] ?? null,
      power: power[i] ?? null,
    });
  }
  return out;
}

// --- Building and reading ---------------------------------------------------------------------------------

export interface BuildWorkoutDocInput {
  workout: WorkoutRow;
  /** `workouts.summary_json`, verbatim. */
  summaryJson: string;
  /** `workout_points` rows in time order. */
  points: readonly WorkoutPointRow[];
  analysis: WorkoutAnalysis;
  /** `ANALYSIS_ENGINE_REV` of the code that computed `analysis`. */
  engineRev: number;
}

export function buildWorkoutDoc({ workout, summaryJson, points, analysis, engineRev }: BuildWorkoutDocInput): WatchWorkoutDoc {
  return {
    v: WATCH_WORKOUT_DOC_VERSION,
    engineRev,
    workout: {
      workoutNumber: workout.workoutNumber,
      start: workout.start,
      end: workout.end,
      sportType: workout.sportType,
      sportName: workout.sportName,
      duration: workout.duration,
      distance: workout.distance,
      calories: workout.calories,
      avgHr: workout.avgHr,
      maxHr: workout.maxHr,
      steps: workout.steps,
      complete: workout.complete,
      imported: workout.imported,
      summaryJson,
    },
    points: encodePoints(points),
    analysis,
  };
}

/**
 * The upload body. `mtime: 0` leaves the clock out of the gzip header, so the same workout always compresses to the
 * same bytes and the server can recognise an upload that changed nothing.
 */
export function gzipDoc(doc: WatchWorkoutDoc): Uint8Array<ArrayBuffer> {
  // fflate writes into a buffer of its own, which its Uint8Array type does not say.
  return gzipSync(strToU8(JSON.stringify(doc)), { level: 6, mtime: 0 }) as Uint8Array<ArrayBuffer>;
}

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const isInt = (value: unknown): value is number => typeof value === 'number' && Number.isInteger(value);
const isCount = (value: unknown): value is number => isInt(value) && value >= 0;
const isNullableInt = (value: unknown): value is number | null => value === null || isInt(value);

const COLUMN_KEYS = ['lat', 'lon', 'alt', 'hr', 'speed', 'cadence', 'stride', 'power'] as const;

function checkColumns(value: unknown): WatchPointColumns {
  if (!isObject(value)) throw new Error('points is not an object');
  const { n, ts0, dts } = value;
  if (!isInt(n) || n < 1 || n > WATCH_WORKOUT_LIMITS.points) throw new Error('points.n is out of range');
  if (!isCount(ts0)) throw new Error('points.ts0 is not a time');
  if (!Array.isArray(dts) || dts.length !== n || !dts.every(isCount)) throw new Error('points.dts must have n whole numbers');
  for (const key of COLUMN_KEYS) {
    const column = value[key];
    if (column === null) continue;
    if (!Array.isArray(column) || column.length !== n || !column.every(isNullableInt)) {
      throw new Error(`points.${key} must be null or have n whole numbers`);
    }
  }
  return value as unknown as WatchPointColumns;
}

/** A parsed document, or an Error saying what is wrong. Only the parts a phone stores are checked; the analysis is passed through. */
export function parseWorkoutDoc(json: unknown): WatchWorkoutDoc {
  if (!isObject(json)) throw new Error('document is not an object');
  if (json.v !== WATCH_WORKOUT_DOC_VERSION) throw new Error(`document version ${String(json.v)} is not supported`);
  if (!isCount(json.engineRev)) throw new Error('engineRev is not a count');
  const w = json.workout;
  if (!isObject(w)) throw new Error('workout is not an object');
  const counts = ['workoutNumber', 'start', 'end', 'sportType', 'duration', 'distance', 'calories', 'steps'] as const;
  for (const key of counts) if (!isCount(w[key])) throw new Error(`workout.${key} is not a count`);
  if (typeof w.sportName !== 'string' || w.sportName === '') throw new Error('workout.sportName is empty');
  if (typeof w.summaryJson !== 'string') throw new Error('workout.summaryJson is not text');
  if (typeof w.complete !== 'boolean' || typeof w.imported !== 'boolean') throw new Error('workout flags are not booleans');
  if (!isNullableInt(w.avgHr) || !isNullableInt(w.maxHr)) throw new Error('workout heart rate is not a whole number');
  const points = json.points === null ? null : checkColumns(json.points);
  if (json.analysis !== null && !isObject(json.analysis)) throw new Error('analysis is not an object');
  return {
    v: WATCH_WORKOUT_DOC_VERSION,
    engineRev: json.engineRev,
    workout: w as unknown as WatchWorkoutRecord,
    points,
    analysis: json.analysis as WorkoutAnalysis | null,
  };
}

/** gzip bytes of a downloaded document to a checked document. */
export function readWorkoutDoc(bytes: Uint8Array): WatchWorkoutDoc {
  if (bytes.byteLength > WATCH_WORKOUT_LIMITS.gzipBytes) throw new Error('document is larger than the server accepts');
  let json: unknown;
  try {
    json = JSON.parse(strFromU8(gunzipSync(bytes)));
  } catch {
    throw new Error('document is not gzip JSON');
  }
  return parseWorkoutDoc(json);
}
