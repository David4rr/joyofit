import type { SportCategory } from '@/features/workouts/sportCategory';
import type { JsonObject } from '../subject';

export const MAX_CUSTOM_METRICS = 4;
export const MIN_CUSTOM_METRICS = 1;

export interface MetricDef {
  id: string;
  labelKey: string;
  fields: readonly string[];
  isAvailable: (run: JsonObject) => boolean;
}

const pos = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0;
const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

export const METRIC_CATALOG: readonly MetricDef[] = [
  { id: 'time', labelKey: 'time', fields: ['movingSec', 'elapsedSec'], isAvailable: (r) => pos(r.movingSec) },
  { id: 'distance', labelKey: 'distance', fields: ['distanceM'], isAvailable: (r) => pos(r.distanceM) },
  { id: 'pace', labelKey: 'pace', fields: ['paceSecKm', 'pace100Sec'], isAvailable: (r) => pos(r.paceSecKm) || pos(r.pace100Sec) },
  { id: 'speed', labelKey: 'speed', fields: ['speedKmh'], isAvailable: (r) => pos(r.speedKmh) },
  { id: 'hr', labelKey: 'avgHr', fields: ['hrAvg'], isAvailable: (r) => pos(r.hrAvg) },
  { id: 'hrMax', labelKey: 'maxHr', fields: ['hrMax'], isAvailable: (r) => pos(r.hrMax) },
  { id: 'kcal', labelKey: 'kcal', fields: ['kcal'], isAvailable: (r) => pos(r.kcal) },
  { id: 'elevation', labelKey: 'elevation', fields: ['elevGainM'], isAvailable: (r) => num(r.elevGainM) },
  { id: 'cadence', labelKey: 'cadence', fields: ['cadence'], isAvailable: (r) => pos(r.cadence) },
  { id: 'power', labelKey: 'power', fields: ['power'], isAvailable: (r) => pos(r.power) },
  { id: 'steps', labelKey: 'steps', fields: ['steps'], isAvailable: (r) => pos(r.steps) },
  { id: 'jumps', labelKey: 'jumps', fields: ['jumps'], isAvailable: (r) => pos(r.jumps) },
  { id: 'laps', labelKey: 'laps', fields: ['laps'], isAvailable: (r) => pos(r.laps) },
  { id: 'swolf', labelKey: 'swolf', fields: ['swolf'], isAvailable: (r) => pos(r.swolf) },
  { id: 'strokes', labelKey: 'strokes', fields: ['strokes'], isAvailable: (r) => pos(r.strokes) },
  { id: 'volume', labelKey: 'volume', fields: ['volumeKg'], isAvailable: (r) => pos(r.volumeKg) },
  { id: 'sets', labelKey: 'sets', fields: ['sets'], isAvailable: (r) => pos(r.sets) },
  { id: 'reps', labelKey: 'reps', fields: ['reps'], isAvailable: (r) => pos(r.reps) },
];

/** Resolves the field used as the headline hero stat for this workout family. */
export function getHeroField(run: JsonObject, category: SportCategory): string | null {
  switch (category) {
    case 'run':
    case 'other':
      return pos(run.distanceM) ? 'distanceM' : pos(run.movingSec) ? 'movingSec' : null;
    case 'walk':
      return pos(run.distanceM) ? 'distanceM' : pos(run.steps) ? 'steps' : pos(run.movingSec) ? 'movingSec' : null;
    case 'ride':
    case 'swim':
      return pos(run.distanceM) ? 'distanceM' : pos(run.movingSec) ? 'movingSec' : null;
    case 'gym':
      return pos(run.volumeKg) ? 'volumeKg' : pos(run.movingSec) ? 'movingSec' : null;
    case 'cardio':
      return pos(run.jumps) ? 'jumps' : pos(run.movingSec) ? 'movingSec' : null;
    case 'flow':
    case 'court':
      return pos(run.movingSec) ? 'movingSec' : null;
  }
}

/** Lists all metrics recorded in this workout, omitting the one serving as the hero headline. */
export function getAvailableMetrics(run: JsonObject, category: SportCategory): MetricDef[] {
  const hero = getHeroField(run, category);
  return METRIC_CATALOG.filter((m) => {
    if (!m.isAvailable(run)) return false;
    // Omit metric if its primary field is already serving as the hero
    if (hero && m.fields.includes(hero)) return false;
    return true;
  });
}

const PRIORITY_BY_CATEGORY: Readonly<Record<SportCategory, readonly string[]>> = {
  run: ['time', 'pace', 'hr', 'kcal', 'elevation', 'cadence', 'steps'],
  walk: ['time', 'pace', 'elevation', 'steps', 'hr', 'kcal'],
  ride: ['time', 'speed', 'elevation', 'cadence', 'power', 'hr', 'kcal'],
  swim: ['time', 'pace', 'laps', 'swolf', 'strokes', 'hr', 'kcal'],
  gym: ['time', 'sets', 'reps', 'volume', 'kcal', 'hr'],
  cardio: ['time', 'kcal', 'hr', 'hrMax', 'jumps', 'cadence'],
  flow: ['kcal', 'hr', 'hrMax'],
  court: ['kcal', 'hr', 'hrMax', 'steps', 'distance'],
  other: ['time', 'pace', 'speed', 'hr', 'kcal', 'elevation', 'steps'],
};

/** Selects default metrics for the workout category, capped at MAX_CUSTOM_METRICS. */
export function getDefaultMetrics(run: JsonObject, category: SportCategory): string[] {
  const available = new Set(getAvailableMetrics(run, category).map((m) => m.id));
  const priority = PRIORITY_BY_CATEGORY[category] ?? PRIORITY_BY_CATEGORY.other;
  const chosen: string[] = [];
  for (const id of priority) {
    if (available.has(id)) {
      chosen.push(id);
      if (chosen.length >= MAX_CUSTOM_METRICS) break;
    }
  }
  return chosen;
}

/** Returns a shallow copy of data with run pruned of any unselected metric fields (hero preserved). */
export function applyCustomMetrics(data: JsonObject, selectedIds: readonly string[]): JsonObject {
  const originalRun = data.run as JsonObject | undefined;
  if (!originalRun) return data;

  const category = (originalRun.category as SportCategory) ?? 'run';
  const hero = getHeroField(originalRun, category);
  const selectedSet = new Set(selectedIds.slice(0, MAX_CUSTOM_METRICS));

  const newRun: JsonObject = { ...originalRun };
  for (const def of METRIC_CATALOG) {
    if (selectedSet.has(def.id)) continue;
    for (const field of def.fields) {
      if (field !== hero) {
        delete newRun[field];
      }
    }
  }
  return { ...data, run: newRun };
}
