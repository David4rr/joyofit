import { describe, expect, it } from 'bun:test';

import { applyLocale } from '@/i18n';

import { sportLabel } from './sportLabel';
import { formatSpeed, workoutDistanceParts } from './summary';

describe('sportLabel', () => {
  it('translates the watch sport names', async () => {
    expect(sportLabel('Running')).toBe('Lari');
    expect(sportLabel('Swimming (Open water)')).toBe('Berenang (air terbuka)');
    await applyLocale('en');
    try {
      expect(sportLabel('Running')).toBe('Running');
      expect(sportLabel('Jumping Rope')).toBe('Jumping Rope');
    } finally {
      await applyLocale('id');
    }
  });

  it('keeps the maker of an imported workout and the type of an unknown one', () => {
    expect(sportLabel('Run (Garmin)')).toBe('Lari (Garmin)');
    expect(sportLabel('Workout (type 9)')).toBe('Latihan (tipe 9)');
  });

  it('shows a name nobody translated as stored', () => {
    expect(sportLabel('Quidditch')).toBe('Quidditch');
  });
});

describe('workout number formatting', () => {
  it('uses the language separators and unit words', async () => {
    expect(workoutDistanceParts(2340)).toEqual({ value: '2,34', unit: 'km' });
    expect(workoutDistanceParts(850)).toEqual({ value: '850', unit: 'm' });
    expect(formatSpeed(5.5)).toBe('19,8 km/j');
    await applyLocale('en');
    try {
      expect(workoutDistanceParts(2340)).toEqual({ value: '2.34', unit: 'km' });
      expect(formatSpeed(5.5)).toBe('19.8 km/h');
    } finally {
      await applyLocale('id');
    }
  });
});
