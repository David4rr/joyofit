import { round } from './round';
import type { AnalysisComparison, AnalysisComparisonItem, SportKind } from './types';

const MAX_SIMILAR = 5;
const DISTANCE_TOLERANCE = 0.2;
const DURATION_TOLERANCE = 0.25;
/** Below this distance a pace says nothing. */
const MIN_PACE_DISTANCE_M = 100;

/** A past workout, summary level: what the comparison needs without its points. */
export interface SimilarCandidate {
  id: number;
  /** Unix seconds. */
  start: number;
  /** Active seconds. */
  duration: number;
  /** Metres, 0 for none. */
  distance: number;
  sportName: string;
  kind: SportKind;
  avgHr: number | null;
  /** Elevation gain in metres. */
  gain: number | null;
  /** Seconds spent moving, when known; `duration` otherwise. */
  movingSec?: number | null;
}

export interface SimilarTarget {
  start: number;
  duration: number;
  distance: number;
  sportName: string;
}

/**
 * Same sport, earlier start, and either a distance within 20 percent (when this workout has a distance) or else a duration
 * within 25 percent. Newest first, at most 5. Null when nothing matches.
 */
export function selectSimilar(target: SimilarTarget, candidates: readonly SimilarCandidate[]): AnalysisComparison | null {
  const byDistance = target.distance > 0;
  const matches = candidates
    .filter((c) => {
      if (c.sportName !== target.sportName || !(c.start < target.start)) return false;
      if (byDistance) return c.distance > 0 && Math.abs(c.distance - target.distance) / target.distance <= DISTANCE_TOLERANCE;
      return target.duration > 0 && c.duration > 0 && Math.abs(c.duration - target.duration) / target.duration <= DURATION_TOLERANCE;
    })
    .sort((a, b) => b.start - a.start)
    .slice(0, MAX_SIMILAR);
  if (matches.length === 0) return null;
  const items: AnalysisComparisonItem[] = matches.map((c) => {
    const sec = c.movingSec && c.movingSec > 0 ? c.movingSec : c.duration;
    const onFoot = c.kind === 'run' || c.kind === 'walk' || c.kind === 'ride';
    return {
      startedAt: c.start * 1000,
      distM: c.distance > 0 ? Math.round(c.distance) : null,
      sec: Math.round(sec),
      paceSecKm: onFoot && c.distance >= MIN_PACE_DISTANCE_M && sec > 0 ? Math.round(sec / (c.distance / 1000)) : null,
      avgHr: c.avgHr === null ? null : Math.round(c.avgHr),
      gainM: c.gain === null ? null : round(c.gain, 1),
    };
  });
  return { basis: byDistance ? 'distance' : 'duration', items };
}
