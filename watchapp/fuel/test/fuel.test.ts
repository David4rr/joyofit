import { describe, expect, it } from 'bun:test';

import {
  KCAL_PER_G_CARB,
  KCAL_PER_G_FAT,
  MAX_GAP_MS,
  REST_KCAL_PER_MIN,
  ZONE_LABELS,
  fatShare,
  kcalPerMinute,
  maxHeartRate,
  zoneOf,
} from '../entry/src/main/js/default/common/fuel.js';
import * as substrate from '../../../src/features/workouts/substrate';

/**
 * Vectors are the Kotlin formulas of modules/huawei-wear/.../LiveWorkoutCodec.kt evaluated by an independent port
 * (Python, same operation order), written out here to the digits that matter.
 *
 * HeartRateEnergy.kcalPerMinute(hr, weightKg, age, sex), kJ/min / 4.184:
 *   male   = (-55.0969 + 0.6309 hr + 0.1988 kg + 0.2017 age) / 4.184
 *   female = (-20.4022 + 0.4472 hr - 0.1263 kg + 0.0740 age) / 4.184
 *   hr 110, 70 kg, 35 y, male: (-55.0969 + 69.3990 + 13.9160 + 7.0595) / 4.184 = 35.2776 / 4.184 = 8.431549
 *   hr 110, 70 kg, 35 y, female: (-20.4022 + 49.1920 - 8.8410 + 2.5900) / 4.184 = 22.5388 / 4.184 = 5.386902
 *   unknown = (male + female) / 2 = 6.909226
 * SubstrateEstimator.fatShare(110, 185): %HRmax = 59.4595, %VO2max = (59.4595 - 37) / 0.64 = 35.0929,
 *   RER = 0.78 + (0.83 - 0.78) (35.0929 - 25) / 20 = 0.805232, fat = (1 - 0.805232) / 0.3 = 0.649226.
 */
describe('kcalPerMinute (HeartRateEnergy.kcalPerMinute)', () => {
  it('matches the Keytel equations for male, female and unknown', () => {
    expect(kcalPerMinute(110, 70, 35, 'male')).toBeCloseTo(8.431548757170173, 12);
    expect(kcalPerMinute(110, 70, 35, 'female')).toBeCloseTo(5.386902485659655, 12);
    expect(kcalPerMinute(110, 70, 35, 'unknown')).toBeCloseTo(6.9092256214149135, 12);
    expect(kcalPerMinute(150, 70, 35, 'male')).toBeCloseTo(14.463097514340346, 12);
    expect(kcalPerMinute(185, 70, 35, 'male')).toBeCloseTo(19.740702676864245, 12);
    expect(kcalPerMinute(150, 60, 30, 'female')).toBeCloseTo(9.875669216061185, 12);
    expect(kcalPerMinute(200, 70, 35, 'unknown')).toBeCloseTo(18.504469407265773, 12);
  });

  it('treats any sex other than male or female as the mean of both', () => {
    const mean = (kcalPerMinute(130, 80, 40, 'male') + kcalPerMinute(130, 80, 40, 'female')) / 2;
    expect(kcalPerMinute(130, 80, 40, 'unknown')).toBeCloseTo(mean, 12);
    expect(kcalPerMinute(130, 80, 40, '')).toBeCloseTo(mean, 12);
  });

  it('never goes under the resting 1.2 kcal per minute', () => {
    // hr 60, 70 kg, 35 y, male: (-55.0969 + 37.854 + 13.916 + 7.0595) / 4.184 = 3.7326 / 4.184 = 0.892 -> floored
    expect(kcalPerMinute(60, 70, 35, 'male')).toBe(REST_KCAL_PER_MIN);
    expect(kcalPerMinute(60, 70, 35, 'female')).toBe(REST_KCAL_PER_MIN);
    expect(REST_KCAL_PER_MIN).toBe(1.2);
  });
});

describe('fatShare (SubstrateEstimator.fatShare)', () => {
  it('matches the RER curve at the points that matter', () => {
    // max 185: 40 and 60 bpm are clamped at %VO2max 25 (RER 0.78 -> 0.73333), 200 bpm at 100 (RER 1.0 -> 0).
    expect(fatShare(40, 185)).toBeCloseTo(0.7333333333333333, 12);
    expect(fatShare(60, 185)).toBeCloseTo(0.7333333333333333, 12);
    expect(fatShare(110, 185)).toBeCloseTo(0.6492257882882884, 12);
    expect(fatShare(150, 185)).toBeCloseTo(0.35477195945945933, 12);
    expect(fatShare(165, 185)).toBeCloseTo(0.2069679054054056, 12);
    expect(fatShare(185, 185)).toBeCloseTo(0.017361111111111237, 12);
    expect(fatShare(200, 185)).toBe(0);
    expect(fatShare(120, 190)).toBeCloseTo(0.6010690789473687, 12);
  });

  it('falls as effort rises', () => {
    let last = 1;
    for (let hr = 60; hr <= 200; hr += 10) {
      const f = fatShare(hr, 185);
      expect(f).toBeLessThanOrEqual(last);
      last = f;
    }
  });
});

describe('maxHeartRate and zones', () => {
  it('is 220 - age between 120 and 220', () => {
    expect(maxHeartRate(35)).toBe(185);
    expect(maxHeartRate(34)).toBe(186);
    expect(maxHeartRate(10)).toBe(210);
    expect(maxHeartRate(0)).toBe(220);
    expect(maxHeartRate(-5)).toBe(220);
    expect(maxHeartRate(100)).toBe(120);
    expect(maxHeartRate(120)).toBe(120);
  });

  it('puts a reading in Huawei zone 0..5 by share of maximum', () => {
    expect(zoneOf(90, 185)).toBe(0); // 48.6 %
    expect(zoneOf(93, 185)).toBe(1); // 50.3 %
    expect(zoneOf(110, 185)).toBe(1); // 59.5 %
    expect(zoneOf(120, 185)).toBe(2); // 64.9 %
    expect(zoneOf(150, 185)).toBe(4); // 81.1 %
    expect(zoneOf(185, 185)).toBe(5);
    expect(zoneOf(230, 185)).toBe(5);
    expect(ZONE_LABELS.length).toBe(6);
  });
});

describe('same numbers as src/features/workouts/substrate.ts', () => {
  it('shares its constants', () => {
    expect(KCAL_PER_G_FAT).toBe(substrate.KCAL_PER_G_FAT);
    expect(KCAL_PER_G_CARB).toBe(substrate.KCAL_PER_G_CARB);
    expect(MAX_GAP_MS / 1000).toBe(120); // substrate.ts MAX_GAP_SEC is private; the contract says 2 minutes
  });

  it('agrees on maximum heart rate, fat share and zones for every age and heart rate', () => {
    for (let age = 0; age <= 110; age += 5) {
      expect(maxHeartRate(age)).toBe(substrate.maxHeartRate(age));
    }
    for (const max of [120, 150, 175, 185, 190, 200, 220]) {
      for (let hr = 30; hr <= 240; hr++) {
        expect(fatShare(hr, max)).toBeCloseTo(substrate.fatShare(hr, max), 12);
        expect(zoneOf(hr, max)).toBe(substrate.zoneOf(hr, max));
      }
    }
  });
});
