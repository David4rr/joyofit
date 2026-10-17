/**
 * Training effect of one workout. The watch's aerobic and anaerobic effect (0 to 5) and its training points are shown
 * as the watch reported them. Without an aerobic effect from the watch, JoyoFit estimates one from the workout's
 * TRIMP: `5 x (1 - e^(-TRIMP / 150))`, so an hour at 60 to 70 % of maximum heart rate (TRIMP 120) is 2.8 and two hard
 * hours (480) 4.8. That curve is JoyoFit's own. There is no estimate for the anaerobic effect or the points: the
 * heart rate alone does not carry them, and the unit of the watch's points is not verified.
 */
export const EFFECT_MAX = 5;
const TRIMP_K = 150;

export interface EffectValue {
  value: number;
  source: 'watch' | 'estimate';
}

export interface TrainingEffect {
  aerobic: EffectValue | null;
  anaerobic: EffectValue | null;
  /** Watch training points, as reported. */
  points: number | null;
  /** Watch workout load, as reported (the watch's unit, not TRIMP). */
  load: number | null;
}

/** The watch's effect when it is inside 0..5, else null. */
export function plausibleEffect(value: number | undefined | null): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= EFFECT_MAX ? value : null;
}

export function aerobicEffectFromTrimp(trimp: number): number {
  if (!(trimp > 0)) return 0;
  return Math.round(EFFECT_MAX * (1 - Math.exp(-trimp / TRIMP_K)) * 10) / 10;
}

export function trainingEffect(
  summary: { aerobicEffect?: number; anaerobicEffect?: number; trainingPoints?: number; workoutLoad?: number },
  trimp: number | null,
): TrainingEffect {
  const aerobicWatch = plausibleEffect(summary.aerobicEffect);
  const anaerobicWatch = plausibleEffect(summary.anaerobicEffect);
  const aerobic: EffectValue | null =
    aerobicWatch !== null
      ? { value: aerobicWatch, source: 'watch' }
      : trimp !== null && trimp > 0
        ? { value: aerobicEffectFromTrimp(trimp), source: 'estimate' }
        : null;
  return {
    aerobic,
    anaerobic: anaerobicWatch !== null ? { value: anaerobicWatch, source: 'watch' } : null,
    points: typeof summary.trainingPoints === 'number' && summary.trainingPoints >= 0 ? summary.trainingPoints : null,
    load: typeof summary.workoutLoad === 'number' && summary.workoutLoad > 0 ? summary.workoutLoad : null,
  };
}

/** Plain word for an effect, JoyoFit's bands: under 1 none, then barely, maintains, improves, strongly, too much. */
export function effectWord(value: number): string {
  if (value < 1) return 'Hampir tidak ada';
  if (value < 2) return 'Ringan';
  if (value < 3) return 'Menjaga kebugaran';
  if (value < 4) return 'Meningkatkan';
  if (value < 5) return 'Sangat meningkatkan';
  return 'Sangat berat';
}
