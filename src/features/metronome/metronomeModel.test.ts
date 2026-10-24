import { describe, expect, test } from 'bun:test';

import { beatIntervalMs, clampBpm, DEFAULT_BPM, MAX_BPM, MIN_BPM, nextBeatAt, stepBpm } from './metronomeModel';

describe('clampBpm', () => {
  test('keeps the range and rounds', () => {
    expect(clampBpm(100)).toBe(MIN_BPM);
    expect(clampBpm(260)).toBe(MAX_BPM);
    expect(clampBpm(171.6)).toBe(172);
  });
  test('anything else is the default', () => {
    expect(clampBpm(Number.NaN)).toBe(DEFAULT_BPM);
    expect(clampBpm('180')).toBe(DEFAULT_BPM);
  });
});

describe('stepBpm', () => {
  test('moves by 5 and stops at the ends', () => {
    expect(stepBpm(170, 1)).toBe(175);
    expect(stepBpm(170, -1)).toBe(165);
    expect(stepBpm(MAX_BPM, 1)).toBe(MAX_BPM);
    expect(stepBpm(MIN_BPM, -1)).toBe(MIN_BPM);
  });
});

describe('beat timing', () => {
  test('interval of 180 bpm is a third of a second', () => {
    expect(beatIntervalMs(180)).toBeCloseTo(333.33, 1);
  });
  test('stays on the grid when a timer fires late', () => {
    expect(nextBeatAt(1000, 1040, 333)).toBe(1333);
  });
  test('restarts from now after a long suspension', () => {
    expect(nextBeatAt(1000, 9000, 333)).toBe(9333);
  });
});
