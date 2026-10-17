import { describe, expect, it } from 'bun:test';

import type { SleepSegment } from '@/wear';

import {
  countNightsSince,
  nightHrvAvailability,
  nightHrvTrendEmpty,
  recoveryTrendEmpty,
  type NightHrvInput,
} from './nightHrv';

const H = 3600;
const DAY = 24 * H;
const T0 = 1_760_655_600;

const base: NightHrvInput = {
  platform: 'android',
  knownSupported: true,
  enabled: true,
  calibratedAt: T0,
  nightsSinceSetup: 0,
  nightRowsSinceSetup: 0,
  anyNightRowInHistory: false,
};

describe('nightHrvAvailability', () => {
  it('is available as soon as a night row exists, without a message', () => {
    expect(nightHrvAvailability({ ...base, anyNightRowInHistory: true })).toEqual({ state: 'available' });
  });

  it('available wins over ios, unsupported and off', () => {
    expect(
      nightHrvAvailability({ ...base, platform: 'ios', knownSupported: false, enabled: false, anyNightRowInHistory: true }),
    ).toEqual({ state: 'available' });
  });

  it('ios wins over unsupported, off and waiting', () => {
    const a = nightHrvAvailability({ ...base, platform: 'ios', knownSupported: false, enabled: false });
    expect(a.state).toBe('ios');
    if (a.state === 'available') throw new Error('unreachable');
    expect(a.message).toBe('Night HRV is not read on iPhone yet');
    expect(a.detail).toContain('iPhone');
    expect(a.detail).toContain('1-minute reading still works');
  });

  it('unsupported when the watch did not list automatic stress, even with the switch on', () => {
    const a = nightHrvAvailability({ ...base, knownSupported: false, nightsSinceSetup: 5 });
    expect(a.state).toBe('unsupported');
    if (a.state === 'available') throw new Error('unreachable');
    expect(a.message).toBe('Night HRV not available on this watch');
    expect(a.detail).toContain('automatic stress');
    expect(a.detail).toContain('1-minute reading still works');
  });

  it('unsupported wins over off', () => {
    expect(nightHrvAvailability({ ...base, knownSupported: false, enabled: false }).state).toBe('unsupported');
  });

  it('off when the switch is off, also before any connect', () => {
    for (const knownSupported of [true, null]) {
      const a = nightHrvAvailability({ ...base, knownSupported, enabled: false, calibratedAt: null });
      expect(a.state).toBe('off');
      if (a.state === 'available') throw new Error('unreachable');
      expect(a.message).toBe('Night HRV is off');
      expect(a.detail).toContain('Settings > Heart rate and sensors');
    }
  });

  it('waiting until three nights have been checked', () => {
    for (const n of [0, 1, 2]) {
      const a = nightHrvAvailability({ ...base, nightsSinceSetup: n });
      expect(a.state).toBe('waiting');
      if (a.state === 'available') throw new Error('unreachable');
      expect(a.message).toBe('Night HRV: waiting for the first nights');
      expect(a.detail).toBe(`Wear the watch asleep and sync. ${n} of 3 nights checked.`);
    }
  });

  it('none-recorded after three nights with no rows', () => {
    const a = nightHrvAvailability({ ...base, nightsSinceSetup: 3 });
    expect(a.state).toBe('none-recorded');
    if (a.state === 'available') throw new Error('unreachable');
    expect(a.message).toBe('Night HRV not available on this watch');
    expect(a.detail).toContain('on for 3 nights');
    expect(a.detail).toContain('1-minute reading still works');
  });

  it('a unknown support state is treated as supported', () => {
    expect(nightHrvAvailability({ ...base, knownSupported: null, nightsSinceSetup: 4 }).state).toBe('none-recorded');
  });

  it('rows since setup keep it waiting instead of none-recorded', () => {
    expect(nightHrvAvailability({ ...base, nightsSinceSetup: 4, nightRowsSinceSetup: 1 }).state).toBe('waiting');
  });
});

describe('countNightsSince', () => {
  const night = (start: number, hours: number): SleepSegment => ({ start, end: start + hours * H, type: 6, stage: 'light' });
  const segments = [night(T0, 7), night(T0 + DAY, 7), night(T0 + 2 * DAY, 1), night(T0 + 3 * DAY, 8)];

  it('counts every night when there is no setup time and leaves the nap out', () => {
    expect(countNightsSince(segments, [], null)).toBe(3);
  });

  it('counts only nights that ended after the setup time', () => {
    expect(countNightsSince(segments, [], T0 + 7 * H)).toBe(2);
    expect(countNightsSince(segments, [], T0 + 3 * DAY + 8 * H)).toBe(0);
  });
});

describe('trend card empty texts', () => {
  it('keep the old wording when nothing is known or night HRV exists', () => {
    expect(nightHrvTrendEmpty(null)).toBe('No night HRV stored. Wear the watch asleep and sync.');
    expect(nightHrvTrendEmpty({ state: 'available' })).toBe('No night HRV stored. Wear the watch asleep and sync.');
    expect(recoveryTrendEmpty(null)).toContain('Needs HRV readings');
  });

  it('say why instead of telling a silent watch to be worn asleep', () => {
    const a = nightHrvAvailability({ ...base, knownSupported: false });
    expect(nightHrvTrendEmpty(a)).toStartWith('Night HRV not available on this watch. ');
    expect(nightHrvTrendEmpty(a)).not.toContain('Wear the watch asleep');
    expect(recoveryTrendEmpty(a)).toContain('Night HRV not available on this watch');
    expect(recoveryTrendEmpty(a)).not.toContain('a night with the watch on');
  });

  it('show the matching detail while waiting or off', () => {
    expect(nightHrvTrendEmpty(nightHrvAvailability({ ...base, nightsSinceSetup: 1 }))).toContain('1 of 3 nights checked.');
    expect(nightHrvTrendEmpty(nightHrvAvailability({ ...base, enabled: false }))).toContain('Turn on Automatic stress');
    expect(recoveryTrendEmpty(nightHrvAvailability({ ...base, enabled: false }))).toContain('Needs HRV readings');
  });
});
