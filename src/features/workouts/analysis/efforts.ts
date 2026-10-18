import { cleanFixes, type CleanFix, type RawFix } from './geo';
import { isFootKind } from './sport';
import { BEST_EFFORT_DISTANCES, type AnalysisBestEffort, type BestEffortKey, type SportKind } from './types';

const KEYS = Object.keys(BEST_EFFORT_DISTANCES) as BestEffortKey[];

export type EffortSeconds = Partial<Record<BestEffortKey, number>>;

interface Window {
  sec: number;
  atM: number;
}

/**
 * Fastest stretch of `distM` metres on the cleaned fixes: a sliding window whose far end sits on each fix in turn, and
 * then whose near end does, the other end interpolated linearly in time between the two fixes around it.
 */
function fastestWindow(fixes: readonly CleanFix[], distM: number): Window | null {
  const total = fixes.length > 0 ? fixes[fixes.length - 1].dist : 0;
  if (fixes.length < 2 || total < distM) return null;
  let best: Window | null = null;
  const consider = (sec: number, atM: number) => {
    if (sec > 0 && (best === null || sec < best.sec)) best = { sec, atM };
  };

  let i = 0;
  for (let j = 1; j < fixes.length; j++) {
    const target = fixes[j].dist - distM;
    if (target < 0) continue;
    while (i + 1 < j && fixes[i + 1].dist <= target) i++;
    const a = fixes[i];
    const b = fixes[i + 1];
    const tStart = a.ts + ((target - a.dist) / (b.dist - a.dist)) * (b.ts - a.ts);
    consider(fixes[j].ts - tStart, target);
  }

  let j = 1;
  for (let k = 0; k < fixes.length - 1; k++) {
    const target = fixes[k].dist + distM;
    if (target > total) break;
    while (j < fixes.length - 1 && fixes[j].dist < target) j++;
    const a = fixes[j - 1];
    const b = fixes[j];
    const tEnd = a.ts + ((target - a.dist) / (b.dist - a.dist)) * (b.ts - a.ts);
    consider(tEnd - fixes[k].ts, fixes[k].dist);
  }
  return best;
}

/** Best effort seconds per distance on already cleaned fixes. */
function secondsPerKey(fixes: readonly CleanFix[]): Partial<Record<BestEffortKey, Window>> {
  const out: Partial<Record<BestEffortKey, Window>> = {};
  for (const key of KEYS) {
    const w = fastestWindow(fixes, BEST_EFFORT_DISTANCES[key]);
    if (w) out[key] = w;
  }
  return out;
}

/**
 * Best efforts of this workout, shortest distance first. `rank` is 1 plus the number of past workouts in `history` that
 * were strictly faster at the same distance; null when the history has nothing for that distance.
 */
export function bestEfforts(fixes: readonly CleanFix[], history: readonly EffortSeconds[]): AnalysisBestEffort[] {
  const found = secondsPerKey(fixes);
  const out: AnalysisBestEffort[] = [];
  for (const key of KEYS) {
    const w = found[key];
    if (!w) continue;
    const sec = Math.round(w.sec);
    const past = history.map((h) => h[key]).filter((v): v is number => typeof v === 'number' && v > 0);
    out.push({ key, sec, atM: Math.round(w.atM), rank: past.length > 0 ? 1 + past.filter((v) => v < sec).length : null });
  }
  return out;
}

/** Best effort seconds of a past workout, for ranking later ones. Empty unless the sport is on foot. */
export function bestEffortsForHistory(points: readonly RawFix[], kind: SportKind = 'run'): EffortSeconds {
  if (!isFootKind(kind)) return {};
  const found = secondsPerKey(cleanFixes(points, kind));
  const out: EffortSeconds = {};
  for (const key of KEYS) {
    const w = found[key];
    if (w) out[key] = Math.round(w.sec);
  }
  return out;
}
