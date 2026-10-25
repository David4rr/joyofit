import { describe, expect, it } from 'bun:test';

import type { JsonObject } from '../subject';
import {
  applyCustomMetrics,
  getAvailableMetrics,
  getDefaultMetrics,
  getHeroField,
  MAX_CUSTOM_METRICS,
} from './customMetrics';

describe('customMetrics', () => {
  const sampleRun: JsonObject = {
    sport: 'Lari',
    category: 'run',
    startedAt: 1729814400000,
    distanceM: 5240,
    movingSec: 1800,
    paceSecKm: 343,
    hrAvg: 155,
    hrMax: 178,
    kcal: 410,
    elevGainM: 45,
    cadence: 174,
    steps: 5120,
    route: [[-6.2, 106.8]],
    hrSeries: [140, 150, 160],
  };

  describe('getHeroField', () => {
    it('identifies distance as hero for distance sports', () => {
      expect(getHeroField(sampleRun, 'run')).toBe('distanceM');
      expect(getHeroField(sampleRun, 'walk')).toBe('distanceM');
      expect(getHeroField(sampleRun, 'ride')).toBe('distanceM');
      expect(getHeroField(sampleRun, 'swim')).toBe('distanceM');
    });

    it('falls back to steps or time for walk when distance is absent', () => {
      expect(getHeroField({ steps: 4000, movingSec: 1200 }, 'walk')).toBe('steps');
      expect(getHeroField({ movingSec: 1200 }, 'walk')).toBe('movingSec');
    });

    it('identifies volume for gym, falling back to movingSec', () => {
      expect(getHeroField({ volumeKg: 5000, movingSec: 3600 }, 'gym')).toBe('volumeKg');
      expect(getHeroField({ movingSec: 3600 }, 'gym')).toBe('movingSec');
    });

    it('identifies jumps for cardio, falling back to movingSec', () => {
      expect(getHeroField({ jumps: 1200, movingSec: 900 }, 'cardio')).toBe('jumps');
      expect(getHeroField({ movingSec: 900 }, 'cardio')).toBe('movingSec');
    });

    it('identifies movingSec for flow and court', () => {
      expect(getHeroField({ movingSec: 2400 }, 'flow')).toBe('movingSec');
      expect(getHeroField({ movingSec: 3600 }, 'court')).toBe('movingSec');
    });
  });

  describe('getAvailableMetrics', () => {
    it('returns only recorded metrics, omitting the hero', () => {
      const available = getAvailableMetrics(sampleRun, 'run');
      const ids = available.map((m) => m.id);

      // distance is hero, so it is omitted from secondary metrics
      expect(ids).not.toContain('distance');
      expect(ids).toContain('time');
      expect(ids).toContain('pace');
      expect(ids).toContain('hr');
      expect(ids).toContain('kcal');
      expect(ids).toContain('elevation');
      expect(ids).toContain('cadence');
      expect(ids).toContain('steps');

      // Unrecorded swim/gym metrics should not be available
      expect(ids).not.toContain('swolf');
      expect(ids).not.toContain('volume');
      expect(ids).not.toContain('jumps');
    });

    it('handles empty or zero-value run safely', () => {
      expect(getAvailableMetrics({}, 'run')).toEqual([]);
      expect(getAvailableMetrics({ movingSec: 0, distanceM: -5, hrAvg: 0 }, 'run')).toEqual([]);
    });
  });

  describe('getDefaultMetrics', () => {
    it('picks top 4 defaults for run following priority', () => {
      const defaults = getDefaultMetrics(sampleRun, 'run');
      expect(defaults).toEqual(['time', 'pace', 'hr', 'kcal']);
      expect(defaults.length).toBeLessThanOrEqual(MAX_CUSTOM_METRICS);
    });

    it('adapts when high-priority metrics are absent', () => {
      const noHrRun = { ...sampleRun, hrAvg: undefined, hrMax: undefined };
      const defaults = getDefaultMetrics(noHrRun, 'run');
      expect(defaults).toEqual(['time', 'pace', 'kcal', 'elevation']);
    });

    it('respects sport category defaults (ride, swim, gym, flow)', () => {
      const rideRun: JsonObject = { distanceM: 25000, movingSec: 3600, speedKmh: 25.4, elevGainM: 150, cadence: 85, hrAvg: 140 };
      expect(getDefaultMetrics(rideRun, 'ride')).toEqual(['time', 'speed', 'elevation', 'cadence']);

      const swimRun: JsonObject = { distanceM: 1500, movingSec: 2100, pace100Sec: 140, laps: 30, swolf: 38, hrAvg: 135 };
      expect(getDefaultMetrics(swimRun, 'swim')).toEqual(['time', 'pace', 'laps', 'swolf']);

      const gymRun: JsonObject = { volumeKg: 3500, movingSec: 3000, sets: 18, reps: 150, kcal: 280, hrAvg: 125 };
      expect(getDefaultMetrics(gymRun, 'gym')).toEqual(['time', 'sets', 'reps', 'kcal']);

      const flowRun: JsonObject = { movingSec: 2400, kcal: 120, hrAvg: 95 };
      expect(getDefaultMetrics(flowRun, 'flow')).toEqual(['kcal', 'hr']);
    });
  });

  describe('applyCustomMetrics', () => {
    it('strips unselected metrics while keeping selected and hero intact', () => {
      const data: JsonObject = { run: sampleRun };
      const customized = applyCustomMetrics(data, ['time', 'kcal']);
      const run = customized.run as JsonObject;

      // Selected metrics are kept
      expect(run.movingSec).toBe(1800);
      expect(run.kcal).toBe(410);

      // Hero distance is kept even though not explicitly in selectedIds
      expect(run.distanceM).toBe(5240);

      // Unselected metrics are deleted
      expect(run.hrAvg).toBeUndefined();
      expect(run.paceSecKm).toBeUndefined();
      expect(run.cadence).toBeUndefined();
      expect(run.steps).toBeUndefined();
      expect(run.elevGainM).toBeUndefined();

      // Structural and art properties are preserved
      expect(run.sport).toBe('Lari');
      expect(run.startedAt).toBe(1729814400000);
      expect(run.route).toEqual([[-6.2, 106.8]]);
      expect(run.hrSeries).toEqual([140, 150, 160]);
    });

    it('caps selection to MAX_CUSTOM_METRICS', () => {
      const data: JsonObject = { run: sampleRun };
      const customized = applyCustomMetrics(data, ['time', 'pace', 'hr', 'kcal', 'cadence', 'steps']);
      const run = customized.run as JsonObject;

      // First 4 are kept
      expect(run.movingSec).toBe(1800);
      expect(run.paceSecKm).toBe(343);
      expect(run.hrAvg).toBe(155);
      expect(run.kcal).toBe(410);

      // 5th and 6th are deleted
      expect(run.cadence).toBeUndefined();
      expect(run.steps).toBeUndefined();
    });

    it('returns data safely when data.run is absent', () => {
      const data: JsonObject = { sleep: { score: 85 } };
      expect(applyCustomMetrics(data, ['time'])).toEqual(data);
    });
  });
});
