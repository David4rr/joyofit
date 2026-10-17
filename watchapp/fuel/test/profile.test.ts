import { describe, expect, it } from 'bun:test';

import {
  DEFAULT_AGE,
  DEFAULT_WEIGHT_KG,
  PROFILE_KEY,
  ageFromBirthYear,
  defaults,
  describe as describeProfile,
  edit,
  forSession,
  fromPhone,
  maxHr,
  normalize,
  parse,
  serialize,
  sourceText,
  yearOf,
} from '../entry/src/main/js/default/common/profile.js';

const phone = (over: Record<string, unknown> = {}) => ({
  v: 1,
  t: 'profile',
  weightKg: 72.5,
  age: 34,
  sex: 'male',
  maxHr: 186,
  restHr: 58,
  at: 1_800_000_000_000,
  ...over,
});

describe('defaults', () => {
  it('are LiveWorkout.DEFAULT_AGE and DEFAULT_WEIGHT_KG, with a max of 220 - age', () => {
    expect(DEFAULT_AGE).toBe(35);
    expect(DEFAULT_WEIGHT_KG).toBe(70);
    const d = defaults();
    expect(d).toEqual({ weightKg: 70, age: 35, sex: 'unknown', maxHrOverride: null, restHr: null, at: 0, src: 'default' });
    expect(maxHr(d)).toBe(185);
    expect(forSession(d)).toEqual({ weightKg: 70, age: 35, sex: 'unknown', maxHr: 185 });
  });

  it('use one storage key', () => {
    expect(PROFILE_KEY).toBe('fuel.profile');
  });
});

describe('profile from the phone', () => {
  it('is taken when the watch holds none, including at 0 (JoyoFit sends at 0 without a saved profile)', () => {
    const r = fromPhone(defaults(), phone({ at: 0, weightKg: 70, age: 35, sex: 'unknown', maxHr: 185, restHr: null }));
    expect(r.stored).toBe(true);
    expect(r.profile).toEqual({ weightKg: 70, age: 35, sex: 'unknown', maxHrOverride: null, restHr: null, at: 0, src: 'phone' });
  });

  it('is taken when its at is newer, and keeps maxHr 220 - age as automatic', () => {
    const base = { ...defaults(), at: 1000, src: 'phone' };
    const r = fromPhone(base, phone());
    expect(r.stored).toBe(true);
    expect(r.profile).toEqual({ weightKg: 72.5, age: 34, sex: 'male', maxHrOverride: null, restHr: 58, at: 1_800_000_000_000, src: 'phone' });
    expect(maxHr(r.profile!)).toBe(186);
  });

  it('keeps a maxHr that is not 220 - age as the override', () => {
    const r = fromPhone(defaults(), phone({ maxHr: 192 }));
    expect(r.profile!.maxHrOverride).toBe(192);
    expect(maxHr(r.profile!)).toBe(192);
  });

  it('is ignored when not newer than a stored profile', () => {
    const stored = { ...defaults(), weightKg: 80, at: 2000, src: 'watch' };
    expect(fromPhone(stored, phone({ at: 2000 })).stored).toBe(false);
    expect(fromPhone(stored, phone({ at: 1999 })).stored).toBe(false);
    expect(fromPhone({ ...stored, src: 'phone' }, phone({ at: 0 })).stored).toBe(false);
    expect(fromPhone(stored, phone({ at: 2001 })).stored).toBe(true);
  });

  it('rejects malformed messages and leaves sex unknown for odd values', () => {
    expect(fromPhone(defaults(), { v: 2, t: 'profile' }).stored).toBe(false);
    expect(fromPhone(defaults(), { v: 1, t: 'hello' }).stored).toBe(false);
    expect(fromPhone(defaults(), null).stored).toBe(false);
    expect(fromPhone(defaults(), phone({ weightKg: 0 })).stored).toBe(false);
    expect(fromPhone(defaults(), phone({ weightKg: '70' })).stored).toBe(false);
    expect(fromPhone(defaults(), phone({ age: 0 })).stored).toBe(false);
    expect(fromPhone(defaults(), phone({ at: -1 })).stored).toBe(false);
    expect(fromPhone(defaults(), phone({ at: undefined })).stored).toBe(false);
    expect(fromPhone(defaults(), phone({ sex: 'other' })).profile!.sex).toBe('unknown');
    expect(fromPhone(defaults(), phone({ restHr: null })).profile!.restHr).toBeNull();
  });

  it('accepts weightKg printed as 70.0 (JSON number)', () => {
    const msg = JSON.parse('{"v":1,"t":"profile","weightKg":70.0,"age":35,"sex":"unknown","maxHr":185,"restHr":null,"at":5}');
    expect(fromPhone(defaults(), msg).profile!.weightKg).toBe(70);
  });
});

