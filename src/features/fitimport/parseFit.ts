/**
 * Reads a FIT activity file (the format iGPSPORT, Garmin, Wahoo, Bryton, Magene and XOSS bike computers and watches
 * write) with Garmin's own SDK and turns it into what JoyoFit stores for a workout. Pure functions, no React Native
 * imports, so they run under `bun test`.
 *
 * What is read: `file_id` (must be an activity; the manufacturer names the workout), the `session` messages (totals:
 * start, elapsed and timer time, distance, calories, heart rate, speed, ascent, cadence, power; several sessions, as
 * after a pause in some head units, are added up into one workout) and the `record` messages (one per sample: time,
 * position, altitude, heart rate), which become `workout_points`. Cadence and power exist only as session totals: the
 * `workout_points` table has no columns for them.
 */
import { Decoder, type FitMessages, Stream } from '@garmin/fitsdk';

import { FIT_EPOCH_OFFSET } from '../strava/fitEncoder';

/** Why a file is not imported. `unreadable` (the phone could not open it), `duplicate` and `overlap` come from the callers of `parseFitActivity`. */
export type FitImportFailure = 'unreadable' | 'not-fit' | 'corrupt' | 'not-activity' | 'no-session' | 'duplicate' | 'overlap';

export interface FitImportError {
  ok: false;
  reason: FitImportFailure;
  message: string;
}

/** Huawei sport type bytes, as stored in `workouts.sport_type` (see `WorkoutSportTypes.kt`). */
export const SPORT = {
  running: 1,
  walking: 2,
  cycling: 3,
  indoorRunning: 5,
  indoorCycling: 7,
  trailRun: 11,
  indoorWalking: 13,
  hiking: 14,
  /** The watch's own "Exercise": every sport JoyoFit does not name. */
  other: 255,
} as const;

interface SportInfo {
  type: number;
  /** Gadgetbridge `ActivityKind` name, as the watch rows carry in `summary_json.kind`. */
  kind: string;
  /** Short name; the file's manufacturer is added in parentheses. */
  name: string;
  /** Pace (min/km) is the natural figure, not speed. */
  foot: boolean;
}

const SPORTS: Readonly<Record<number, SportInfo>> = {
  [SPORT.running]: { type: SPORT.running, kind: 'RUNNING', name: 'Run', foot: true },
  [SPORT.walking]: { type: SPORT.walking, kind: 'WALKING', name: 'Walk', foot: true },
  [SPORT.cycling]: { type: SPORT.cycling, kind: 'CYCLING', name: 'Ride', foot: false },
  [SPORT.indoorRunning]: { type: SPORT.indoorRunning, kind: 'INDOOR_RUNNING', name: 'Treadmill run', foot: true },
  [SPORT.indoorCycling]: { type: SPORT.indoorCycling, kind: 'INDOOR_CYCLING', name: 'Indoor ride', foot: false },
  [SPORT.trailRun]: { type: SPORT.trailRun, kind: 'TRAIL_RUN', name: 'Trail run', foot: true },
  [SPORT.indoorWalking]: { type: SPORT.indoorWalking, kind: 'INDOOR_WALKING', name: 'Indoor walk', foot: true },
  [SPORT.hiking]: { type: SPORT.hiking, kind: 'HIKING', name: 'Hike', foot: true },
  [SPORT.other]: { type: SPORT.other, kind: 'EXERCISE', name: 'Workout', foot: false },
};

