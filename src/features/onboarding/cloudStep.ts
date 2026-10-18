/**
 * Which face the cloud step of the setup guide shows. Pure, so the choice is a plain function with a test.
 *
 * - `signin`: nobody is signed in to JoyoRogo; the step offers sign-in and can be skipped.
 * - `checking`: signed in, but the account's Pro state is not known yet (the status call is still out, or the phone is offline).
 * - `pro`: signed in and Pro; the step shows the sync switch and the backfill starts.
 * - `free`: signed in without Pro; the step explains and, where the store rules allow, points to Pro.
 */
export type CloudStepState = 'signin' | 'checking' | 'pro' | 'free';

/** `unlocked` is `watchWorkout.status.unlocked` (null until it has been read); `locked` is the refusal a real upload got. */
export function cloudStepState(facts: { signedIn: boolean; unlocked: boolean | null; locked: boolean }): CloudStepState {
  if (!facts.signedIn) return 'signin';
  if (facts.locked || facts.unlocked === false) return 'free';
  return facts.unlocked === true ? 'pro' : 'checking';
}
