import { describe, expect, it } from 'bun:test';

import { median, plausibleVo2, uthSorensen, vo2maxStatus } from './vo2max';

const DAY = 86400;
const NOW = 200 * DAY;
const base = { nowSec: NOW, dayStart: NOW, workouts: [], resting: new Map<number, number>(), maxHr: 185 };
const resting = (days: number, bpm: number) => new Map(Array.from({ length: days }, (_, i) => [NOW - i * DAY, bpm] as [number, number]));

describe('plausibleVo2', () => {
  it('accepts 10..90 and rejects everything else, including the 2 a wrong unit would give', () => {
    expect(plausibleVo2(10)).toBe(10);
    expect(plausibleVo2(90)).toBe(90);
    expect(plausibleVo2(9)).toBeNull();
    expect(plausibleVo2(91)).toBeNull();
    expect(plausibleVo2(2)).toBeNull();
    expect(plausibleVo2(undefined)).toBeNull();
    expect(plausibleVo2(Number.NaN)).toBeNull();
  });
});

describe('uthSorensen', () => {
  it('is 15.3 x max / rest', () => {
    expect(uthSorensen(185, 60)).toBeCloseTo(47.175);
    expect(uthSorensen(190, 50)).toBeCloseTo(58.14);
  });
  it('needs a believable resting rate below the maximum', () => {
    expect(uthSorensen(185, 29)).toBeNull();
    expect(uthSorensen(185, 111)).toBeNull();
    expect(uthSorensen(60, 60)).toBeNull();
    expect(uthSorensen(185, Number.NaN)).toBeNull();
  });
});

describe('median', () => {
  it('handles empty, odd and even', () => {
    expect(median([])).toBeNull();
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 2, 3])).toBe(2.5);
  });
});

describe('vo2maxStatus', () => {
  it('takes the newest plausible watch value and labels it as the watch', () => {
    const workouts = [
      { start: NOW - 40 * DAY, vo2max: 44 },
      { start: NOW - 20 * DAY, vo2max: 46 },
      { start: NOW - 2 * DAY, vo2max: 2 },
    ];
    const s = vo2maxStatus({ ...base, workouts });
    expect(s?.source).toBe('watch');
    expect(s?.value).toBe(46);
    expect(s?.trend.map((p) => p.value)).toEqual([44, 46]);
    expect(s?.delta).toBe(2);
  });

  it('has no delta with one value or a trend shorter than a week', () => {
    expect(vo2maxStatus({ ...base, workouts: [{ start: NOW - DAY, vo2max: 50 }] })?.delta).toBeNull();
    expect(vo2maxStatus({ ...base, workouts: [{ start: NOW - 3 * DAY, vo2max: 50 }, { start: NOW - DAY, vo2max: 51 }] })?.delta).toBeNull();
  });

  it('ignores watch values older than 90 days and falls back to the estimate', () => {
    const s = vo2maxStatus({ ...base, workouts: [{ start: NOW - 91 * DAY, vo2max: 50 }], resting: resting(14, 60) });
    expect(s?.source).toBe('estimate');
    expect(s?.value).toBeCloseTo(47.175);
    expect(s?.asOf).toBe(NOW);
  });

  it('needs 5 days of resting heart rate for the estimate', () => {
    expect(vo2maxStatus({ ...base, resting: resting(4, 60) })).toBeNull();
    expect(vo2maxStatus({ ...base, resting: resting(5, 60) })?.source).toBe('estimate');
    expect(vo2maxStatus(base)).toBeNull();
  });

  it('uses the median so one odd day does not move it, and builds a weekly trend', () => {
    const map = resting(28, 60);
    map.set(NOW - 3 * DAY, 40);
    const s = vo2maxStatus({ ...base, resting: map });
    expect(s?.value).toBeCloseTo(47.175);
    expect(s?.trend.length).toBe(4);
  });

  it('has nothing when the resting rate is out of range', () => {
    expect(vo2maxStatus({ ...base, resting: resting(14, 25) })).toBeNull();
  });
});