/** FIT `sport` and `sub_sport` (names, or numbers the SDK has no name for) to the Huawei sport JoyoFit stores. */
export function sportFor(fitSport: string | number | undefined, fitSubSport: string | number | undefined): SportInfo {
  const sport = String(fitSport);
  const sub = String(fitSubSport);
  const indoorRide = sub === 'indoorCycling' || sub === 'spin' || sub === 'virtualActivity';
  const treadmill = sub === 'treadmill' || sub === 'indoorRunning' || sub === 'virtualActivity';
  const indoorWalk = sub === 'indoorWalking' || sub === 'treadmill';
  let type: number = SPORT.other;
  if (sport === 'cycling' || sport === 'eBiking') type = indoorRide ? SPORT.indoorCycling : SPORT.cycling;
  else if (sport === 'fitnessEquipment' && (sub === 'indoorCycling' || sub === 'spin')) type = SPORT.indoorCycling;
  else if (sport === 'running') type = sub === 'trail' ? SPORT.trailRun : treadmill ? SPORT.indoorRunning : SPORT.running;
  else if (sport === 'walking') type = indoorWalk ? SPORT.indoorWalking : SPORT.walking;
  else if (sport === 'hiking') type = SPORT.hiking;
  return SPORTS[type] as SportInfo;
}

/** FIT `manufacturer` names (SDK profile) to the brand as written on the box. Others are left out of the workout name. */
const BRANDS: Readonly<Record<string, string>> = {
  igpsport: 'iGPSPORT',
  garmin: 'Garmin',
  wahooFitness: 'Wahoo',
  magene: 'Magene',
  bryton: 'Bryton',
  brytonSensors: 'Bryton',
  coros: 'COROS',
  corosByte: 'COROS',
  suunto: 'Suunto',
  polarElectro: 'Polar',
  hammerhead: 'Hammerhead',
  lezyne: 'Lezyne',
  sigmasport: 'Sigma',
  stagesCycling: 'Stages',
  cycplus: 'CYCPLUS',
  onelap: 'OneLap',
  giantManufacturingCo: 'Giant',
  zwift: 'Zwift',
  zwiftByte: 'Zwift',
};

export interface FitPoint {
  /** Unix seconds. */
  ts: number;
  /** Degrees; null without a GPS fix. */
  lat: number | null;
  lon: number | null;
  alt: number | null;
  hr: number | null;
}

export interface FitActivity {
  /** Unix seconds. */
  start: number;
  end: number;
  sport: SportInfo;
  /** Brand from `file_id.manufacturer`, when known. */
  manufacturer: string | null;
  /** `Ride (iGPSPORT)`. */
  name: string;
  /** Active seconds. */
  timerSeconds: number;
  /** Metres. */
  distance: number;
  /** kcal. */
  calories: number;
  avgHr: number | null;
  maxHr: number | null;
  minHr: number | null;
  /** Metres per second. */
  avgSpeed: number | null;
  maxSpeed: number | null;
  /** Metres. */
  ascent: number | null;
  descent: number | null;
  minAltitude: number | null;
  maxAltitude: number | null;
  /** Steps of a foot sport (two per stride) when the file counts strides, else 0. */
  steps: number;
  /** rpm of a bike, strides per minute of a foot sport. */
  avgCadence: number | null;
  maxCadence: number | null;
  /** Watts. */
  avgPower: number | null;
  maxPower: number | null;
  normalizedPower: number | null;
  points: FitPoint[];
}

type Session = NonNullable<FitMessages['sessionMesgs']>[number];
type RecordMesg = NonNullable<FitMessages['recordMesgs']>[number];

/** Decoded without `convertDateTimesToDates`, so a timestamp is a number of seconds although the SDK types it as a Date. */
const seconds = (value: unknown): number | null => (typeof value === 'number' && Number.isFinite(value) ? value : null);
const num = (value: unknown): number | null => (typeof value === 'number' && Number.isFinite(value) ? value : null);
const positive = (value: unknown): number | null => {
  const n = num(value);
  return n !== null && n > 0 ? n : null;
};

/** FIT timestamps below this are time since the device powered on, not UTC (the profile's `date_time` rule). */
const MIN_UTC_FIT_TIME = 0x10000000;

const failure = (reason: FitImportFailure, message: string): FitImportError => ({ ok: false, reason, message });

