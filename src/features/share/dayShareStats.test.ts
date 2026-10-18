import { afterEach, describe, expect, test } from 'bun:test';

import { buildDayShareStats, formatSleepShort } from '@/features/share/dayShareStats';
import type { Readiness } from '@/features/today/readiness';
import type { Recovery } from '@/features/today/recovery';
import type { SleepSummary } from '@/features/today/stats';
import type { DayStrain } from '@/features/today/strain';
import { applyLocale } from '@/i18n';

afterEach(() => applyLocale('id'));

const none: Readiness = { headline: null, signals: [], missing: [], recovery: null, hrvNote: null };
const recovery = { percent: 72, band: 'green' } as Recovery;
const strain = { day: 0, trimp: 100, strain: 12.44, zoneMinutes: [] } as unknown as DayStrain;

function sleep(totalSeconds: number, awakeSeconds?: number): SleepSummary {
  return {
    start: 0,
    end: totalSeconds,
    totalSeconds,
    byType: [],
    byStage: awakeSeconds === undefined ? [] : [{ stage: 'awake', count: 1, seconds: awakeSeconds }],
  };
}

describe('formatSleepShort', () => {
  test('hours and zero-padded minutes, or minutes alone', () => {
    expect(formatSleepShort(7 * 3600 + 5 * 60)).toBe('7j 05mnt');
    expect(formatSleepShort(42 * 60)).toBe('42mnt');
    expect(formatSleepShort(59.6 * 60)).toBe('1j 00mnt');
  });
});

describe('buildDayShareStats', () => {
  test('steps alone when nothing else is stored', () => {
    expect(buildDayShareStats({ steps: 0, sleep: null, readiness: none, strain: null })).toEqual([
      { key: 'steps', label: 'Langkah', value: '0', unit: 'langkah' },
    ]);
  });

  test('full day in display order', () => {
    const stats = buildDayShareStats({
      steps: 8432,
      sleep: sleep(8 * 3600, 3600),
      readiness: { ...none, headline: 'Primed', recovery },
      strain,
    });
    expect(stats.map((s) => s.key)).toEqual(['steps', 'sleep', 'recovery', 'strain', 'readiness']);
    expect(stats[1].value).toBe('7j 00mnt');
    expect(stats[2]).toMatchObject({ value: '72', unit: '%' });
    expect(stats[3]).toMatchObject({ value: '12,4', unit: '/ 21' });
    expect(stats[4].value).toBe('Primed');
  });

  test('unstaged sleep counts in full', () => {
    const stats = buildDayShareStats({ steps: 1, sleep: sleep(6 * 3600), readiness: none, strain: null });
    expect(stats[1].value).toBe('6j 00mnt');
  });
});

describe('day share text in English', () => {
  test('labels, units and the short sleep format switch language', async () => {
    await applyLocale('en');
    expect(formatSleepShort(7 * 3600 + 5 * 60)).toBe('7h 05m');
    expect(formatSleepShort(42 * 60)).toBe('42m');
    expect(buildDayShareStats({ steps: 1234, sleep: null, readiness: none, strain })).toEqual([
      { key: 'steps', label: 'Steps', value: '1,234', unit: 'steps' },
      { key: 'strain', label: 'Strain', value: '12.4', unit: '/ 21' },
    ]);
  });
});
