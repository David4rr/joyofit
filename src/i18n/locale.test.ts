import { describe, expect, test } from 'bun:test';

import { matchLocale, resolveLocale } from './locale';

describe('matchLocale', () => {
  test('maps regional and legacy tags', () => {
    expect(matchLocale('en-US')).toBe('en');
    expect(matchLocale('id-ID')).toBe('id');
    expect(matchLocale('in_ID')).toBe('id');
    expect(matchLocale('fr-FR')).toBeNull();
    expect(matchLocale(undefined)).toBeNull();
  });
});

describe('resolveLocale', () => {
  test('pinned choice beats the device, the device beats the fallback', () => {
    expect(resolveLocale({ pref: 'en', device: 'id-ID' })).toBe('en');
    expect(resolveLocale({ pref: 'auto', device: ['fr-FR', 'en-GB'] })).toBe('en');
    expect(resolveLocale({ device: ['fr-FR'] })).toBe('id');
    expect(resolveLocale({})).toBe('id');
  });
});
