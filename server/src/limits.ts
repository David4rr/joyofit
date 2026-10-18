/** Largest JSON body accepted by POST /v1/sync. Each table travels to D1 as one JSON bind parameter (2 MB cap). */
export const MAX_SYNC_BODY_BYTES = 3_000_000;

/** Largest JSON body accepted by PUT /v1/gear. */
export const MAX_GEAR_BODY_BYTES = 1_048_576;

export const MAX_STEP_SAMPLES = 5_000;
export const MAX_SLEEP_SEGMENTS = 2_000;
export const MAX_WORKOUTS = 50;
export const MAX_DEVICES = 10;
export const MAX_POINTS_PER_WORKOUT = 30_000;
/** Workout points per D1 statement, so one bind parameter stays well under D1's 2 MB string limit. */
export const POINTS_PER_STATEMENT = 4_000;

export const PULL_DEFAULT_LIMIT = 500;
export const PULL_MAX_LIMIT = 1_000;
/** Workouts carry their GPS track, so a pull page holds fewer of them. */
export const PULL_MAX_WORKOUTS = 25;

export const RESTORE_DEFAULT_LIMIT = 2_000;
export const RESTORE_MAX_LIMIT = 5_000;
/** GET /v1/restore refuses a window starting further back than this, to bound the cost of one restore. */
export const RESTORE_MAX_AGE_DAYS = 400;

/** How long a verified session is reused before JoyoRogo is asked again. */
export const AUTH_CACHE_TTL_MS = 60_000;
export const AUTH_CACHE_MAX_ENTRIES = 500;
export const AUTH_TIMEOUT_MS = 5_000;

export const DEFAULT_MAX_IMPORT_BYTES = 100 * 1024 * 1024;
export const IMPORT_LIST_LIMIT = 50;

/**
 * How long a "Founder" answer is reused before JoyoRogo is asked again. A "not Founder" answer is kept far shorter,
 * so someone who has just paid is not told to wait.
 */
export const ACCESS_CACHE_TTL_MS = 60_000;
export const ACCESS_LOCKED_CACHE_TTL_MS = 10_000;

/** How long the signed `state` of a Strava authorization stays valid. */
export const STRAVA_STATE_TTL_S = 600;
/** A call to JoyoRogo's Strava grant API; a code exchange or token refresh inside it waits for Strava (5 s). */
export const STRAVA_BROKER_TIMEOUT_MS = 12_000;
/** The deauthorization forward must finish inside Strava's two-second webhook deadline. */
export const STRAVA_WEBHOOK_BROKER_TIMEOUT_MS = 1_500;

/** POST /v1/waitlist: submissions per IP per clock hour (invalid ones count), and the largest body read. */
export const WAITLIST_MAX_PER_HOUR = 5;
export const WAITLIST_MAX_BODY_BYTES = 4_096;
export const WAITLIST_MAX_ENTRIES = 5_000;
