/**
 * Worker bindings. `Env` comes from `wrangler types`; the rest is not part of the generated type:
 * `AUTH_SERVICE` is the optional service binding to JoyoRogo that is commented out in wrangler.jsonc, and the
 * Strava secrets are set with `wrangler secret put` (never in `vars`).
 */
export type AppEnv = Env & {
  AUTH_SERVICE?: Fetcher;
  /** The Strava application's secret, shared with JoyoRogo's Worker (which owns the tokens). Unset = Strava is not configured and its routes answer 503. */
  STRAVA_CLIENT_SECRET?: string;
  /** The `verify_token` chosen when creating the Strava webhook subscription; checked on the validation GET. */
  STRAVA_WEBHOOK_VERIFY_TOKEN?: string;
  /** Bearer token for `GET /v1/waitlist` (the owner's list). Unset = the list answers 503. */
  WAITLIST_ADMIN_TOKEN?: string;
};

export interface AuthUser {
  id: string;
  email: string;
  name: string | null;
}

export type AppContext = {
  Bindings: AppEnv;
  Variables: { user: AuthUser };
};
