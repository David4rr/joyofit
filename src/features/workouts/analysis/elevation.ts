import type { WorkoutSummary } from '@/features/workouts/summary';

/** A climb or drop counts once the altitude has moved this far from the last counted level. */
export const ELEVATION_HYSTERESIS_M = 2;

export interface ElevationProfile {
  gain: number;
  loss: number;
  /** Cumulative gain/loss at every sample (non-decreasing), so a stretch's climb is a difference of two entries. */
  cumGain: number[];
  cumLoss: number[];
}

/**
 * Gain and loss of an altitude series with a 2 m hysteresis: noise smaller than that never counts, a real climb counts in
 * full (to within the last 2 m) however many small steps it takes. Null samples carry the previous level.
 */
export function elevationProfile(alt: readonly (number | null)[]): ElevationProfile {
  const cumGain: number[] = [];
  const cumLoss: number[] = [];
  let gain = 0;
  let loss = 0;
  let ref: number | null = null;
  for (const a of alt) {
    if (a !== null) {
      if (ref === null) ref = a;
      else if (a - ref >= ELEVATION_HYSTERESIS_M) {
        gain += a - ref;
        ref = a;
      } else if (ref - a >= ELEVATION_HYSTERESIS_M) {
        loss += ref - a;
        ref = a;
      }
    }
    cumGain.push(gain);
    cumLoss.push(loss);
  }
  return { gain, loss, cumGain, cumLoss };
}

export interface ElevationSummary {
  gainM: number;
  lossM: number;
  minM: number;
  maxM: number;
}

function finiteNonNegative(value: number | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}

/**
 * Elevation totals: the watch barometer's gain and loss when the summary has them, else the hysteresis result over the
 * smoothed altitude; min and max from the altitude series, else the summary. Null when neither source says anything.
 */
export function elevationSummary(
  alt: readonly (number | null)[] | null,
  profile: ElevationProfile | null,
  summary: WorkoutSummary,
): ElevationSummary | null {
  const gain = finiteNonNegative(summary.elevationGain) ?? profile?.gain ?? null;
  const loss = finiteNonNegative(summary.elevationLoss) ?? profile?.loss ?? null;
  let min = Infinity;
  let max = -Infinity;
  for (const a of alt ?? []) {
    if (a === null) continue;
    if (a < min) min = a;
    if (a > max) max = a;
  }
  if (min === Infinity) {
    min = summary.minAltitude ?? Infinity;
    max = summary.maxAltitude ?? -Infinity;
  }
  if (gain === null || loss === null || min === Infinity || max === -Infinity) return null;
  return { gainM: gain, lossM: loss, minM: min, maxM: max };
}
