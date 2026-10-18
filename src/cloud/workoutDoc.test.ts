import { describe, expect, it } from 'bun:test';
import { gunzipSync, strFromU8 } from 'fflate';

import type { WorkoutPointRow, WorkoutRow } from '@/db/queries';
import type { WorkoutAnalysis } from '@/features/workouts/analysis/types';

import {
  buildWorkoutDoc,
  decodePoints,
  encodePoints,
  gzipDoc,
  parseWorkoutDoc,
  readWorkoutDoc,
  type WatchPoint,
} from './workoutDoc';

const START = 1_792_058_016;

const point = (i: number, over: Partial<WatchPoint> = {}): WatchPoint => ({
  ts: START + i,
  lat: -6.2 + i * 0.00001,
  lon: 106.8 + i * 0.00002,
  alt: 10 + i * 0.05,
  hr: 120 + (i % 30),
  speed: 2.5 + (i % 7) * 0.01,
  cadence: 80 + (i % 5),
  stride: 0.95,
  power: 150 + (i % 20),
  ...over,
});

const NONE: Omit<WatchPoint, 'ts'> = { lat: null, lon: null, alt: null, hr: null, speed: null, cadence: null, stride: null, power: null };

const workout: WorkoutRow = {
  id: 7,
  workoutNumber: 3,
  start: START,
  end: START + 3600,
  sportType: 1,
  sportName: 'Running',
  duration: 3500,
  distance: 10_250,
  calories: 640,
  avgHr: 148,
  maxHr: 176,
  steps: 9100,
  complete: true,
  imported: false,
};

describe('encodePoints / decodePoints', () => {
  it('round-trips every column, within the stored precision', () => {
    const points = Array.from({ length: 200 }, (_, i) => point(i));
    const columns = encodePoints(points);
    expect(columns?.n).toBe(200);
    const back = decodePoints(columns);
    expect(back).toHaveLength(200);
    back.forEach((p, i) => {
      const o = points[i];
      expect(p.ts).toBe(o.ts);
      expect(p.lat).toBeCloseTo(o.lat as number, 7);
      expect(p.lon).toBeCloseTo(o.lon as number, 7);
      expect(p.alt).toBeCloseTo(o.alt as number, 2);
      expect(p.hr).toBe(o.hr);
      expect(p.speed).toBeCloseTo(o.speed as number, 3);
      expect(p.cadence).toBe(o.cadence);
      expect(p.stride).toBeCloseTo(o.stride as number, 3);
      expect(p.power).toBe(o.power);
    });
  });

  it('keeps gaps: a null entry stays null and does not move the difference base', () => {
    const points = [
      point(0),
      point(1, { lat: null, lon: null, alt: null, hr: null }),
      point(2, { lat: -6.19, lon: 106.81 }),
      point(3, { ...NONE }),
    ];
    const columns = encodePoints(points);
    expect(columns?.lat?.[1]).toBeNull();
    const back = decodePoints(columns);
    expect(back[1]).toMatchObject({ lat: null, lon: null, alt: null, hr: null });
    expect(back[2].lat).toBeCloseTo(-6.19, 7);
    expect(back[2].lon).toBeCloseTo(106.81, 7);
    expect(back[3]).toEqual({ ts: START + 3, ...NONE });
  });

  it('writes a column nobody filled as null, and no points as null columns', () => {
    const columns = encodePoints([point(0, { power: null, stride: null }), point(1, { power: null, stride: null })]);
    expect(columns?.power).toBeNull();
    expect(columns?.stride).toBeNull();
    expect(decodePoints(columns).every((p) => p.power === null && p.stride === null)).toBe(true);
    expect(encodePoints([])).toBeNull();
    expect(decodePoints(null)).toEqual([]);
  });

  it('keeps points that share a second', () => {
    const back = decodePoints(encodePoints([point(0), point(0, { hr: 99 }), point(1)]));
    expect(back.map((p) => p.ts)).toEqual([START, START, START + 1]);
    expect(back[1].hr).toBe(99);
  });
});

