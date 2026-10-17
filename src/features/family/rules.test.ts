import { describe, expect, test } from 'bun:test';

import type { FamilyRules } from '@/cloud/family';
import { clampHours, isClock, NO_STEPS_HOUR, NO_SYNC_HOURS, normalizeRules, quietText, shiftClock } from '@/features/family/rules';

const RULES: FamilyRules = {
  noSync: { on: true, hours: 12 },
  restingHr: { on: true },
  noSteps: { on: true, hour: 11 },
  sleep: { on: true },
  spo2: { on: false },
  push: true,
  email: false,
  quietStart: '21:30',
  quietEnd: '06:30',
};

describe('clampHours', () => {
  test('keeps a value inside the Worker range', () => {
    expect(clampHours(12, NO_SYNC_HOURS)).toBe(12);
    expect(clampHours(2, NO_SYNC_HOURS)).toBe(3);
    expect(clampHours(49, NO_SYNC_HOURS)).toBe(48);
    expect(clampHours(8, NO_STEPS_HOUR)).toBe(9);
    expect(clampHours(15, NO_STEPS_HOUR)).toBe(14);
  });

  test('rounds to a whole hour, and a non-number falls to the low end', () => {
    expect(clampHours(11.6, NO_STEPS_HOUR)).toBe(12);
    expect(clampHours(Number.NaN, NO_SYNC_HOURS)).toBe(3);
  });
});

describe('shiftClock', () => {
  test('moves by half hours', () => {
    expect(shiftClock('21:30', 30)).toBe('22:00');
    expect(shiftClock('06:30', -30)).toBe('06:00');
  });

  test('wraps around midnight both ways', () => {
    expect(shiftClock('23:30', 30)).toBe('00:00');
    expect(shiftClock('00:00', -30)).toBe('23:30');
    expect(shiftClock('00:10', -30)).toBe('23:40');
  });
});

describe('isClock', () => {
  test('takes HH:MM only', () => {
    expect(isClock('21:30')).toBe(true);
    expect(isClock('00:00')).toBe(true);
    expect(isClock('24:00')).toBe(false);
    expect(isClock('9:30')).toBe(false);
    expect(isClock('21:60')).toBe(false);
  });
});

describe('normalizeRules', () => {
  test('leaves valid rules as they are', () => {
    expect(normalizeRules(RULES, RULES)).toEqual(RULES);
  });

  test('pulls hours into range and replaces a bad quiet time with the fallback', () => {
    const bad: FamilyRules = {
      ...RULES,
      noSync: { on: true, hours: 100 },
      noSteps: { on: false, hour: 3 },
      quietStart: '25:00',
      quietEnd: '7:00',
    };
    const fixed = normalizeRules(bad, { quietStart: '22:00', quietEnd: '06:00' });
    expect(fixed.noSync).toEqual({ on: true, hours: 48 });
    expect(fixed.noSteps).toEqual({ on: false, hour: 9 });
    expect(fixed.quietStart).toBe('22:00');
    expect(fixed.quietEnd).toBe('06:00');
  });

  test('does not touch the switches', () => {
    const fixed = normalizeRules({ ...RULES, spo2: { on: true }, email: true, push: false }, RULES);
    expect(fixed.spo2.on).toBe(true);
    expect(fixed.email).toBe(true);
    expect(fixed.push).toBe(false);
  });
});

describe('quietText', () => {
  test('writes the hours with a dot', () => {
    expect(quietText(RULES)).toBe('21.30 sampai 06.30');
  });
});
