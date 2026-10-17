import { describe, expect, it } from 'bun:test';

import { createSession, fatShare, kcalPerMinute } from '../entry/src/main/js/default/common/fuel.js';
import * as substrate from '../../../src/features/workouts/substrate';

const PROFILE = { weightKg: 70, age: 35, sex: 'unknown', maxHr: 185 };
const S = 1000;

function started(now = 0) {
  const s = createSession();
  s.start(PROFILE, now);
  return s;
}

describe('session accumulator', () => {
  it('counts nothing before the second reading', () => {
    const s = started();
    s.sample(120, 0);
    const sum = s.summary(0);
    expect(sum.kcal).toBe(0);
    expect(sum.fatShare).toBeNull();
    expect(sum.lastHr).toBe(120);
    expect(sum.zone).toBe(2);
  });

  it('adds Keytel energy over the time since the previous reading and splits it by the fat share at that reading', () => {
    const s = started();
    s.sample(110, 0);
    s.sample(110, 5 * S);
    const sum = s.summary(5 * S);
    // 6.909226 kcal/min * 5/60 min = 0.575769 kcal; fat share at 110 of 185 = 0.649226
    expect(sum.kcal).toBeCloseTo(0.5757688017845761, 12);
    expect(sum.fatKcal).toBeCloseTo(0.5757688017845761 * 0.6492257882882884, 12);
    expect(sum.carbKcal).toBeCloseTo(0.5757688017845761 * (1 - 0.6492257882882884), 12);
    expect(sum.fatGrams).toBeCloseTo(sum.fatKcal / 9, 12);
    expect(sum.carbGrams).toBeCloseTo(sum.carbKcal / 4, 12);
    expect(sum.fatShare).toBeCloseTo(0.6492257882882884, 12);
  });

  it('attributes a reading slice to the NEW reading, as LiveWorkout.onHeartRate does', () => {
    const s = started();
    s.sample(100, 0);
    s.sample(150, 5 * S);
    const expected = kcalPerMinute(150, 70, 35, 'unknown') * (5 / 60);
    expect(s.summary(5 * S).kcal).toBeCloseTo(expected, 12);
    expect(s.summary(5 * S).fatShare).toBeCloseTo(fatShare(150, 185), 12);
  });

  /**
   * Scenario (70 kg, 35 y, unknown sex, max 185); readings (s, bpm):
   *   0:100  5:110  10:110  15:150  20:150  | 200:150 (180 s gap) 205:150 | pause 210, resume 270 | 275:120 280:120 | finish 285
   * Counted slices of 5 s: 5:110 10:110 (zone 1), 15:150 20:150 205:150 (zone 4), 280:120 (zone 2). 200 is a gap and 275 the
   * first reading after a pause: neither starts a slice.
   *   110: 6.909226 * 5/60 = 0.5757688 kcal, fat 0.6492258
   *   150: 12.062667 * 5/60 = 1.0052223 kcal, fat 0.3547720
   *   120: 8.197586 * 5/60 = 0.6831322 kcal, fat 0.5788429
   *   total 2 x 0.5757688 + 3 x 1.0052223 + 0.6831322 = 4.8503366 kcal
   */
  it('handles gaps, pauses, zones and averages', () => {
    const s = started(0);
    s.sample(100, 0);
    s.sample(110, 5 * S);
    s.sample(110, 10 * S);
    s.sample(150, 15 * S);
    s.sample(150, 20 * S);
    s.sample(150, 200 * S); // gap of 180 s: counted as a pause
    s.sample(150, 205 * S);
    s.pause(210 * S);
    s.sample(130, 212 * S); // ignored while paused
    s.resume(270 * S);
    s.sample(120, 275 * S); // first after the pause: starts a slice, adds none
    s.sample(120, 280 * S);
    s.finish(285 * S);
    const sum = s.summary(999 * S); // frozen at finish
    expect(sum.status).toBe('finished');
    expect(sum.elapsedSec).toBe(225); // 285 s minus the 60 s pause
    expect(sum.countedSec).toBe(30);
    expect(sum.kcal).toBeCloseTo(4.85033659974506, 10);
    expect(sum.fatKcal).toBeCloseTo(2.2129081475173633, 10);
    expect(sum.carbKcal).toBeCloseTo(2.6374284522276965, 10);
    expect(sum.fatGrams).toBeCloseTo(0.2458786830574848, 10);
    expect(sum.carbGrams).toBeCloseTo(0.6593571130569241, 10);
    expect(sum.fatShare).toBeCloseTo(0.4562380572997092, 10);
    expect(sum.zoneSeconds).toEqual([0, 10, 5, 0, 15, 0]);
    expect(sum.avgHr).toBeCloseTo(1160 / 9, 10); // 9 accepted readings
    expect(sum.maxHr).toBe(150);
    expect(sum.lastHr).toBe(120);
  });

  it('counts a gap of exactly two minutes and not one millisecond more', () => {
    const a = started();
    a.sample(110, 0);
    a.sample(110, 120 * S);
    expect(a.summary(120 * S).kcal).toBeCloseTo(kcalPerMinute(110, 70, 35, 'unknown') * 2, 12);
    const b = started();
    b.sample(110, 0);
    b.sample(110, 120 * S + 1);
    expect(b.summary(120 * S + 1).kcal).toBe(0);
  });

  it('ignores readings that are not a positive number and clocks that go backwards', () => {
    const s = started();
    s.sample(110, 10 * S);
    s.sample(0, 15 * S);
    s.sample(-3, 16 * S);
    s.sample(NaN, 17 * S);
    s.sample(Infinity, 18 * S);
    expect(s.summary(18 * S).kcal).toBe(0);
    s.sample(110, 5 * S); // earlier than the previous reading: nothing added, becomes the new reference
    expect(s.summary(18 * S).kcal).toBe(0);
    s.sample(110, 10 * S);
    expect(s.summary(18 * S).kcal).toBeCloseTo(kcalPerMinute(110, 70, 35, 'unknown') * (5 / 60), 12);
  });

  it('does not count readings or time before start, after finish, or while paused', () => {
    const s = createSession();
    s.sample(120, 0);
    expect(s.summary(0).avgHr).toBeNull();
    s.start(PROFILE, 1000);
    s.pause(2000);
    s.finish(5000);
    expect(s.summary(9000).elapsedSec).toBe(1); // ran 1000..2000, then paused until finish closed the pause
    s.sample(120, 6000);
    expect(s.summary(9000).avgHr).toBeNull();
  });

  it('pause and resume are idempotent', () => {
    const s = started(0);
    s.pause(10 * S);
    s.pause(20 * S);
    s.resume(30 * S);
    s.resume(40 * S);
    expect(s.summary(60 * S).elapsedSec).toBe(40); // 60 s minus the 20 s pause (10..30)
  });

  it('time away is a pause: snapshot, restore later, next reading starts a new slice', () => {
    const s = started(0);
    s.sample(110, 0);
    s.sample(110, 5 * S);
    const snap = JSON.parse(JSON.stringify(s.snapshot(10 * S)));
    const r = createSession();
    expect(r.restore(snap, 100 * S)).toBe(true); // 90 s away
    expect(r.status()).toBe('running');
    expect(r.summary(100 * S).elapsedSec).toBe(10); // 100 s minus 90 s away
    r.sample(110, 101 * S); // first after the break: no slice
    expect(r.summary(101 * S).kcal).toBeCloseTo(s.summary(5 * S).kcal, 12);
    r.sample(110, 106 * S);
    expect(r.summary(106 * S).kcal).toBeCloseTo(2 * s.summary(5 * S).kcal, 12);
  });

  it('a paused snapshot stays paused and its elapsed time does not grow while away', () => {
    const s = started(0);
    s.sample(110, 0);
    s.pause(30 * S);
    const r = createSession();
    expect(r.restore(s.snapshot(31 * S), 500 * S)).toBe(true);
    expect(r.status()).toBe('paused');
    expect(r.summary(900 * S).elapsedSec).toBe(30);
    r.resume(1000 * S);
    expect(r.summary(1010 * S).elapsedSec).toBe(40);
  });

  it('refuses a snapshot that is not usable', () => {
    const r = createSession();
    expect(r.restore(null, 0)).toBe(false);
    expect(r.restore({ v: 2 }, 0)).toBe(false);
    expect(r.restore({ v: 1, status: 'idle', profile: {}, zoneMs: [0, 0, 0, 0, 0, 0] }, 0)).toBe(false);
    expect(r.restore({ v: 1, status: 'running', profile: {}, zoneMs: [0] }, 0)).toBe(false);
    expect(r.status()).toBe('idle');
  });

  it('reports the time since the latest reading, null after a pause', () => {
    const s = started(0);
    expect(s.summary(0).sinceSampleMs).toBeNull();
    s.sample(110, 4 * S);
    expect(s.summary(9 * S).sinceSampleMs).toBe(5 * S);
    s.pause(10 * S);
    expect(s.summary(11 * S).sinceSampleMs).toBeNull();
  });

  it('the profile is frozen at start', () => {
    const p = { weightKg: 70, age: 35, sex: 'unknown', maxHr: 185 };
    const s = createSession();
    s.start(p, 0);
    p.weightKg = 120;
    p.maxHr = 150;
    expect(s.summary(0).profile).toEqual({ weightKg: 70, age: 35, sex: 'unknown', maxHr: 185 });
  });
});