describe('workout document', () => {
  const analysis = { startedAt: START * 1000, sport: { kind: 'run', name: 'Running' }, stats: { avgHr: 148 } } as unknown as WorkoutAnalysis;
  const rows: WorkoutPointRow[] = Array.from({ length: 120 }, (_, i) => {
    const { ts, ...rest } = point(i);
    return { ts, ...rest };
  });
  const build = () => buildWorkoutDoc({ workout, summaryJson: '{"kind":"RUNNING","laps":[1,2]}', points: rows, analysis, engineRev: 2 });

  it('carries the workout row without its local id, rev and points', () => {
    const doc = build();
    expect(doc.v).toBe(1);
    expect(doc.engineRev).toBe(2);
    expect(doc.workout).toEqual({
      workoutNumber: 3,
      start: START,
      end: START + 3600,
      sportType: 1,
      sportName: 'Running',
      duration: 3500,
      distance: 10_250,
      calories: 640,
      avgHr: 148,
      maxHr: 176,
      steps: 9100,
      complete: true,
      imported: false,
      summaryJson: '{"kind":"RUNNING","laps":[1,2]}',
    });
    expect(doc.points?.n).toBe(120);
  });

  it('survives gzip and a read: same workout, same points, same analysis', () => {
    const doc = build();
    const back = readWorkoutDoc(gzipDoc(doc));
    expect(back).toEqual(JSON.parse(JSON.stringify(doc)));
    expect(back.analysis).toEqual(analysis);
    expect(decodePoints(back.points)).toHaveLength(120);
  });

  it('compresses smaller than the JSON and to the same bytes every time (no clock in the header)', () => {
    const doc = build();
    const first = gzipDoc(doc);
    expect(gzipDoc(doc)).toEqual(first);
    expect(first.byteLength).toBeLessThan(JSON.stringify(doc).length);
    expect(strFromU8(gunzipSync(first))).toBe(JSON.stringify(doc));
  });

  it('keeps a workout without points, a null heart rate and an incomplete flag', () => {
    const doc = buildWorkoutDoc({
      workout: { ...workout, avgHr: null, maxHr: null, complete: false, imported: true },
      summaryJson: '{}',
      points: [],
      analysis,
      engineRev: 2,
    });
    const back = readWorkoutDoc(gzipDoc(doc));
    expect(back.points).toBeNull();
    expect(back.workout).toMatchObject({ avgHr: null, maxHr: null, complete: false, imported: true });
  });
});

describe('parseWorkoutDoc', () => {
  const good = () => JSON.parse(JSON.stringify(buildWorkoutDoc({ workout, summaryJson: '{}', points: [], analysis: {} as WorkoutAnalysis, engineRev: 1 })));

  it('accepts what the phone builds', () => {
    expect(parseWorkoutDoc(good()).workout.start).toBe(START);
  });

  it('refuses a document it cannot store', () => {
    expect(() => parseWorkoutDoc(null)).toThrow();
    expect(() => parseWorkoutDoc({ ...good(), v: 2 })).toThrow('version');
    expect(() => parseWorkoutDoc({ ...good(), engineRev: -1 })).toThrow('engineRev');
    expect(() => parseWorkoutDoc({ ...good(), workout: { ...good().workout, start: 1.5 } })).toThrow('workout.start');
    expect(() => parseWorkoutDoc({ ...good(), workout: { ...good().workout, sportName: '' } })).toThrow('sportName');
    expect(() => parseWorkoutDoc({ ...good(), analysis: 5 })).toThrow('analysis');
  });

  it('refuses point columns whose length is not n', () => {
    const columns = encodePoints([point(0), point(1)]);
    expect(() => parseWorkoutDoc({ ...good(), points: { ...columns, hr: [100] } })).toThrow('points.hr');
    expect(() => parseWorkoutDoc({ ...good(), points: { ...columns, dts: [0] } })).toThrow('points.dts');
    expect(parseWorkoutDoc({ ...good(), points: columns }).points?.n).toBe(2);
  });

  it('refuses bytes that are not a gzip JSON document', () => {
    expect(() => readWorkoutDoc(new Uint8Array([1, 2, 3]))).toThrow('gzip');
  });
});