const semicirclesToDegrees = (value: number): number => (value * 180) / 2 ** 31;

function point(record: RecordMesg): FitPoint | null {
  const t = seconds(record.timestamp);
  if (t === null || t < MIN_UTC_FIT_TIME) return null;
  const rawLat = num(record.positionLat);
  const rawLon = num(record.positionLong);
  let lat: number | null = null;
  let lon: number | null = null;
  if (rawLat !== null && rawLon !== null) {
    const la = semicirclesToDegrees(rawLat);
    const lo = semicirclesToDegrees(rawLon);
    // Some head units write 0,0 before the first fix.
    if (Math.abs(la) <= 90 && Math.abs(lo) <= 180 && !(la === 0 && lo === 0)) {
      lat = la;
      lon = lo;
    }
  }
  const hr = num(record.heartRate);
  return {
    ts: t + FIT_EPOCH_OFFSET,
    lat,
    lon,
    alt: num(record.enhancedAltitude) ?? num(record.altitude),
    hr: hr !== null && hr > 0 && hr < 255 ? Math.round(hr) : null,
  };
}

/** Mean of `value` over the sessions that have it, weighted by active time. */
function weighted(sessions: readonly Session[], value: (s: Session) => number | null): number | null {
  let sum = 0;
  let weight = 0;
  for (const s of sessions) {
    const v = value(s);
    if (v === null) continue;
    const w = positive(s.totalTimerTime) ?? 1;
    sum += v * w;
    weight += w;
  }
  return weight > 0 ? sum / weight : null;
}

const sumOf = (sessions: readonly Session[], value: (s: Session) => number | null): number | null => {
  let total: number | null = null;
  for (const s of sessions) {
    const v = value(s);
    if (v !== null) total = (total ?? 0) + v;
  }
  return total;
};

const maxOf = (sessions: readonly Session[], value: (s: Session) => number | null): number | null => {
  let best: number | null = null;
  for (const s of sessions) {
    const v = value(s);
    if (v !== null && (best === null || v > best)) best = v;
  }
  return best;
};

/** Smallest and largest present value; a loop, as a long ride has too many samples to spread into `Math.min`. */
function extent(values: readonly (number | null)[]): { min: number | null; max: number | null } {
  let min: number | null = null;
  let max: number | null = null;
  for (const v of values) {
    if (v === null) continue;
    if (min === null || v < min) min = v;
    if (max === null || v > max) max = v;
  }
  return { min, max };
}

const rounded = (value: number | null): number | null => (value === null ? null : Math.round(value));

/**
 * Parses a FIT activity. Errors are values, not exceptions: the screen shows `message` as it is. An activity needs a
 * `session` message and a start time; heart rate, position, altitude, power and cadence are optional.
 */
