import { describe, expect, test } from 'bun:test';

import { applyLocale } from './core';
import { fmtAgo, fmtDecimal, fmtDistance, fmtDuration, fmtInt, fmtPercent } from './format';

describe('format helpers follow the locale', () => {
  test('numbers', () => {
    expect(fmtInt(1234.6, 'id')).toBe('1.235');
    expect(fmtInt(1234.6, 'en')).toBe('1,235');
    expect(fmtDecimal(68.5, 1, 'id')).toBe('68,5');
    expect(fmtDecimal(68.5, 1, 'en')).toBe('68.5');
    expect(fmtPercent(42, 'en')).toBe('42%');
  });

  test('durations and distances', () => {
    expect(fmtDuration(7 * 3600 + 5 * 60, 'id')).toBe('7 j 05 mnt');
    expect(fmtDuration(7 * 3600 + 5 * 60, 'en')).toBe('7 h 05 min');
    expect(fmtDuration(42 * 60, 'en')).toBe('42 min');
    expect(fmtDistance(12_340, 'id')).toBe('12,34 km');
    expect(fmtDistance(850, 'en')).toBe('850 m');
  });

  test('time ago', () => {
    expect(fmtAgo(1000, 1030, 'id')).toBe('baru saja');
    expect(fmtAgo(1000, 1000 + 5 * 60, 'en')).toBe('5 min ago');
    expect(fmtAgo(1000, 1000 + 3 * 3600, 'id')).toBe('3 j lalu');
  });

  test('switching the active language changes the default', async () => {
    await applyLocale('en');
    expect(fmtInt(1234)).toBe('1,234');
    await applyLocale('id');
    expect(fmtInt(1234)).toBe('1.234');
  });
});
