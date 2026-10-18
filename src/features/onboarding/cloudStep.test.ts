import { describe, expect, test } from 'bun:test';

import { cloudStepState } from './cloudStep';

describe('cloud step state', () => {
  test('nobody signed in offers sign-in whatever else is known', () => {
    expect(cloudStepState({ signedIn: false, unlocked: null, locked: false })).toBe('signin');
    expect(cloudStepState({ signedIn: false, unlocked: true, locked: false })).toBe('signin');
  });

  test('signed in and Pro shows the switch', () => {
    expect(cloudStepState({ signedIn: true, unlocked: true, locked: false })).toBe('pro');
  });

  test('signed in without Pro shows the upsell', () => {
    expect(cloudStepState({ signedIn: true, unlocked: false, locked: false })).toBe('free');
  });

  test('an upload the server refused as not Pro wins over an older status', () => {
    expect(cloudStepState({ signedIn: true, unlocked: true, locked: true })).toBe('free');
    expect(cloudStepState({ signedIn: true, unlocked: null, locked: true })).toBe('free');
  });

  test('signed in with the Pro state unknown waits instead of guessing', () => {
    expect(cloudStepState({ signedIn: true, unlocked: null, locked: false })).toBe('checking');
  });
});
