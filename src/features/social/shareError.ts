/**
 * JoyoRogo refuses a post with `FAILED_PRECONDITION` (the only precondition `social.*` checks) when the account has no
 * profile: the profile (birth year, height, weight, goal) is made by JoyoRogo's own onboarding. A JoyoFit account that
 * never opened JoyoRogo is in that state however far it got through JoyoFit's onboarding, and the server's
 * "Finish onboarding first." reads as if JoyoFit's was not finished.
 */
export function needsRogoProfile(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: unknown }).code === 'FAILED_PRECONDITION';
}
