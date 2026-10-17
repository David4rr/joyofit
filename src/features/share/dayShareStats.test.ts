import { describe, expect, test } from 'bun:test';

import { buildDayShareStats, formatSleepShort } from '@/features/share/dayShareStats';
import type { Readiness } from '@/features/today/readiness';
import type { Recovery } from '@/features/today/recovery';
import type { SleepSummary } from '@/features/today/stats';
import type { DayStrain } from '@/features/today/strain';

const none: Readiness = { headline: null, signals: [], missing: [], recovery: null };
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
    expect(formatSleepShort(7 * 3600 + 5 * 60)).toBe('7h 05m');
    expect(formatSleepShort(42 * 60)).toBe('42m');
    expect(formatSleepShort(59.6 * 60)).toBe('1h 00m');
  });
});

describe('buildDayShareStats', () => {
  test('steps alone when nothing else is stored', () => {
    expect(buildDayShareStats({ steps: 0, sleep: null, readiness: none, strain: null })).toEqual([
      { key: 'steps', label: 'Steps', value: '0', unit: 'steps' },
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
    expect(stats[1].value).toBe('7h 00m');
    expect(stats[2]).toMatchObject({ value: '72', unit: '%' });
    expect(stats[3]).toMatchObject({ value: '12.4', unit: '/ 21' });
    expect(stats[4].value).toBe('Primed');
  });

  test('unstaged sleep counts in full', () => {
    const stats = buildDayShareStats({ steps: 1, sleep: sleep(6 * 3600), readiness: none, strain: null });
    expect(stats[1].value).toBe('6h 00m');
  });
});
