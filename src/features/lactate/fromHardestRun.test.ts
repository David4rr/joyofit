import { describe, expect, it } from 'bun:test';

import { lthrFromHardestRun, type HardestRunInput } from './fromHardestRun';
import type { TrialPoint } from './trial';

const NOW = 1_760_000_000;
const DAY = 86_400;
const MAX = 190;

/** A run read once a second from `start`, `seconds` long. */
function points(start: number, seconds: number, hr: (t: number) => number | null): TrialPoint[] {
  return Array.from({ length: seconds + 1 }, (_, t) => ({ ts: start + t, hr: hr(t), speed: 3, lat: null, lon: null }));
}

function runOf(id: number, daysAgo: number, hr: (t: number) => number | null, opts: { seconds?: number; sportType?: number } = {}): HardestRunInput {
  const start = NOW - daysAgo * DAY;
  return { workoutId: id, start, sportType: opts.sportType ?? 1, points: points(start, opts.seconds ?? 45 * 60, hr) };
}

/** 15 minutes easy, then 25 minutes at `hard`, then easy. */
const hardAfterWarmup = (hard: number) => (t: number) => (t < 900 ? 120 : t < 900 + 1500 ? hard : 125);

describe('lthrFromHardestRun', () => {
  it('is 95 % of the hardest 20-minute mean, rounded', () => {
    // 171 x 0.95 = 162.45 -> 162; 173 x 0.95 = 164.35 -> 164; 172 x 0.95 = 163.4 -> 163.
    expect(lthrFromHardestRun([runOf(1, 3, hardAfterWarmup(171))], MAX, NOW)?.lthr).toBe(162);
    expect(lthrFromHardestRun([runOf(1, 3, hardAfterWarmup(173))], MAX, NOW)?.lthr).toBe(164);
    // 174 x 0.95 = 165.3 -> 165; 175 x 0.95 = 166.25 -> 166; 178 x 0.95 = 169.1 -> 169; 179 x 0.95 = 170.05 -> 170.
    expect(lthrFromHardestRun([runOf(1, 3, hardAfterWarmup(174))], MAX, NOW)?.lthr).toBe(165);
    expect(lthrFromHardestRun([runOf(1, 3, hardAfterWarmup(179))], MAX, NOW)?.lthr).toBe(170);
    // 170.5 x 0.95 = 161.975 -> 162 (rounds up, not down).
    expect(lthrFromHardestRun([runOf(1, 3, (t) => (t < 900 ? 120 : t % 2 === 0 ? 170 : 171))], MAX, NOW)?.lthr).toBe(162);
  });

  it('reports the run and the window mean', () => {
    const r = lthrFromHardestRun([runOf(7, 5, hardAfterWarmup(170))], MAX, NOW);
    expect(r).toEqual({ lthr: 162, windowMeanHr: 170, at: NOW - 5 * DAY, workoutId: 7 });
  });

  it('picks the hardest window across runs', () => {
    const runs = [runOf(1, 10, hardAfterWarmup(160)), runOf(2, 6, hardAfterWarmup(175)), runOf(3, 2, hardAfterWarmup(165))];
    const r = lthrFromHardestRun(runs, MAX, NOW);
    expect(r?.workoutId).toBe(2);
    expect(r?.lthr).toBe(166);
  });

  it('finds the hardest 20 minutes inside a run, not its average', () => {
    // 20 minutes at 172 inside easy running: the whole run averages far lower, the window does not.
    const hr = (t: number) => (t >= 1200 && t < 2400 ? 172 : 110);
    expect(lthrFromHardestRun([runOf(1, 1, hr, { seconds: 3000 })], MAX, NOW)?.windowMeanHr).toBe(172);
  });

  it('leaves out the first 10 minutes of a run', () => {
    // Hard from the start for 25 minutes: the window may only start at minute 10, so it holds 15 hard + 5 easy minutes, mean (15x175 + 5x100)/20 = 156.25 -> under 80 % of 200.
    const hr = (t: number) => (t < 1500 ? 175 : 100);
    const r = lthrFromHardestRun([runOf(1, 1, hr, { seconds: 1800 })], 200, NOW);
    expect(r).toBeNull();
    // With the 10 minutes counting, 20 hard minutes would have averaged 175 (>= 160). A run of 20 + 10 minutes still qualifies once past the settle time.
    expect(lthrFromHardestRun([runOf(1, 1, (t) => (t < 600 ? 175 : t < 1800 ? 172 : 100), { seconds: 1800 })], 200, NOW)?.windowMeanHr).toBe(172);
  });

  it('skips runs older than 42 days', () => {
    expect(lthrFromHardestRun([runOf(1, 43, hardAfterWarmup(175))], MAX, NOW)).toBeNull();
    expect(lthrFromHardestRun([runOf(1, 41, hardAfterWarmup(175))], MAX, NOW)?.workoutId).toBe(1);
    expect(lthrFromHardestRun([runOf(1, 43, hardAfterWarmup(185)), runOf(2, 20, hardAfterWarmup(170))], MAX, NOW)?.workoutId).toBe(2);
  });

  it('skips sports that are not runs, and takes treadmill and trail runs', () => {
    expect(lthrFromHardestRun([runOf(1, 2, hardAfterWarmup(175), { sportType: 3 })], MAX, NOW)).toBeNull();
    expect(lthrFromHardestRun([runOf(1, 2, hardAfterWarmup(175), { sportType: 2 })], MAX, NOW)).toBeNull();
    expect(lthrFromHardestRun([runOf(1, 2, hardAfterWarmup(175), { sportType: 5 })], MAX, NOW)?.workoutId).toBe(1);
    expect(lthrFromHardestRun([runOf(1, 2, hardAfterWarmup(175), { sportType: 11 })], MAX, NOW)?.workoutId).toBe(1);
  });

  it('skips runs without heart-rate coverage of a window', () => {
    // Heart rate drops out for 5 of every 20 minutes: coverage 75 % < 90 %.
    const gappy = (t: number) => (t % 1200 < 300 ? null : 178);
    expect(lthrFromHardestRun([runOf(1, 2, gappy)], MAX, NOW)).toBeNull();
    // No heart rate at all, and a run too short for a window after the settling time.
    expect(lthrFromHardestRun([runOf(1, 2, () => null)], MAX, NOW)).toBeNull();
    expect(lthrFromHardestRun([runOf(1, 2, () => 178, { seconds: 25 * 60 })], MAX, NOW)).toBeNull();
    // A gappy run does not hide a covered one.
    expect(lthrFromHardestRun([runOf(1, 2, gappy), runOf(2, 4, hardAfterWarmup(170))], MAX, NOW)?.workoutId).toBe(2);
  });

  it('does not offer an easy effort: the window must reach 80 % of the maximum heart rate', () => {
    expect(lthrFromHardestRun([runOf(1, 2, hardAfterWarmup(151))], MAX, NOW)).toBeNull();
    expect(lthrFromHardestRun([runOf(1, 2, hardAfterWarmup(152))], MAX, NOW)?.lthr).toBe(144);
  });

  it('is never above the maximum heart rate', () => {
    expect(lthrFromHardestRun([runOf(1, 2, hardAfterWarmup(200))], 150, NOW)?.lthr).toBe(150);
  });

  it('is null without runs', () => {
    expect(lthrFromHardestRun([], MAX, NOW)).toBeNull();
  });
});