export function parseFitActivity(bytes: Uint8Array): FitActivity | FitImportError {
  let messages: FitMessages;
  try {
    // A copy, so the SDK reads exactly these bytes whatever buffer the caller's view sits in.
    const decoder = new Decoder(Stream.fromArrayBuffer(bytes.slice().buffer));
    if (!decoder.isFIT()) return failure('not-fit', 'This is not a FIT file. Pick the .fit file your bike computer recorded.');
    if (!decoder.checkIntegrity()) return failure('corrupt', 'This FIT file is damaged or was cut short (its checksum does not match).');
    messages = decoder.read({ convertDateTimesToDates: false }).messages;
  } catch {
    return failure('corrupt', 'This FIT file could not be read; it looks damaged.');
  }

  const fileType = messages.fileIdMesgs?.[0]?.type;
  if (fileType !== undefined && String(fileType) !== 'activity') {
    return failure('not-activity', `This is a FIT ${String(fileType)} file, not an activity file. Pick the file of a recorded ride or run.`);
  }

  const sessions = (messages.sessionMesgs ?? [])
    .filter((s) => seconds(s.startTime) !== null)
    .sort((a, b) => (seconds(a.startTime) ?? 0) - (seconds(b.startTime) ?? 0));
  if (sessions.length === 0) return failure('no-session', 'This FIT file has no activity session (no totals for a ride or run), so there is nothing to import.');

  const points = (messages.recordMesgs ?? [])
    .map(point)
    .filter((p): p is FitPoint => p !== null)
    .sort((a, b) => a.ts - b.ts);

  const startFit = Math.min(...sessions.map((s) => seconds(s.startTime) as number));
  if (startFit < MIN_UTC_FIT_TIME) return failure('no-session', 'This FIT file has no real start time (the device had no clock set), so it cannot be placed in your history.');
  const start = startFit + FIT_EPOCH_OFFSET;
  const elapsedOf = (s: Session): number | null => positive(s.totalElapsedTime) ?? positive(s.totalTimerTime);
  let end = Math.max(...sessions.map((s) => (seconds(s.startTime) as number) + (elapsedOf(s) ?? 0))) + FIT_EPOCH_OFFSET;
  const lastPoint = points[points.length - 1];
  if (end <= start && lastPoint) end = lastPoint.ts;
  if (end <= start) return failure('no-session', 'This FIT file has no duration, so there is nothing to import.');

  const longest = sessions.reduce((a, b) => ((positive(b.totalTimerTime) ?? 0) > (positive(a.totalTimerTime) ?? 0) ? b : a));
  const sport = sportFor(longest.sport, longest.subSport);
  const timer = Math.round(sumOf(sessions, (s) => positive(s.totalTimerTime)) ?? end - start);
  const lastRecord = messages.recordMesgs?.[messages.recordMesgs.length - 1];
  const distance = sumOf(sessions, (s) => positive(s.totalDistance)) ?? positive(lastRecord?.distance) ?? 0;
  const avgSpeed =
    weighted(sessions, (s) => positive(s.enhancedAvgSpeed) ?? positive(s.avgSpeed)) ?? (distance > 0 && timer > 0 ? distance / timer : null);
  const altitude = extent(points.map((p) => p.alt));
  const heartRate = extent(points.map((p) => p.hr));
  const strides = sumOf(sessions, (s) => positive(s.totalStrides));
  const manufacturerRaw = messages.fileIdMesgs?.[0]?.manufacturer;
  const manufacturer = manufacturerRaw === undefined ? null : (BRANDS[String(manufacturerRaw)] ?? null);

  return {
    start,
    end,
    sport,
    manufacturer,
    name: manufacturer ? `${sport.name} (${manufacturer})` : sport.name,
    timerSeconds: timer,
    distance,
    calories: Math.round(sumOf(sessions, (s) => positive(s.totalCalories)) ?? 0),
    avgHr: rounded(weighted(sessions, (s) => positive(s.avgHeartRate))),
    maxHr: maxOf(sessions, (s) => positive(s.maxHeartRate)) ?? heartRate.max,
    minHr: heartRate.min,
    avgSpeed,
    maxSpeed: maxOf(sessions, (s) => positive(s.enhancedMaxSpeed) ?? positive(s.maxSpeed)),
    ascent: rounded(sumOf(sessions, (s) => num(s.totalAscent))),
    descent: rounded(sumOf(sessions, (s) => num(s.totalDescent))),
    minAltitude: altitude.min,
    maxAltitude: altitude.max,
    steps: sport.foot && strides !== null ? Math.round(strides * 2) : 0,
    avgCadence: rounded(weighted(sessions, (s) => positive(s.avgCadence))),
    maxCadence: maxOf(sessions, (s) => positive(s.maxCadence)),
    avgPower: rounded(weighted(sessions, (s) => positive(s.avgPower))),
    maxPower: maxOf(sessions, (s) => positive(s.maxPower)),
    normalizedPower: rounded(weighted(sessions, (s) => positive(s.normalizedPower))),
    points,
  };
}
