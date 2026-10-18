import { describe, expect, it } from 'bun:test';

import { kmToMetres, metresToKmText, parseKm } from './form';

describe('parseKm', () => {
  it('reads a comma or a dot', () => {
    expect(parseKm('12,5')).toEqual({ ok: true, metres: 12500 });
    expect(parseKm('12.5')).toEqual({ ok: true, metres: 12500 });
    expect(parseKm(' 650 ')).toEqual({ ok: true, metres: 650000 });
    expect(parseKm(',5')).toEqual({ ok: true, metres: 500 });
    expect(parseKm('0')).toEqual({ ok: true, metres: 0 });
  });

  it('treats an empty field as nothing', () => {
    expect(parseKm('')).toEqual({ ok: true, metres: null });
    expect(parseKm('   ')).toEqual({ ok: true, metres: null });
  });

  it('rejects text that is not a distance', () => {
    for (const bad of ['abc', '-5', '1,2,3', '1.234,5', '12 km', '.', ',']) expect(parseKm(bad)).toEqual({ ok: false });
  });
});

describe('kmToMetres', () => {
  it('rounds to whole metres', () => {
    expect(kmToMetres(12.5)).toBe(12500);
    expect(kmToMetres(0.0004)).toBe(0);
    expect(kmToMetres(1.2345)).toBe(1235);
  });
});

describe('metresToKmText', () => {
  it('writes the field text with the language separator', () => {
    expect(metresToKmText(12500, true)).toBe('12,5');
    expect(metresToKmText(12500, false)).toBe('12.5');
    expect(metresToKmText(650000, true)).toBe('650');
    expect(metresToKmText(1234567, false)).toBe('1234.57');
  });

  it('leaves the field empty for nothing or zero', () => {
    expect(metresToKmText(null, true)).toBe('');
    expect(metresToKmText(0, true)).toBe('');
  });

  it('round-trips through parseKm', () => {
    expect(parseKm(metresToKmText(87650, true))).toEqual({ ok: true, metres: 87650 });
  });
});
