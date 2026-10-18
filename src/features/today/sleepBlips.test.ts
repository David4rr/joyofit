import { describe, expect, it } from 'bun:test';

import { buildNights } from '@/features/sleep/nights';
import type { SleepSegment } from '@/wear';

import { lastSleepSession } from './stats';

const H = 3600;
const NIGHT_START = 1_760_655_600; // 23:00 WIB
const night: SleepSegment[] = [
  { start: NIGHT_START, end: NIGHT_START + 3 * H, type: 6, stage: 'light' },
  { start: NIGHT_START + 3 * H, end: NIGHT_START + 5 * H, type: 7, stage: 'deep' },
  { start: NIGHT_START + 5 * H, end: NIGHT_START + 7 * H, type: 6, stage: 'light' },
];
const wake = NIGHT_START + 7 * H;

describe('sleep blips (an HRV check recorded as sleep)', () => {
  it('a 2-minute "sleep" hours after waking is not the latest sleep', () => {
    const blip: SleepSegment = { start: wake + 5 * H, end: wake + 5 * H + 120, type: 6, stage: 'light' };
    const summary = lastSleepSession([...night, blip]);
    expect(summary?.start).toBe(NIGHT_START);
    expect(summary?.end).toBe(wake);
    expect(buildNights([...night, blip], [])).toHaveLength(1);
  });

  it('a 2-minute "sleep" soon after waking does not stretch the night', () => {
    const blip: SleepSegment = { start: wake + 2 * H, end: wake + 2 * H + 120, type: 6, stage: null };
    expect(lastSleepSession([...night, blip])?.end).toBe(wake);
  });

  it('a real 15-minute nap stays', () => {
    const nap: SleepSegment = { start: wake + 6 * H, end: wake + 6 * H + 15 * 60, type: 6, stage: 'light' };
    const nights = buildNights([...night, nap], []);
    expect(nights).toHaveLength(2);
    expect(nights.some((n) => n.nap && n.asleepSeconds === 15 * 60)).toBe(true);
  });

  it('only blips: no sleep at all', () => {
    expect(lastSleepSession([{ start: wake, end: wake + 60, type: 6, stage: 'light' }])).toBeNull();
  });
});