describe('edit on the watch', () => {
  it('sets at to the watch clock and src to watch', () => {
    const p = edit({ ...defaults(), at: 1000, src: 'phone' }, { weightKg: 75 }, 5000);
    expect(p.weightKg).toBe(75);
    expect(p.at).toBe(5000);
    expect(p.src).toBe('watch');
  });

  it('beats a phone profile that is newer than the watch clock', () => {
    const phoneCopy = { ...defaults(), at: 9000, src: 'phone' };
    const p = edit(phoneCopy, { age: 40 }, 100);
    expect(p.at).toBe(9001);
    expect(fromPhone(p, phone({ at: 9000 })).stored).toBe(false);
  });

  it('then wins over an older phone message and loses to a newer one', () => {
    const p = edit(defaults(), { weightKg: 65 }, 5000);
    expect(fromPhone(p, phone({ at: 4999 })).stored).toBe(false);
    expect(fromPhone(p, phone({ at: 5001 })).stored).toBe(true);
  });

  it('max heart rate: override, or null for automatic again', () => {
    let p = edit(defaults(), { maxHrOverride: 175 }, 10);
    expect(maxHr(p)).toBe(175);
    p = edit(p, { age: 50 }, 20);
    expect(maxHr(p)).toBe(175); // an override stays
    p = edit(p, { maxHrOverride: null }, 30);
    expect(maxHr(p)).toBe(170);
  });

  it('keeps values inside what the math accepts', () => {
    const p = edit(defaults(), { weightKg: 5000, age: -3, sex: 'robot', maxHrOverride: 20 }, 10);
    expect(p.weightKg).toBe(DEFAULT_WEIGHT_KG);
    expect(p.age).toBe(DEFAULT_AGE);
    expect(p.sex).toBe('unknown');
    expect(p.maxHrOverride).toBeNull();
    expect(p.at).toBe(10);
    expect(p.src).toBe('watch');
  });
});

describe('storage round trip', () => {
  it('serializes and parses the whole profile with at and src', () => {
    const p = edit(defaults(), { weightKg: 68.5, age: 41, sex: 'female', maxHrOverride: 170 }, 123456);
    expect(parse(serialize(p))).toEqual(p);
    expect(JSON.parse(serialize(p)).src).toBe('watch');
    expect(JSON.parse(serialize(p)).at).toBe(123456);
  });

  it('falls back to the defaults for nothing, damage or junk', () => {
    expect(parse(null)).toEqual(defaults());
    expect(parse('')).toEqual(defaults());
    expect(parse('{not json')).toEqual(defaults());
    expect(normalize('x')).toEqual(defaults());
    expect(normalize({ weightKg: -4, age: 'old', sex: 3 })).toEqual(defaults());
  });

  it('a stored phone profile keeps src phone, also at 0', () => {
    const stored = fromPhone(defaults(), phone({ at: 0 })).profile!;
    expect(parse(serialize(stored)).src).toBe('phone');
  });
});

describe('years and age', () => {
  it('yearOf is the UTC calendar year', () => {
    expect(yearOf(0)).toBe(1970);
    expect(yearOf(Date.UTC(2026, 0, 1))).toBe(2026);
    expect(yearOf(Date.UTC(2025, 11, 31, 23, 59, 59))).toBe(2025);
    expect(yearOf(Date.UTC(2024, 1, 29))).toBe(2024);
    expect(yearOf(Date.UTC(2000, 2, 1))).toBe(2000);
    expect(yearOf(Date.UTC(1999, 11, 31))).toBe(1999);
  });

  it('age from birth year is ProfileSender.age: the year difference, never negative', () => {
    expect(ageFromBirthYear(1992, Date.UTC(2026, 9, 17))).toBe(34);
    expect(ageFromBirthYear(2030, Date.UTC(2026, 9, 17))).toBe(0);
  });
});

describe('text for the home page', () => {
  it('describes the profile and where it came from', () => {
    const p = fromPhone(defaults(), phone()).profile!;
    expect(describeProfile(p)).toBe('72.5 kg, 34 y, male, max 186');
    expect(describeProfile(defaults())).toBe('70 kg, 35 y, sex not set, max 185');
    expect(sourceText(p)).toBe('from JoyoFit');
    expect(sourceText(edit(p, { age: 35 }, 5))).toBe('set on the watch');
    expect(sourceText(defaults())).toBe('defaults, not set yet');
  });
});
