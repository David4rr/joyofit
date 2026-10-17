import { describe, expect, it } from 'bun:test';

import { BASE_SLEEP_NEED_SEC, MIN_DEBT_NIGHTS, sleepDebtSec, sleepNeedSec } from '@/features/today/readiness';
import { sleepNeedTonight } from './sleepNeed';

const H = 3600;

describe('sleepNeedSec', () => {
  it('is 7.5 h with no strain and no debt', () => {
    expect(sleepNeedSec(null)).toBe(7.5 * H);
    expect(sleepNeedSec(0)).toBe(7.5 * H);
  });
  it('adds up to 1 h for strain and clamps outside 0..21', () => {
    expect(sleepNeedSec(21)).toBe(8.5 * H);
    expect(sleepNeedSec(10.5)).toBe(8 * H);
    expect(sleepNeedSec(40)).toBe(8.5 * H);
    expect(sleepNeedSec(-3)).toBe(7.5 * H);
  });
  it('adds a quarter of the debt, at most 1 h', () => {
    expect(sleepNeedSec(0, 2 * H)).toBe(8 * H);
    expect(sleepNeedSec(0, 10 * H)).toBe(8.5 * H);
    expect(sleepNeedSec(0, -5 * H)).toBe(7.5 * H);
    expect(sleepNeedSec(21, 10 * H)).toBe(9.5 * H);
  });
});

describe('sleepDebtSec', () => {
  it('sums the shortfall against 7.5 h and ignores oversleeping', () => {
    expect(sleepDebtSec([6 * H, 7 * H, 9 * H])).toBe(1.5 * H + 0.5 * H);
  });
  it('is null with fewer than 3 nights', () => {
    expect(sleepDebtSec([4 * H, 4 * H])).toBeNull();
    expect(sleepDebtSec([4 * H, 4 * H, 4 * H])).not.toBeNull();
    expect(MIN_DEBT_NIGHTS).toBe(3);
  });
});

describe('sleepNeedTonight', () => {
  it('splits base, strain and debt', () => {
    const r = sleepNeedTonight({ todayStrain: 21, nightsAsleepSec: [6.5 * H, 6.5 * H, 6.5 * H, 6.5 * H] });
    expect(r.baseSec).toBe(BASE_SLEEP_NEED_SEC);
    expect(r.strainExtraSec).toBe(H);
    expect(r.debtSec).toBe(4 * H);
    expect(r.debtExtraSec).toBe(H);
    expect(r.needSec).toBe(9.5 * H);
  });
  it('has no debt term without enough nights, and no strain term without strain', () => {
    const r = sleepNeedTonight({ todayStrain: null, nightsAsleepSec: [5 * H] });
    expect(r.debtSec).toBeNull();
    expect(r.debtExtraSec).toBe(0);
    expect(r.strainExtraSec).toBe(0);
    expect(r.needSec).toBe(BASE_SLEEP_NEED_SEC);
  });
});
