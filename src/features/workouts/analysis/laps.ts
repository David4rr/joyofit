import type { SummaryLap } from '@/features/workouts/summary';

import { round } from './round';
import { ANALYSIS_LIMITS, type AnalysisLap } from './types';

/** Below this distance a lap's pace says nothing. */
const MIN_PACE_LAP_M = 50;

export interface LapGrid {
  stepSec: number;
  n: number;
  dist: readonly number[] | null;
  hr: readonly (number | null)[] | null;
  cad: readonly (number | null)[] | null;
  cumGain: readonly number[] | null;
}

function mean(values: readonly (number | null)[] | null, from: number, to: number): number | null {
  if (!values) return null;
  let sum = 0;
  let count = 0;
  for (let i = Math.max(0, from); i <= Math.min(values.length - 1, to); i++) {
    const v = values[i];
    if (v !== null) {
      sum += v;
      count += 1;
    }
  }
  return count > 0 ? sum / count : null;
}

/** Cumulative distance at `t` seconds, interpolated between grid samples. */
function distAt(dist: readonly number[], stepSec: number, t: number): number {
  const x = Math.min(dist.length - 1, Math.max(0, t / stepSec));
  const i = Math.floor(x);
  const next = Math.min(dist.length - 1, i + 1);
  return dist[i] + (dist[next] - dist[i]) * (x - i);
}

/**
 * Laps of the watch (`summary.laps`, unix seconds) on the workout's own clock. What the lap does not carry (distance,
 * average heart rate and cadence, climb) is read from the grid; `hrAllowed` false drops every heart-rate field.
 */
export function buildLaps(
  laps: readonly SummaryLap[] | undefined,
  start: number,
  g: LapGrid,
  onFoot: boolean,
  hrAllowed: boolean,
): AnalysisLap[] {
  const out: AnalysisLap[] = [];
  for (const lap of laps ?? []) {
    if (out.length >= ANALYSIS_LIMITS.laps) break;
    const sec = lap.endTs - lap.startTs;
    if (!(sec > 0)) continue;
    const startSec = Math.max(0, lap.startTs - start);
    const endSec = startSec + sec;
    const from = Math.ceil(startSec / g.stepSec);
    const to = Math.floor(endSec / g.stepSec);
    const distM = lap.distanceM ?? (g.dist ? distAt(g.dist, g.stepSec, endSec) - distAt(g.dist, g.stepSec, startSec) : null);
    const avgHr = lap.avgHr ?? mean(g.hr, from, to);
    const avgCad = lap.avgCadence ?? mean(g.cad, from, to);
    const iS = Math.min(g.n - 1, Math.round(startSec / g.stepSec));
    const iE = Math.min(g.n - 1, Math.round(endSec / g.stepSec));
    out.push({
      n: out.length + 1,
      startSec: Math.round(startSec),
      sec: Math.round(sec),
      distM: distM === null ? null : Math.round(distM),
      paceSecKm: onFoot && distM !== null && distM >= MIN_PACE_LAP_M ? Math.round(sec / (distM / 1000)) : null,
      avgHr: hrAllowed && avgHr !== null ? Math.round(avgHr) : null,
      maxHr: hrAllowed && typeof lap.maxHr === 'number' ? Math.round(lap.maxHr) : null,
      avgCad: avgCad === null ? null : Math.round(avgCad),
      gainM: g.cumGain ? round(g.cumGain[iE] - g.cumGain[iS], 1) : null,
    });
  }
  return out;
}
