import { describe, expect, it } from 'bun:test';

import { needsRogoProfile } from './shareError';

describe('needsRogoProfile', () => {
  it("recognises JoyoRogo's FAILED_PRECONDITION refusal (RogoError carries the ORPC code)", () => {
    expect(needsRogoProfile(Object.assign(new Error('Finish onboarding first.'), { status: 412, code: 'FAILED_PRECONDITION' }))).toBe(true);
  });

  it('leaves every other failure alone', () => {
    expect(needsRogoProfile(Object.assign(new Error('x'), { status: 400, code: 'BAD_REQUEST' }))).toBe(false);
    expect(needsRogoProfile(new Error('offline'))).toBe(false);
    expect(needsRogoProfile(null)).toBe(false);
    expect(needsRogoProfile('FAILED_PRECONDITION')).toBe(false);
  });
});
