import { describe, expect, it } from 'bun:test';

import { recoveryHoursFromStrain, recoveryLeft } from './recoveryTime';

const H = 3600;
const DAY = 86400;
const DAY_START = 300 * DAY;
const NOW = DAY_START + 12 * H;
const strain = (back: number, s: number) => ({ day: DAY_START - back * DAY, strain: s });

describe('recoveryHoursFromStrain', () => {
  it('is 0 below strain 5, 6 h at 5, 48 h at 21 and capped above', () => {
    expect(recoveryHoursFromStrain(4.9)).toBe(0);
    expect(recoveryHoursFromStrain(5)).toBe(6);
    expect(recoveryHoursFromStrain(13)).toBe(27);
    expect(recoveryHoursFromStrain(21)).toBe(48);
    expect(recoveryHoursFromStrain(30)).toBe(48);
    expect(recoveryHoursFromStrain(Number.NaN)).toBe(0);
  });
});

describe('recoveryLeft', () => {
  const input = { nowSec: NOW, dayStart: DAY_START, workouts: [], strain: [] };

  it('counts the watch value down from the end of the workout', () => {
    const r = recoveryLeft({ ...input, workouts: [{ end: NOW - 5 * H, recoveryHours: 15 }] });
    expect(r).toEqual({ hoursLeft: 10, source: 'watch' });
  });

  it('takes the longest of several, not the sum', () => {
    const r = recoveryLeft({ ...input, workouts: [{ end: NOW - 2 * H, recoveryHours: 10 }, { end: NOW - 20 * H, recoveryHours: 40 }] });
    expect(r?.hoursLeft).toBe(20);
  });

  it('is zero once it has run out, still from the watch', () => {
    expect(recoveryLeft({ ...input, workouts: [{ end: NOW - 30 * H, recoveryHours: 15 }] })).toEqual({ hoursLeft: 0, source: 'watch' });
  });

  it('ignores workouts without a watch value, older than a week, or in the future', () => {
    const r = recoveryLeft({
      ...input,
      workouts: [{ end: NOW - H }, { end: NOW - H, recoveryHours: 0 }, { end: NOW - 8 * DAY, recoveryHours: 500 }, { end: NOW + H, recoveryHours: 20 }],
    });
    expect(r).toBeNull();
  });

  it('falls back to the strain of today and yesterday', () => {
    expect(recoveryLeft({ ...input, strain: [strain(0, 13)] })).toEqual({ hoursLeft: 27, source: 'estimate' });
    // Yesterday's 48 h, 12 h into today.
    expect(recoveryLeft({ ...input, strain: [strain(1, 21)] })).toEqual({ hoursLeft: 36, source: 'estimate' });
    expect(recoveryLeft({ ...input, strain: [strain(1, 21), strain(0, 13)] })?.hoursLeft).toBe(36);
  });

  it('is 0 h on easy days and null with no data at all', () => {
    expect(recoveryLeft({ ...input, strain: [strain(0, 3)] })).toEqual({ hoursLeft: 0, source: 'estimate' });
    expect(recoveryLeft(input)).toBeNull();
    expect(recoveryLeft({ ...input, strain: [strain(5, 20)] })).toBeNull();
  });
});
