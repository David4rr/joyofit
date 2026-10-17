import { describe, expect, it } from 'bun:test';

import {
  fatBarPx,
  formatBpm,
  formatDuration,
  formatGrams,
  formatKcal,
  formatPercent,
} from '../entry/src/main/js/default/common/format.js';

describe('formatDuration', () => {
  it('is m:ss under an hour and h:mm:ss after', () => {
    expect(formatDuration(0)).toBe('0:00');
    expect(formatDuration(9)).toBe('0:09');
    expect(formatDuration(75)).toBe('1:15');
    expect(formatDuration(3599)).toBe('59:59');
    expect(formatDuration(3600)).toBe('1:00:00');
    expect(formatDuration(3725)).toBe('1:02:05');
  });

  it('rounds down fractions and clamps nonsense', () => {
    expect(formatDuration(74.99)).toBe('1:14');
    expect(formatDuration(-5)).toBe('0:00');
    expect(formatDuration(NaN)).toBe('0:00');
  });
});

describe('numbers', () => {
  it('rounds kcal to whole numbers', () => {
    expect(formatKcal(311.6)).toBe('312');
    expect(formatKcal(0.49)).toBe('0');
    expect(formatKcal(0.5)).toBe('1');
    expect(formatKcal(-2)).toBe('0');
  });

  it('shows grams with one decimal, carrying 9.96 to 10.0', () => {
    expect(formatGrams(4.449)).toBe('4.4');
    expect(formatGrams(4.45)).toBe('4.5');
    expect(formatGrams(0)).toBe('0.0');
    expect(formatGrams(9.96)).toBe('10.0');
    expect(formatGrams(123.04)).toBe('123.0');
    expect(formatGrams(-1)).toBe('0.0');
  });

  it('shows percent and bpm, and -- for nothing', () => {
    expect(formatPercent(0.349)).toBe('35%');
    expect(formatPercent(0)).toBe('0%');
    expect(formatPercent(1)).toBe('100%');
    expect(formatPercent(null)).toBe('--');
    expect(formatBpm(142.4)).toBe('142');
    expect(formatBpm(null)).toBe('--');
  });

  it('splits a bar by the fat share, halves when empty, clamped', () => {
    expect(fatBarPx(0.35, 360)).toBe(126);
    expect(fatBarPx(null, 360)).toBe(180);
    expect(fatBarPx(-1, 360)).toBe(0);
    expect(fatBarPx(2, 360)).toBe(360);
  });
});