describe('against substrate.ts (finished workout split)', () => {
  it('splits like splitWorkout for a constant heart rate, in grams and per zone', () => {
    // Ten minutes at 110 bpm, a reading every 5 s: 120 slices of 5 s, all in zone 1.
    const s = started(0);
    const points = [];
    for (let t = 0; t <= 600; t += 5) {
      s.sample(110, t * S);
      points.push({ ts: t, hr: 110 });
    }
    const sum = s.summary(600 * S);
    const split = substrate.splitWorkout(sum.kcal, points as never, 185);
    expect(split).not.toBeNull();
    expect(sum.fatGrams).toBeCloseTo(split!.fatGrams, 9);
    expect(sum.carbGrams).toBeCloseTo(split!.carbGrams, 9);
    expect(sum.fatShare).toBeCloseTo(split!.fatShare, 9);
    expect(split!.zones.length).toBe(1);
    expect(split!.zones[0].zone).toBe(1);
    expect(sum.zoneSeconds[1]).toBe(split!.zones[0].seconds);
    expect(sum.zoneSeconds[1]).toBe(600);
  });

  it('uses the same two-minute gap rule as splitWorkout', () => {
    const s = started(0);
    const points = [];
    for (const t of [0, 5, 10, 200, 205, 210]) {
      s.sample(110, t * S);
      points.push({ ts: t, hr: 110 });
    }
    const sum = s.summary(210 * S);
    const split = substrate.splitWorkout(sum.kcal, points as never, 185);
    // 5, 10, 205 and 210 each close a 5 s slice; 10 -> 200 is a gap in both
    expect(sum.countedSec).toBe(20);
    expect(split!.zones[0].seconds).toBe(20);
  });
});
