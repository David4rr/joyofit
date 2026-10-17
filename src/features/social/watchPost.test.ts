import { describe, expect, test } from 'bun:test';

import type { WorkoutPointRow, WorkoutRow } from '@/db/queries';
import { hrChartProps, routeViewPoints } from '@/features/social/detailAdapter';
import { buildWatchPost, canShareToRogo, hrSeries, routePairs } from '@/features/social/watchPost';

const START = 1_760_000_000;

function workout(over: Partial<WorkoutRow> = {}): WorkoutRow {
  return {
    id: 1,
    workoutNumber: 1,
    start: START,
    end: START + 1800,
    sportType: 1,
    sportName: 'Outdoor run',
    duration: 1750,
    distance: 5012.4,
    calories: 320.6,
    avgHr: 152,
    maxHr: 178,
    steps: 5400,
    complete: true,
    imported: false,
    ...over,
  };
}

/** One heart-rate reading per second, `bpm` constant. */
function hrPoints(seconds: number, bpm = 140): WorkoutPointRow[] {
  return Array.from({ length: seconds }, (_, i) => ({ ts: START + i, lat: null, lon: null, alt: null, hr: bpm }));
}

function fixes(n: number): WorkoutPointRow[] {
  return Array.from({ length: n }, (_, i) => ({ ts: START + i, lat: -6.2 + i * 1e-5, lon: 106.8 + i * 1e-5, alt: null, hr: null }));
}

describe('canShareToRogo', () => {
  test('a complete watch workout can be shared', () => {
    expect(canShareToRogo(workout())).toBe(true);
  });

  test('imported rows (Huawei export or FIT file, possibly from Strava) cannot', () => {
    expect(canShareToRogo(workout({ imported: true }))).toBe(false);
  });

  test('a partly downloaded workout, or one that is empty or longer than a day, cannot', () => {
    expect(canShareToRogo(workout({ complete: false }))).toBe(false);
    expect(canShareToRogo(workout({ duration: 0 }))).toBe(false);
    expect(canShareToRogo(workout({ duration: 1440 * 60 }))).toBe(true);
    expect(canShareToRogo(workout({ duration: 1440 * 60 + 1 }))).toBe(false);
  });
});

describe('hrSeries', () => {
  test('keeps one reading per second up to 600 seconds', () => {
    const series = hrSeries(hrPoints(600), START, START + 600);
    expect(series?.intervalSec).toBe(1);
    expect(series?.bpm).toHaveLength(600);
  });

  test('one second more doubles the interval so the series stays within 600 readings', () => {
    const series = hrSeries(hrPoints(601), START, START + 601);
    expect(series?.intervalSec).toBe(2);
    expect(series?.bpm).toHaveLength(301);
  });

  test('a long workout never exceeds 600 readings and the interval fits the server limit', () => {
    const series = hrSeries(hrPoints(86_400 / 8), START, START + 86_400);
    expect(series?.bpm.length).toBeLessThanOrEqual(600);
    expect(series?.intervalSec).toBe(144);
  });

  test('averages the readings of one bucket and leaves a gap null', () => {
    const points: WorkoutPointRow[] = [
      { ts: START, lat: null, lon: null, alt: null, hr: 100 },
      { ts: START + 1, lat: null, lon: null, alt: null, hr: 111 },
      { ts: START + 7, lat: null, lon: null, alt: null, hr: 150 },
    ];
    const expected = Array<number | null>(600).fill(null);
    expected[0] = 106;
    expected[3] = 150;
    expect(hrSeries(points, START, START + 1200)).toEqual({ intervalSec: 2, bpm: expected });
  });

  test('readings outside 20 to 250 are dropped, and a workout with none gives null', () => {
    expect(hrSeries(hrPoints(60, 0), START, START + 60)).toBeNull();
    expect(hrSeries([], START, START + 60)).toBeNull();
  });
});

describe('routePairs', () => {
  test('keeps a short route as it is', () => {
    expect(routePairs(fixes(3))).toHaveLength(3);
  });

  test('downsamples to 1000 pairs keeping the first and the last fix', () => {
    const route = routePairs(fixes(5000));
    expect(route).toHaveLength(1000);
    expect(route?.[0]).toEqual([-6.2, 106.8]);
    expect(route?.[999]?.[0]).toBeCloseTo(-6.2 + 4999 * 1e-5, 9);
  });

  test('drops fixes outside the globe and needs two valid ones', () => {
    const bad: WorkoutPointRow[] = [{ ts: START, lat: 91, lon: 0, alt: null, hr: null }, ...fixes(1)];
    expect(routePairs(bad)).toBeNull();
    expect(routePairs([])).toBeNull();
  });
});

describe('buildWatchPost', () => {
  const options = { caption: '  Morning run  ', visibility: 'grup' as const, includeHr: true, includeRoute: true };

  test('maps the row to the server units and omits nothing it has', () => {
    const post = buildWatchPost(workout(), [...hrPoints(60), ...fixes(10)], options);
    expect(post.workout).toEqual({
      sportName: 'Outdoor run',
      startedAt: START * 1000,
      durationMin: 29,
      kcal: 321,
      distanceM: 5012,
      avgHr: 152,
      maxHr: 178,
    });
    expect(post.caption).toBe('Morning run');
    expect(post.visibility).toBe('grup');
    expect(post.detail?.hr?.bpm.length).toBeGreaterThan(0);
    expect(post.detail?.route).toHaveLength(10);
  });

  test('zero calories and distance and an absurd heart rate become null, a blank caption is left out', () => {
    const post = buildWatchPost(workout({ calories: 0, distance: 0, avgHr: 12, maxHr: null, duration: 20 }), [], {
      ...options,
      caption: '   ',
    });
    expect(post.workout).toMatchObject({ kcal: null, distanceM: null, avgHr: null, maxHr: null, durationMin: 1 });
    expect('caption' in post).toBe(false);
  });

  test('sends no detail when it is switched off or the workout has none', () => {
    expect(buildWatchPost(workout(), [...hrPoints(60), ...fixes(10)], { ...options, includeHr: false, includeRoute: false }).detail).toBeUndefined();
    expect(buildWatchPost(workout(), [], options).detail).toBeUndefined();
  });

  test('a long sport name is cut to the server limit', () => {
    expect(buildWatchPost(workout({ sportName: 'x'.repeat(80) }), [], options).workout.sportName).toHaveLength(60);
  });
});

describe('detail adapter', () => {
  test('hrChartProps places readings intervalSec apart and skips gaps', () => {
    expect(hrChartProps({ intervalSec: 5, bpm: [100, null, 120] }, START)).toEqual({
      points: [
        { ts: START, lat: null, lon: null, alt: null, hr: 100 },
        { ts: START + 10, lat: null, lon: null, alt: null, hr: 120 },
      ],
      start: START,
      end: START + 15,
    });
  });

  test('routeViewPoints names the pair members', () => {
    expect(routeViewPoints([[1, 2], [3, 4]])).toEqual([{ lat: 1, lon: 2 }, { lat: 3, lon: 4 }]);
  });
});
