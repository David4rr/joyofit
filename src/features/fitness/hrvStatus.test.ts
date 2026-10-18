import { describe, expect, it } from 'bun:test';

import type { HrvReadingRow } from '@/db/queries';
import { applyLocale } from '@/i18n';
import { hrvStatus, MIN_BASELINE_NIGHTS, MIN_RECENT_NIGHTS } from './hrvStatus';

const DAY = 86400;
const NOW = 500 * DAY;
const night = (back: number, rmssd: number, source: HrvReadingRow['source'] = 'night'): HrvReadingRow => ({
  start: NOW - back * DAY - 8 * 3600,
  end: NOW - back * DAY,
  source,
  rmssd,
  beats: 1000,
});
/** Baseline nights 8..(7+count) days back, alternating around 50 ms so the spread is real. */
const baseline = (count: number) => Array.from({ length: count }, (_, i) => night(8 + i, i % 2 === 0 ? 45 : 55));
const week = (rmssd: number, count = 5) => Array.from({ length: count }, (_, i) => night(i, rmssd));

function status(readings: HrvReadingRow[]) {
  const r = hrvStatus(readings, NOW);
  if (!('status' in r)) throw new Error(`missing: ${r.missing}`);
  return r.status;
}

describe('hrvStatus', () => {
  it('is balanced when the week sits on the baseline', () => {
    const s = status([...baseline(30), ...week(50)]);
    expect(s.state).toBe('balanced');
    expect(s.recentNights).toBe(5);
    expect(s.baselineNights).toBe(30);
    expect(s.baselineMs).toBeGreaterThan(49);
    expect(s.baselineMs).toBeLessThan(50);
    expect(s.lowMs).toBeLessThan(s.baselineMs);
    expect(s.highMs).toBeGreaterThan(s.baselineMs);
  });

  it('is low below the range and unbalanced above it', () => {
    expect(status([...baseline(30), ...week(30)]).state).toBe('low');
    expect(status([...baseline(30), ...week(80)]).state).toBe('unbalanced');
  });

  it('keeps the edges inside balanced', () => {
    const all = [...baseline(30)];
    const s = status([...all, ...week(50)]);
    expect(status([...all, ...week(s.lowMs * 1.001)]).state).toBe('balanced');
    expect(status([...all, ...week(s.lowMs * 0.999)]).state).toBe('low');
    expect(status([...all, ...week(s.highMs * 1.001)]).state).toBe('unbalanced');
  });

  it('floors the spread so identical nights do not flag a 3 % change', () => {
    const flat = Array.from({ length: 20 }, (_, i) => night(8 + i, 50));
    expect(status([...flat, ...week(48.5)]).state).toBe('balanced');
    expect(status([...flat, ...week(44)]).state).toBe('low');
  });

  it('explains what is missing in English', async () => {
    await applyLocale('en');
    try {
      expect(hrvStatus([...baseline(MIN_BASELINE_NIGHTS - 1), ...week(50)], NOW)).toEqual({ missing: '13 of 14 nights for your baseline' });
    } finally {
      await applyLocale('id');
    }
  });

  it('needs 14 baseline nights and 3 recent ones', () => {
    expect(hrvStatus([...baseline(MIN_BASELINE_NIGHTS - 1), ...week(50)], NOW)).toEqual({ missing: '13 dari 14 malam untuk baseline kamu' });
    expect('status' in hrvStatus([...baseline(MIN_BASELINE_NIGHTS), ...week(50)], NOW)).toBe(true);
    expect(hrvStatus([...baseline(30), ...week(50, MIN_RECENT_NIGHTS - 1)], NOW)).toEqual({ missing: '2 dari 3 malam dalam 7 hari terakhir' });
    expect('status' in hrvStatus([...baseline(30), ...week(50, MIN_RECENT_NIGHTS)], NOW)).toBe(true);
  });

  it('counts night readings only, and only the 60 days before the week', () => {
    const spot = Array.from({ length: 30 }, (_, i) => night(8 + i, 50, 'spot'));
    expect('missing' in hrvStatus([...spot, ...week(50)], NOW)).toBe(true);
    const tooOld = Array.from({ length: 30 }, (_, i) => night(68 + i, 50));
    expect('missing' in hrvStatus([...tooOld, ...week(50)], NOW)).toBe(true);
  });

  it('has nothing without readings', () => {
    expect('missing' in hrvStatus([], NOW)).toBe(true);
  });
});
