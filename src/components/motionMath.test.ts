import { describe, expect, test } from 'bun:test';

import { countUpValue, easeOutCubic, IDLE_SYNC, sweepRange, trackSync } from './motionMath';

describe('easeOutCubic', () => {
  test('runs from 0 to 1 and clamps', () => {
    expect(easeOutCubic(0)).toBe(0);
    expect(easeOutCubic(1)).toBe(1);
    expect(easeOutCubic(2)).toBe(1);
    expect(easeOutCubic(-1)).toBe(0);
  });
  test('is ahead of linear early on', () => {
    expect(easeOutCubic(0.25)).toBeGreaterThan(0.25);
  });
});

describe('countUpValue', () => {
  test('lands exactly on the target', () => {
    expect(countUpValue(0, 87, 500, 500)).toBe(87);
    expect(countUpValue(0, 87, 900, 500)).toBe(87);
  });
  test('starts at the origin and counts down as well as up', () => {
    expect(countUpValue(40, 80, 0, 500)).toBe(40);
    expect(countUpValue(80, 40, 250, 500)).toBeLessThan(80);
    expect(countUpValue(80, 40, 250, 500)).toBeGreaterThan(40);
  });
  test('a zero duration jumps', () => {
    expect(countUpValue(0, 5, 0, 0)).toBe(5);
  });
});

describe('sweepRange', () => {
  test('first bar starts at 0, last ends at 1', () => {
    expect(sweepRange(0, 60, 0.5)).toEqual([0, 0.5]);
    const [start, end] = sweepRange(59, 60, 0.5);
    expect(start).toBeCloseTo(0.5);
    expect(end).toBeCloseTo(1);
  });
  test('a single bar has no stagger', () => {
    expect(sweepRange(0, 1, 0.5)).toEqual([0, 0.5]);
  });
});

describe('trackSync', () => {
  test('a sync that moves the last-sync time ends in the check', () => {
    const running = trackSync(IDLE_SYNC, true, 100);
    expect(running).toEqual({ began: true, startedWith: 100, done: false });
    expect(trackSync(running, true, 100)).toBe(running);
    expect(trackSync(running, false, 200)).toEqual({ began: false, startedWith: null, done: true });
  });
  test('a first-ever sync (no earlier time) counts too', () => {
    const running = trackSync(IDLE_SYNC, true, null);
    expect(trackSync(running, false, 50).done).toBe(true);
  });
  test('a sync that ends without a new time shows no check and keeps waiting', () => {
    const running = trackSync(IDLE_SYNC, true, 100);
    expect(trackSync(running, false, 100)).toBe(running);
    expect(trackSync(running, false, null)).toBe(running);
  });
  test('a new sync clears the check', () => {
    const done = { began: false, startedWith: null, done: true };
    expect(trackSync(done, true, 200)).toEqual({ began: true, startedWith: 200, done: false });
  });
  test('nothing happens while idle', () => {
    expect(trackSync(IDLE_SYNC, false, 100)).toBe(IDLE_SYNC);
  });
});
