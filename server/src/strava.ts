import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";

import type { AppContext, AppEnv } from "./env";
import {
  STRAVA_REFRESH_MARGIN_S,
  STRAVA_REQUIRED_SCOPE,
  STRAVA_STATE_TTL_S,
  STRAVA_TIMEOUT_MS,
} from "./limits";

/**
 * Strava for JoyoFit: the phone uploads workouts straight to Strava, this Worker only holds what needs the client
 * secret (code exchange, refresh, revoke) and answers Strava's deauthorization webhook. Strava sync is free: nothing
 * here checks Founder. Strava data is never read, stored or forwarded beyond the athlete id and the tokens.
 *
 * - `GET  /v1/strava`             status (signed-in user)
 * - `GET  /v1/strava/authorize`   `{ url }` to open in a browser (signed-in user)
 * - `POST /v1/strava/token`       `{ accessToken, expiresAt, athleteId }`, refreshed here (signed-in user)
 * - `POST /v1/strava/disconnect`  revoke at Strava, delete the row (signed-in user)
 * - `GET  /strava/callback`       Strava's redirect; stores tokens, redirects to the app (`joyofit://settings/strava`)
 * - `GET|POST /strava/webhook`    subscription validation / deauthorization events
 */

const STRAVA_OAUTH = "https://www.strava.com/oauth";
const APP_DEEP_LINK = "joyofit://settings/strava";

interface ConnectionRow {
  user_id: string;
  athlete_id: number;
  access_token: string;
  refresh_token: string;
  expires_at: number;
  scope: string;
  connected_at: number;
}

const tokenSchema = z.object({
  access_token: z.string().min(1),
  refresh_token: z.string().min(1),
  expires_at: z.number(),
  athlete: z.object({ id: z.number() }).optional(),
  scope: z.string().optional(),
});

/** A callback or token request failed in a way the user can act on; `reason` ends up in the app deep link. */
class StravaFlowError extends Error {
  constructor(readonly reason: string) {
    super(reason);
  }
}

const nowSeconds = () => Math.floor(Date.now() / 1000);

function configured(env: AppEnv): env is AppEnv & { STRAVA_CLIENT_SECRET: string } {
  return Boolean(env.STRAVA_CLIENT_ID) && Boolean(env.STRAVA_CLIENT_SECRET);
}

function requireConfigured(env: AppEnv): asserts env is AppEnv & { STRAVA_CLIENT_SECRET: string } {
  if (!configured(env)) throw new HTTPException(503, { message: "strava_not_configured" });
}

// ---------------------------------------------------------------------------------------------------------------------
// Signed OAuth state: `<base64url(json)>.<base64url(hmac)>`, so the callback (which carries no session cookie) knows
// which JoyoRogo user began the flow. The client secret is the HMAC key; nothing is stored.
// ---------------------------------------------------------------------------------------------------------------------

const b64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const fromB64url = (text: string) => Uint8Array.from(atob(text.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));

async function hmacKey(secret: string, usage: "sign" | "verify"): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [usage]);
}

export async function signState(secret: string, userId: string, nowS: number): Promise<string> {
  const payload = b64url(new TextEncoder().encode(JSON.stringify({ u: userId, exp: nowS + STRAVA_STATE_TTL_S })));
  const signature = await crypto.subtle.sign("HMAC", await hmacKey(secret, "sign"), new TextEncoder().encode(payload));
  return `${payload}.${b64url(new Uint8Array(signature))}`;
}

