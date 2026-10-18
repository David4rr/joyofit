import { describe, expect, it } from 'bun:test';

import { applyLocale } from '@/i18n';
import { aerobicEffectFromTrimp, effectWord, plausibleEffect, trainingEffect } from './trainingEffect';

describe('plausibleEffect', () => {
  it('accepts 0..5 only', () => {
    expect(plausibleEffect(0)).toBe(0);
    expect(plausibleEffect(5)).toBe(5);
    expect(plausibleEffect(5.1)).toBeNull();
    expect(plausibleEffect(-0.1)).toBeNull();
    expect(plausibleEffect(undefined)).toBeNull();
  });
});

describe('aerobicEffectFromTrimp', () => {
  it('follows 5 x (1 - e^(-TRIMP/150)), one decimal', () => {
    expect(aerobicEffectFromTrimp(0)).toBe(0);
    expect(aerobicEffectFromTrimp(-5)).toBe(0);
    expect(aerobicEffectFromTrimp(120)).toBe(2.8);
    expect(aerobicEffectFromTrimp(480)).toBe(4.8);
    expect(aerobicEffectFromTrimp(1e6)).toBe(5);
  });
});

describe('trainingEffect', () => {
  it('shows the watch values as the watch', () => {
    const t = trainingEffect({ aerobicEffect: 3.4, anaerobicEffect: 1.2, trainingPoints: 250, workoutLoad: 77 }, 200);
    expect(t.aerobic).toEqual({ value: 3.4, source: 'watch' });
    expect(t.anaerobic).toEqual({ value: 1.2, source: 'watch' });
    expect(t.points).toBe(250);
    expect(t.load).toBe(77);
  });
  it('estimates only the aerobic effect when the watch gave none', () => {
    const t = trainingEffect({}, 120);
    expect(t.aerobic).toEqual({ value: 2.8, source: 'estimate' });
    expect(t.anaerobic).toBeNull();
    expect(t.points).toBeNull();
  });
  it('has nothing without watch values or heart rate, and drops the unsent -1 points', () => {
    const t = trainingEffect({ trainingPoints: -1, workoutLoad: 0, aerobicEffect: 9 }, null);
    expect(t).toEqual({ aerobic: null, anaerobic: null, points: null, load: null });
    expect(trainingEffect({}, 0).aerobic).toBeNull();
  });
});

describe('effectWord', () => {
  it('speaks English when asked', async () => {
    await applyLocale('en');
    try {
      expect([0.5, 3, 5].map(effectWord)).toEqual(['Barely any', 'Improving', 'Too much']);
    } finally {
      await applyLocale('id');
    }
  });
  it('has a band per whole step', () => {
    expect([0.5, 1, 2, 3, 4, 5].map(effectWord)).toEqual(['Hampir tidak ada', 'Ringan', 'Menjaga kebugaran', 'Meningkatkan', 'Sangat meningkatkan', 'Sangat berat']);
  });
});
