import type { WorkoutRow } from '@/db/queries';

import type { AnalysisPoint } from './series';

/** Synthetic workouts for the analysis tests (and for generating sample payloads). Not used by the app. */
export const T0 = 1_760_000_000;
/** Metres per degree of latitude on the sphere `haversineM` uses, so a northward leg measures exactly what it was built as. */
const M_PER_DEG = (6_371_000 * Math.PI) / 180;

export function row(ts: number, over: Partial<AnalysisPoint> = {}): AnalysisPoint {
  return { ts, lat: null, lon: null, alt: null, hr: null, speed: null, cadence: null, stride: null, power: null, ...over };
}

export function workoutRow(over: Partial<WorkoutRow> = {}): WorkoutRow {
  return {
    id: 1,
    workoutNumber: 1,
    start: T0,
    end: T0 + 1500,
    sportType: 1,
    sportName: 'Outdoor Run',
    duration: 1500,
    distance: 0,
    calories: 0,
    avgHr: null,
    maxHr: null,
    steps: 0,
    complete: true,
    imported: false,
    ...over,
  };
}

export interface Leg {
  sec: number;
  /** Metres per second; 0 is a pause with no GPS fixes (the watch writes pause markers around it). */
  speed: number;
}

export interface StraightRunOptions {
  legs: Leg[];
  start?: number;
  lat0?: number;
  lon0?: number;
  hr?: (t: number) => number | null;
  alt?: (t: number) => number | null;
  cadence?: (t: number) => number | null;
  power?: (t: number) => number | null;
  /** Leave GPS out (a treadmill, a gym). */
  noGps?: boolean;
}

export interface Synth {
  points: AnalysisPoint[];
  elapsed: number;
  /** Metres covered. */
  distance: number;
}

/**
 * A run due north: one GPS row per second while moving (separate rows from the data rows, as in the database), pause
 * markers (lat 90, lon -80) around each pause, and optional heart-rate/altitude/cadence/power rows every second.
 */
export function straightRun(o: StraightRunOptions): Synth {
  const start = o.start ?? T0;
  const lat0 = o.lat0 ?? -6.2;
  const lon0 = o.lon0 ?? 106.8;
  const elapsed = o.legs.reduce((s, l) => s + l.sec, 0);
  const points: AnalysisPoint[] = [];
  let dist = 0;
  let t = 0;
  const data = (at: number) => {
    const hr = o.hr?.(at) ?? null;
    const alt = o.alt?.(at) ?? null;
    const cadence = o.cadence?.(at) ?? null;
    const power = o.power?.(at) ?? null;
    if (hr !== null || alt !== null || cadence !== null || power !== null) points.push(row(start + at, { hr, alt, cadence, power }));
  };
  for (const leg of o.legs) {
    if (leg.speed === 0) {
      if (!o.noGps) {
        points.push(row(start + t, { lat: lat0 + dist / M_PER_DEG, lon: lon0 }));
        points.push(row(start + t, { lat: 90, lon: -80 }));
      }
      for (let s = 0; s < leg.sec; s++) data(t + s);
      t += leg.sec;
      if (!o.noGps) points.push(row(start + t, { lat: 90, lon: -80 }));
      continue;
    }
    for (let s = 0; s < leg.sec; s++) {
      if (!o.noGps) points.push(row(start + t, { lat: lat0 + dist / M_PER_DEG, lon: lon0 }));
      data(t);
      dist += leg.speed;
      t += 1;
    }
  }
  if (!o.noGps) points.push(row(start + t, { lat: lat0 + dist / M_PER_DEG, lon: lon0 }));
  data(t);
  return { points, elapsed, distance: dist };
}