/** The user id inside a state this Worker signed and that has not expired; null for anything else. */
export async function verifyState(secret: string, state: string, nowS: number): Promise<string | null> {
  const [payload, signature, extra] = state.split(".");
  if (!payload || !signature || extra !== undefined) return null;
  try {
    const valid = await crypto.subtle.verify("HMAC", await hmacKey(secret, "verify"), fromB64url(signature), new TextEncoder().encode(payload));
    if (!valid) return null;
    const parsed = z.object({ u: z.string().min(1), exp: z.number() }).safeParse(JSON.parse(new TextDecoder().decode(fromB64url(payload))));
    return parsed.success && parsed.data.exp > nowS ? parsed.data.u : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// Strava HTTP
// ---------------------------------------------------------------------------------------------------------------------

async function tokenRequest(env: AppEnv & { STRAVA_CLIENT_SECRET: string }, params: Record<string, string>): Promise<Response> {
  return fetch(`${STRAVA_OAUTH}/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
    body: new URLSearchParams({ client_id: env.STRAVA_CLIENT_ID, client_secret: env.STRAVA_CLIENT_SECRET, ...params }),
    signal: AbortSignal.timeout(STRAVA_TIMEOUT_MS),
  });
}

/** Revokes a token (and the grant behind it). `true` when Strava confirmed; failures are the caller's to ignore. */
async function revoke(env: AppEnv & { STRAVA_CLIENT_SECRET: string }, token: string, hint: "access_token" | "refresh_token"): Promise<boolean> {
  try {
    const response = await fetch(`${STRAVA_OAUTH}/revoke`, {
      method: "POST",
      headers: {
        authorization: `Basic ${btoa(`${env.STRAVA_CLIENT_ID}:${env.STRAVA_CLIENT_SECRET}`)}`,
        "content-type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ token, token_type_hint: hint }),
      signal: AbortSignal.timeout(STRAVA_TIMEOUT_MS),
    });
    await response.body?.cancel();
    return response.ok;
  } catch {
    return false;
  }
}

async function readConnection(db: D1Database, userId: string): Promise<ConnectionRow | null> {
  return db
    .prepare("SELECT user_id, athlete_id, access_token, refresh_token, expires_at, scope, connected_at FROM strava_connection WHERE user_id = ?1")
    .bind(userId)
    .first<ConnectionRow>();
}

/**
 * The access token of this user's Strava connection, refreshed first when it expires within
 * STRAVA_REFRESH_MARGIN_S. Strava invalidates the old refresh token as soon as it hands out a new one, so two phones
 * refreshing at once could lose a race: the loser re-reads the row and uses the winner's token. A refresh token
 * Strava refuses for good deletes the connection (the user must connect again) and returns null.
 */
export async function freshAccessToken(env: AppEnv, userId: string, nowS: number): Promise<{ row: ConnectionRow } | null> {
  requireConfigured(env);
  const row = await readConnection(env.DB, userId);
  if (!row) return null;
  if (row.expires_at - nowS > STRAVA_REFRESH_MARGIN_S) return { row };

  let response: Response;
  try {
    response = await tokenRequest(env, { grant_type: "refresh_token", refresh_token: row.refresh_token });
  } catch (error) {
    throw new HTTPException(502, { message: `strava_unreachable: ${error instanceof Error ? error.message : String(error)}` });
  }
  if (response.status === 400 || response.status === 401) {
    await response.body?.cancel();
    const latest = await readConnection(env.DB, userId);
    if (latest && latest.refresh_token !== row.refresh_token) return { row: latest };
    await env.DB.prepare("DELETE FROM strava_connection WHERE user_id = ?1 AND refresh_token = ?2").bind(userId, row.refresh_token).run();
    return null;
  }
  if (!response.ok) {
    await response.body?.cancel();
    throw new HTTPException(502, { message: `strava_error_${response.status}` });
  }
  const parsed = tokenSchema.safeParse(await response.json().catch(() => null));
  if (!parsed.success) throw new HTTPException(502, { message: "strava_bad_response" });
  const next = parsed.data;
  // Only the request that still holds the stored refresh token may overwrite it.
  await env.DB.prepare(
    `UPDATE strava_connection SET access_token = ?1, refresh_token = ?2, expires_at = ?3, updated_at = ?4
     WHERE user_id = ?5 AND refresh_token = ?6`,
  )
    .bind(next.access_token, next.refresh_token, next.expires_at, nowS, userId, row.refresh_token)
    .run();
  const stored = await readConnection(env.DB, userId);
  return stored ? { row: stored } : null;
}

// ---------------------------------------------------------------------------------------------------------------------
// Signed-in routes (mounted under /v1/strava, after requireUser)
// ---------------------------------------------------------------------------------------------------------------------

export const strava = new Hono<AppContext>();

strava.get("/", async (c) => {
  if (!configured(c.env)) return c.json({ configured: false, connected: false });
  const row = await readConnection(c.env.DB, c.get("user").id);
  if (!row) return c.json({ configured: true, connected: false });
  return c.json({ configured: true, connected: true, athleteId: row.athlete_id, connectedAt: row.connected_at, scope: row.scope });
});

strava.get("/authorize", async (c) => {
  requireConfigured(c.env);
  const state = await signState(c.env.STRAVA_CLIENT_SECRET, c.get("user").id, nowSeconds());
  const redirectUri = `${new URL(c.req.url).origin}/strava/callback`;
  const query = new URLSearchParams({
    client_id: c.env.STRAVA_CLIENT_ID,
    redirect_uri: redirectUri,
    response_type: "code",
    approval_prompt: "auto",
    scope: STRAVA_REQUIRED_SCOPE,
    state,
  });
  // The mobile endpoint opens the Strava app when it is installed and falls back to the web page otherwise.
  return c.json({ url: `${STRAVA_OAUTH}/mobile/authorize?${query}` });
});

strava.post("/token", async (c) => {
  const found = await freshAccessToken(c.env, c.get("user").id, nowSeconds());
  if (!found) return c.json({ error: "strava_not_connected" }, 409);
  const { row } = found;
  return c.json({ accessToken: row.access_token, expiresAt: row.expires_at, athleteId: row.athlete_id });
});

/** Account deletion: revoke the Strava tokens when we can and delete our copy either way. */
export async function dropStravaConnection(env: AppEnv, userId: string): Promise<void> {
  const row = await readConnection(env.DB, userId);
  if (!row) return;
  if (configured(env)) await revoke(env, row.refresh_token, "refresh_token");
  await env.DB.prepare("DELETE FROM strava_connection WHERE user_id = ?1").bind(userId).run();
}

strava.post("/disconnect", async (c) => {
  requireConfigured(c.env);
  const userId = c.get("user").id;
  const row = await readConnection(c.env.DB, userId);
  if (!row) return c.json({ connected: false, revoked: true });
  // Revoking the refresh token also invalidates its access tokens. Delete our copy whatever Strava answers: the
  // athlete can always remove the app on strava.com, and we must not keep tokens the user asked us to drop.
  const revoked = await revoke(c.env, row.refresh_token, "refresh_token");
  await c.env.DB.prepare("DELETE FROM strava_connection WHERE user_id = ?1").bind(userId).run();
  return c.json({ connected: false, revoked });
});

// ---------------------------------------------------------------------------------------------------------------------
// Public routes (Strava calls these; no JoyoRogo session)
// ---------------------------------------------------------------------------------------------------------------------

export const stravaPublic = new Hono<AppContext>();

function appRedirect(params: Record<string, string>): Response {
  const location = `${APP_DEEP_LINK}?${new URLSearchParams(params)}`;
  const body =
    `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">` +
    `<title>JoyoFit</title><body style="font-family:system-ui;padding:2rem;text-align:center">` +
    `<p>Return to JoyoFit to finish.</p><p><a href="${location.replace(/&/g, "&amp;")}">Open JoyoFit</a></p>`;
  return new Response(body, { status: 302, headers: { location, "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
}

stravaPublic.get("/callback", async (c) => {
  if (!configured(c.env)) return appRedirect({ status: "error", reason: "not_configured" });
  const env = c.env;
  const q = c.req.query();
  try {
    const userId = q.state ? await verifyState(env.STRAVA_CLIENT_SECRET, q.state, nowSeconds()) : null;
    if (!userId) throw new StravaFlowError("invalid_state");
    if (q.error) throw new StravaFlowError(q.error === "access_denied" ? "access_denied" : "strava_error");
    if (!q.code) throw new StravaFlowError("no_code");

    let response: Response;
    try {
      response = await tokenRequest(env, { grant_type: "authorization_code", code: q.code });
    } catch {
      throw new StravaFlowError("strava_unreachable");
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw new StravaFlowError("exchange_failed");
    }
    const parsed = tokenSchema.safeParse(await response.json().catch(() => null));
    if (!parsed.success || !parsed.data.athlete) throw new StravaFlowError("exchange_failed");
    const token = parsed.data;
    const athleteId = token.athlete?.id ?? 0;
    // The athlete may uncheck "upload activities" on Strava's page; then nothing works, so do not keep the grant.
    const scope = (token.scope ?? q.scope ?? "").split(/[\s,]+/).filter(Boolean);
    if (!scope.includes(STRAVA_REQUIRED_SCOPE)) {
      await revoke(env, token.refresh_token, "refresh_token");
      throw new StravaFlowError("scope_missing");
    }
    const now = nowSeconds();
    await env.DB.prepare(
      `INSERT INTO strava_connection (user_id, athlete_id, access_token, refresh_token, expires_at, scope, connected_at, updated_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7)
       ON CONFLICT (user_id) DO UPDATE SET athlete_id = excluded.athlete_id, access_token = excluded.access_token,
         refresh_token = excluded.refresh_token, expires_at = excluded.expires_at, scope = excluded.scope,
         connected_at = excluded.connected_at, updated_at = excluded.updated_at`,
    )
      .bind(userId, athleteId, token.access_token, token.refresh_token, token.expires_at, scope.join(" "), now)
      .run();
    return appRedirect({ status: "connected" });
  } catch (error) {
    if (error instanceof StravaFlowError) return appRedirect({ status: "error", reason: error.reason });
    throw error;
  }
});

/** Strava's subscription validation: echo `hub.challenge` when the verify token is the one the owner chose. */
stravaPublic.get("/webhook", (c) => {
  const expected = c.env.STRAVA_WEBHOOK_VERIFY_TOKEN;
  const q = c.req.query();
  if (!expected || q["hub.mode"] !== "subscribe" || q["hub.verify_token"] !== expected || !q["hub.challenge"]) {
    return c.json({ error: "forbidden" }, 403);
  }
  return c.json({ "hub.challenge": q["hub.challenge"] });
});

const webhookEventSchema = z.object({
  object_type: z.string(),
  object_id: z.number(),
  aspect_type: z.string(),
  owner_id: z.number().optional(),
  updates: z.record(z.string(), z.unknown()).optional(),
});

/**
 * Strava events. Only the deauthorization (`athlete` update with `authorized: "false"`) matters: the athlete's tokens
 * are deleted at once. Activity events are acknowledged and ignored; JoyoFit never reads Strava activities. Strava
 * wants a 200 within two seconds, and retries otherwise, so anything unparseable is acknowledged too.
 */
stravaPublic.post("/webhook", async (c) => {
  const parsed = webhookEventSchema.safeParse(await c.req.json().catch(() => null));
  if (parsed.success) {
    const event = parsed.data;
    if (event.object_type === "athlete" && event.aspect_type === "update" && String(event.updates?.authorized) === "false") {
      const athleteId = event.owner_id ?? event.object_id;
      await c.env.DB.prepare("DELETE FROM strava_connection WHERE athlete_id = ?1").bind(athleteId).run();
    }
  }
  return c.json({ ok: true });
});
