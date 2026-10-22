/** Who the chat is talking to, as far as the phone and the JoyoRogo profile say. Everything is optional: unknown is null, never a guess. */
export type Maternal = 'none' | 'pregnant' | 'breastfeeding';

export interface Person {
  ageYears: number | null;
  sex: 'm' | 'f' | null;
  heightCm: number | null;
  goal: 'lose' | 'maintain' | 'gain' | null;
  maternal: Maternal;
  weightGoalKg: number | null;
  weightGoalDate: string | null;
  eatKcal: number | null;
}

/** BYOK is for adults: provider terms set their own age limits and the minor prompt block is a backstop, not a substitute. */
export const MIN_ADULT_AGE = 18;

export const EMPTY_PERSON: Person = {
  ageYears: null,
  sex: null,
  heightCm: null,
  goal: null,
  maternal: 'none',
  weightGoalKg: null,
  weightGoalDate: null,
  eatKcal: null,
};

/** Age from a birth year the way JoyoRogo counts it (this year minus the birth year); null for a missing or implausible year. */
export function ageFromBirthYear(birthYear: number | null | undefined, nowYear: number): number | null {
  if (typeof birthYear !== 'number' || !Number.isFinite(birthYear) || birthYear < 1900 || birthYear > nowYear) return null;
  return nowYear - birthYear;
}

/** The lowest age any source gives: one source saying under 18 is enough to keep BYOK off. */
export function lowestAge(...ages: (number | null)[]): number | null {
  const known = ages.filter((a): a is number => a !== null);
  return known.length === 0 ? null : Math.min(...known);
}

/** The kv-store entry that caches the last JoyoRogo profile read (birth year, goal, pregnancy mode) so the age gate works offline. */
export const PERSON_CACHE_KEY = 'joyofit.ai.person';
