import { describe, expect, test } from 'bun:test';

import type { WorkoutRow } from '@/db/queries';
import { buildShareStats, effortKind, effortStat } from '@/features/share/shareStats';

function workout(over: Partial<WorkoutRow> = {}): WorkoutRow {
  return {
    id: 1,
    workoutNumber: 1,
    start: 1_760_000_000,
    end: 1_760_003_000,
    sportType: 1,
    sportName: 'Outdoor run',
    duration: 1800,
    distance: 5000,
    calories: 320,
    avgHr: 152,
    maxHr: 178,
    steps: 5400,
    complete: true,
    ...over,
  };
}

describe('effortKind', () => {
  test('picks the unit that fits the sport', () => {
    expect(effortKind('Pool swimming')).toBe('pace100m');
    expect(effortKind('Open water swim')).toBe('pace100m');
    expect(effortKind('Outdoor run')).toBe('paceKm');
    expect(effortKind('Indoor walking')).toBe('paceKm');
    expect(effortKind('Hiking')).toBe('paceKm');
    expect(effortKind('Outdoor cycling')).toBe('speed');
    expect(effortKind('Rowing machine')).toBe('speed');
  });
});

describe('effortStat', () => {
  test('uses the watch pace for running and formats it as m:ss', () => {
    expect(effortStat(workout(), { avgPaceSecPerKm: 332 })).toEqual({
      key: 'pace',
      label: 'Avg pace',
      value: '5:32',
      unit: '/km',
    });
  });

  test('derives the pace from distance and active time when the summary has none', () => {
    // 1800 s over 5 km is 360 s per km.
    expect(effortStat(workout(), {})?.value).toBe('6:00');
  });

  test('swimming is per 100 m, from the watch figure or derived', () => {
    expect(effortStat(workout({ sportName: 'Pool swimming' }), { avgPaceSecPer100m: 105 })).toMatchObject({
      value: '1:45',
      unit: '/100 m',
    });
    // 600 s over 500 m is 120 s per 100 m.
    expect(effortStat(workout({ sportName: 'Pool swimming', distance: 500, duration: 600 }), {})?.value).toBe('2:00');
  });

  test('cycling is km/h, from avgSpeed in m/s or derived', () => {
    const ride = workout({ sportName: 'Outdoor cycling', distance: 20_000, duration: 3600 });
    expect(effortStat(ride, { avgSpeed: 6 })).toMatchObject({ key: 'speed', value: '21.6', unit: 'km/h' });
    expect(effortStat(ride, {})?.value).toBe('20.0');
  });

  test('no figure when there is nothing to average over', () => {
    expect(effortStat(workout({ distance: 0 }), {})).toBeNull();
    expect(effortStat(workout({ distance: 40 }), {})).toBeNull();
    expect(effortStat(workout({ sportName: 'Outdoor cycling', distance: 0 }), {})).toBeNull();
  });

  test('drops an absurd pace', () => {
    expect(effortStat(workout(), { avgPaceSecPerKm: 5000 })).toBeNull();
  });
});

describe('buildShareStats', () => {
  test('a GPS run leads with distance and keeps the display order', () => {
    const stats = buildShareStats(workout(), { avgPaceSecPerKm: 332, elevationGain: 48.6 });
    expect(stats.map((s) => s.key)).toEqual(['distance', 'time', 'pace', 'hr', 'calories', 'elevation']);
    expect(stats[0]).toEqual({ key: 'distance', label: 'Distance', value: '5.00', unit: 'km' });
    expect(stats[1].value).toBe('30:00');
    expect(stats[3]).toMatchObject({ value: '152', unit: 'bpm' });
    expect(stats[5]).toMatchObject({ value: '49', unit: 'm' });
  });

  test('short distances stay in metres', () => {
    expect(buildShareStats(workout({ distance: 400 }), {})[0]).toMatchObject({ value: '400', unit: 'm' });
  });

  test('an indoor workout without distance leads with time and hides what it lacks', () => {
    const stats = buildShareStats(
      workout({ sportName: 'Strength training', distance: 0, avgHr: null, calories: 0, steps: 0 }),
      {},
    );
    expect(stats.map((s) => s.key)).toEqual(['time']);
  });

  test('keeps calories and heart rate for an indoor workout', () => {
    const stats = buildShareStats(workout({ sportName: 'Yoga', distance: 0 }), {});
    expect(stats.map((s) => s.key)).toEqual(['time', 'hr', 'calories']);
  });

  test('flat or missing elevation is left out', () => {
    expect(buildShareStats(workout(), { elevationGain: 0 }).some((s) => s.key === 'elevation')).toBe(false);
    expect(buildShareStats(workout(), {}).some((s) => s.key === 'elevation')).toBe(false);
  });
});
