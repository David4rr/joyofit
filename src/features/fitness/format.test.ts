import { describe, expect, it } from 'bun:test';

import { formatHm, formatRaceTime, formatRecovery, sourceLabel } from './format';

describe('format', () => {
  it('labels the source', () => {
    expect(sourceLabel('watch')).toBe('dari jam');
    expect(sourceLabel('estimate')).toBe('perkiraan');
  });
  it('writes hours and minutes', () => {
    expect(formatHm(3900)).toBe('1 j 05 m');
    expect(formatHm(8.25 * 3600)).toBe('8 j 15 m');
    expect(formatHm(45 * 60)).toBe('45 m');
    expect(formatHm(0)).toBe('0 m');
  });
  it('says recovered under half an hour', () => {
    expect(formatRecovery(0)).toEqual({ value: 'Sudah pulih', unit: undefined });
    expect(formatRecovery(0.49).value).toBe('Sudah pulih');
    expect(formatRecovery(0.5)).toEqual({ value: '1', unit: 'jam' });
    expect(formatRecovery(14.4)).toEqual({ value: '14', unit: 'jam' });
  });
  it('writes race times', () => {
    expect(formatRaceTime(3127)).toBe('52:07');
    expect(formatRaceTime(1500)).toBe('25:00');
    expect(formatRaceTime(3600)).toBe('1:00:00');
    expect(formatRaceTime(13 * 3600 + 61)).toBe('13:01:01');
    expect(formatRaceTime(59.6)).toBe('1:00');
  });
});
