import { describe, expect, test } from 'bun:test';

import { bucketAt, pointAt, labelledBars, labelsFit, nextSelection } from './barScrub';

describe('bucketAt', () => {
  test('maps x to equal slots', () => {
    expect(bucketAt(0, 0, 100, 4)).toBe(0);
    expect(bucketAt(24.9, 0, 100, 4)).toBe(0);
    expect(bucketAt(25, 0, 100, 4)).toBe(1);
    expect(bucketAt(99, 0, 100, 4)).toBe(3);
  });
  test('the right edge belongs to the last bar', () => {
    expect(bucketAt(100, 0, 100, 4)).toBe(3);
  });
  test('honours the left inset', () => {
    expect(bucketAt(5, 10, 100, 4)).toBe(-1);
    expect(bucketAt(10, 10, 100, 4)).toBe(0);
    expect(bucketAt(60, 10, 100, 4)).toBe(2);
  });
  test('outside or degenerate input finds nothing', () => {
    expect(bucketAt(101, 0, 100, 4)).toBe(-1);
    expect(bucketAt(-1, 0, 100, 4)).toBe(-1);
    expect(bucketAt(10, 0, 100, 0)).toBe(-1);
    expect(bucketAt(10, 0, 0, 4)).toBe(-1);
    expect(bucketAt(NaN, 0, 100, 4)).toBe(-1);
  });
});

describe('nextSelection', () => {
  test('a tap selects, a second tap on the same bar clears', () => {
    expect(nextSelection(null, 2, false)).toBe(2);
    expect(nextSelection(2, 2, false)).toBeNull();
    expect(nextSelection(2, 3, false)).toBe(3);
  });
  test('a drag keeps the bar it ends on', () => {
    expect(nextSelection(2, 2, true)).toBe(2);
  });
  test('a touch outside any bar clears', () => {
    expect(nextSelection(2, -1, false)).toBeNull();
    expect(nextSelection(2, -1, true)).toBeNull();
  });
});

describe('labels', () => {
  test('fit only for few, wide-enough slots', () => {
    expect(labelsFit(7, 300, 5)).toBe(true);
    expect(labelsFit(12, 300, 5)).toBe(false);
    expect(labelsFit(13, 900, 2)).toBe(false);
    expect(labelsFit(0, 300, 2)).toBe(false);
  });
  test('falls back to the highlighted bar only', () => {
    expect([...labelledBars(24, 300, ['1', '2'], 5)]).toEqual([5]);
    expect([...labelledBars(24, 300, ['1', '2'], null)]).toEqual([]);
    expect([...labelledBars(3, 300, ['1', '2', '3'], 1)]).toEqual([0, 1, 2]);
  });
});

describe('pointAt', () => {
  test('snaps to the nearest of evenly spaced points', () => {
    expect(pointAt(0, 5, 100, 5)).toBe(0);
    expect(pointAt(5, 5, 100, 5)).toBe(0);
    expect(pointAt(29, 5, 100, 5)).toBe(1);
    expect(pointAt(31, 5, 100, 5)).toBe(1);
    expect(pointAt(105, 5, 100, 5)).toBe(4);
  });
  test('a lone point and off-chart touches', () => {
    expect(pointAt(50, 5, 100, 1)).toBe(0);
    expect(pointAt(300, 5, 100, 5)).toBe(-1);
    expect(pointAt(50, 5, 100, 0)).toBe(-1);
  });
});
