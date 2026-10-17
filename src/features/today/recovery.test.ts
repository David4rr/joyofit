import { describe, expect, it } from 'bun:test';

import type { HrvReadingRow } from '@/db/queries';

import { nightHrvAvailability, type NightHrvInput } from './nightHrv';
import { recovery } from './recovery';

const NOW = 1_760_655_600;
const OLD = 'HRV: no readings yet. Measure HRV for a minute, or sync after a night with the watch on.';

const input: NightHrvInput = {
  platform: 'android',
  knownSupported: true,
  enabled: true,
  calibratedAt: NOW - 10 * 86400,
  nightsSinceSetup: 0,
  nightRowsSinceSetup: 0,
  anyNightRowInHistory: false,
};
const missing = (r: ReturnType<typeof recovery>) => ('missing' in r ? r.missing : '');

describe('recovery without a reading', () => {
  it('keeps the old text when nothing is known', () => {
    expect(missing(recovery([], NOW))).toBe(OLD);
    expect(missing(recovery([], NOW, null))).toBe(OLD);
    expect(missing(recovery([], NOW, { state: 'available' }))).toBe(OLD);
  });

  it('keeps the stale-readings text when nothing is known', () => {
    const stale: HrvReadingRow = { start: NOW - 5 * 86400, end: NOW - 5 * 86400 + 60, source: 'spot', rmssd: 40, beats: 60 };
    expect(missing(recovery([stale], NOW))).toBe('HRV: no reading from last night or today yet.');
  });

  it('says night HRV is unavailable and offers a 1-minute reading for an unsupported watch', () => {
    const text = missing(recovery([], NOW, nightHrvAvailability({ ...input, knownSupported: false })));
    expect(text).toBe('Night HRV not available on this watch. Measure HRV for a minute to get a recovery score.');
  });

  it('does the same when the watch recorded none', () => {
    const text = missing(recovery([], NOW, nightHrvAvailability({ ...input, nightsSinceSetup: 3 })));
    expect(text).toBe('Night HRV not available on this watch. Measure HRV for a minute to get a recovery score.');
  });

  it('does the same on iPhone', () => {
    const text = missing(recovery([], NOW, nightHrvAvailability({ ...input, platform: 'ios' })));
    expect(text).toBe('Night HRV is not read on iPhone yet. Measure HRV for a minute to get a recovery score.');
  });

  it('shows the off and waiting texts', () => {
    expect(missing(recovery([], NOW, nightHrvAvailability({ ...input, enabled: false })))).toStartWith('Night HRV is off. Turn on Automatic stress');
    expect(missing(recovery([], NOW, nightHrvAvailability({ ...input, nightsSinceSetup: 2 })))).toBe(
      'Night HRV: waiting for the first nights. Wear the watch asleep and sync. 2 of 3 nights checked.',
    );
  });

  it('keeps the baseline message when a reading exists', () => {
    const night: HrvReadingRow = { start: NOW - 8 * 3600, end: NOW - 3600, source: 'night', rmssd: 50, beats: 100 };
    expect(missing(recovery([night], NOW, { state: 'available' }))).toBe('HRV: 0 of 4 earlier nights needed for your baseline.');
  });
});
