import type { EffortSeconds } from '@/features/workouts/analysis/efforts';
import { BEST_EFFORT_DISTANCES, type BestEffortKey } from '@/features/workouts/analysis/types';

/**
 * Race predictions with Riegel's formula (1981): T2 = T1 x (D2 / D1)^1.06, from the best efforts of the last 90 days'
 * runs (`bestEfforts` of the workout analysis, not recomputed here). Only the efforts of 5 km and longer are used as a
 * base, since the formula is built for endurance pace. Each target takes the base closest to its own distance (on the
 * log scale), because the further the extrapolation, the less the exponent holds. A base more than 10 times shorter or
 * 5 times longer than the target is not used.
 *
 * It shows only with at least 3 runs that have a 5 km effort. Predictions assume you train for that distance: a
 * marathon time from a 5 km best is optimistic unless you run the long runs.
 */
export const RIEGEL_EXPONENT = 1.06;
export const MIN_QUALIFYING_RUNS = 3;
export const MAX_EXTRAPOLATION = 10;
export const MAX_REDUCTION = 5;

export type RaceKey = '5k' | '10k' | 'half' | 'full';

export const RACES: readonly { key: RaceKey; label: string; distance: number }[] = [
  { key: '5k', label: '5K', distance: 5000 },
  { key: '10k', label: '10K', distance: 10000 },
  { key: 'half', label: 'Setengah maraton', distance: 21097.5 },
  { key: 'full', label: 'Maraton', distance: 42195 },
];

const BASES: readonly BestEffortKey[] = ['5k', '10k', 'half'];

export interface RacePrediction {
  key: RaceKey;
  label: string;
  distance: number;
  seconds: number;
  /** The best effort the time was projected from. */
  basedOn: BestEffortKey;
}

export type RacePredictions = { kind: 'ok'; predictions: RacePrediction[] } | { kind: 'short'; runs: number; need: number };

export function riegel(seconds: number, fromMeters: number, toMeters: number): number {
  return seconds * Math.pow(toMeters / fromMeters, RIEGEL_EXPONENT);
}

/** `efforts`: best-effort seconds of each run of the window, one entry per run (see `bestEffortsForHistory`). */
export function predictRaces(efforts: readonly EffortSeconds[]): RacePredictions {
  const qualifying = efforts.filter((e) => typeof e['5k'] === 'number' && e['5k'] > 0);
  if (qualifying.length < MIN_QUALIFYING_RUNS) return { kind: 'short', runs: qualifying.length, need: MIN_QUALIFYING_RUNS };

  const best = new Map<BestEffortKey, number>();
  for (const key of BASES) {
    const times = qualifying.map((e) => e[key]).filter((v): v is number => typeof v === 'number' && v > 0);
    if (times.length > 0) best.set(key, Math.min(...times));
  }

  const predictions: RacePrediction[] = [];
  for (const race of RACES) {
    let pick: { key: BestEffortKey; gap: number } | null = null;
    for (const [key] of best) {
      const ratio = race.distance / BEST_EFFORT_DISTANCES[key];
      if (ratio > MAX_EXTRAPOLATION || ratio < 1 / MAX_REDUCTION) continue;
      const gap = Math.abs(Math.log(ratio));
      if (pick === null || gap < pick.gap) pick = { key, gap };
    }
    if (pick === null) continue;
    const seconds = riegel(best.get(pick.key) as number, BEST_EFFORT_DISTANCES[pick.key], race.distance);
    predictions.push({ key: race.key, label: race.label, distance: race.distance, seconds: Math.round(seconds), basedOn: pick.key });
  }
  return { kind: 'ok', predictions };
}
