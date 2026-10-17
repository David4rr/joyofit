import { describe, expect, it } from 'bun:test';

import { nightHrvAvailability, type NightHrvInput } from './nightHrv';
import { hrvNote, readiness } from './readiness';
import type { Recovery, RecoveryState } from './recovery';

const input: NightHrvInput = {
  platform: 'android',
  knownSupported: true,
  enabled: true,
  calibratedAt: 1,
  nightsSinceSetup: 0,
  nightRowsSinceSetup: 0,
  anyNightRowInHistory: false,
};
const missing: RecoveryState = { missing: 'HRV: nothing' };
const spot = { recovery: { percent: 60, band: 'yellow', rmssd: 40, source: 'spot', baselineRmssd: 38, z: 0.4, baselineCount: 5 } as Recovery };
const night = { recovery: { ...spot.recovery, source: 'night' } as Recovery };

describe('hrvNote', () => {
  it('says readiness has no night HRV for an unsupported watch', () => {
    const a = nightHrvAvailability({ ...input, knownSupported: false });
    expect(hrvNote(missing, a)).toBe(
      'Readiness here uses sleep, resting heart rate and training load, no night HRV: Night HRV not available on this watch.',
    );
  });

  it('says so when the watch recorded none, and on iPhone', () => {
    expect(hrvNote(missing, nightHrvAvailability({ ...input, nightsSinceSetup: 3 }))).toContain('no night HRV: Night HRV not available on this watch.');
    expect(hrvNote(missing, nightHrvAvailability({ ...input, platform: 'ios' }))).toContain('Night HRV is not read on iPhone yet');
  });

  it('says a 1-minute reading stands in for night HRV', () => {
    expect(hrvNote(spot, nightHrvAvailability({ ...input, knownSupported: false }))).toBe(
      'HRV here is a 1-minute reading standing in for night HRV: Night HRV not available on this watch.',
    );
    expect(hrvNote(spot, null)).toBe('HRV here is a 1-minute reading standing in for night HRV.');
  });

  it('has no note for a night reading, when nothing is known, or while only the baseline is short', () => {
    expect(hrvNote(night, null)).toBeNull();
    expect(hrvNote(missing, null)).toBeNull();
    expect(hrvNote(missing, { state: 'available' })).toBeNull();
  });
});

describe('readiness', () => {
  const rest = { dayStart: 0, resting: new Map<number, number>(), strain: [], sleep: null };

  it('carries the note and leaves the headline logic alone', () => {
    const a = nightHrvAvailability({ ...input, knownSupported: false });
    const r = readiness({ ...rest, hrv: missing, availability: a });
    expect(r.hrvNote).toContain('no night HRV');
    expect(r.headline).toBeNull();
    expect(readiness({ ...rest, hrv: spot, availability: a }).headline).toBe('Balanced');
  });

  it('has no note without availability', () => {
    expect(readiness({ ...rest, hrv: missing }).hrvNote).toBeNull();
  });
});
