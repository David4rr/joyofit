import { describe, expect, it } from "vitest";

import { signState, verifyState } from "../src/strava";
import { call, env, postJson, signUp, stravaUpstream } from "./helpers";

const SECRET = "test-client-secret";
const nowS = () => Math.floor(Date.now() / 1000);

interface TokenGrant {
  access: string;
  refresh: string;
  expiresIn: number;
  athleteId?: number;
  scope?: string;
}

/** Strava's `/oauth/token` answer. */
function grant({ access, refresh, expiresIn, athleteId = 4242, scope = "read,activity:write" }: TokenGrant): Response {
  return Response.json({
    token_type: "Bearer",
    access_token: access,
    refresh_token: refresh,
    expires_at: nowS() + expiresIn,
    expires_in: expiresIn,
    athlete: { id: athleteId },
    scope,
  });
}

async function row(userId: string) {
  return env.DB.prepare("SELECT * FROM strava_connection WHERE user_id = ?1").bind(userId).first<{
    athlete_id: number;
    access_token: string;
    refresh_token: string;
    expires_at: number;
    scope: string;
  }>();
}

/** Runs the authorize + callback round trip for a user and returns the app deep link the callback redirected to. */
async function connect(userId: string, cookie: string, response: Response = grant({ access: "acc-1", refresh: "ref-1", expiresIn: 21_600 })) {
  stravaUpstream.handler = () => response;
  const auth = await call("/v1/strava/authorize", { cookie });
  const { url } = (await auth.json()) as { url: string };
  const state = new URL(url).searchParams.get("state");
  const callback = await call(`/strava/callback?code=abc&scope=read,activity:write&state=${state}`);
  return { callback, location: callback.headers.get("location") ?? "", userId };
}

describe("Strava OAuth state", () => {
  it("round-trips a signed state and rejects tampering, another key and expiry", async () => {
    const state = await signState(SECRET, "user-1", 1_000);
    expect(await verifyState(SECRET, state, 1_001)).toBe("user-1");
    expect(await verifyState("other-secret", state, 1_001)).toBeNull();
    expect(await verifyState(SECRET, state, 1_000 + 601)).toBeNull();
    const [payload, signature] = state.split(".");
    const forged = `${btoa(JSON.stringify({ u: "user-2", exp: 9_999_999_999 })).replace(/=+$/, "")}.${signature}`;
    expect(await verifyState(SECRET, forged, 1_001)).toBeNull();
    expect(await verifyState(SECRET, `${payload}`, 1_001)).toBeNull();
    expect(await verifyState(SECRET, "garbage", 1_001)).toBeNull();
  });
});

describe("Strava connect", () => {
  it("needs a JoyoRogo session, and is free: a non-Founder account can connect", async () => {
    expect((await call("/v1/strava")).status).toBe(401);
    expect((await call("/v1/strava/authorize")).status).toBe(401);
    expect((await postJson("/v1/strava/token", {})).status).toBe(401);
    expect((await postJson("/v1/strava/disconnect", {})).status).toBe(401);

    const { user, cookie } = signUp("free", { founder: false });
    const { location } = await connect(user.id, cookie);
    expect(location).toBe("joyofit://settings/strava?status=connected");
  });

  it("builds an authorize URL with the activity:write scope, the client id and a callback on the Worker's own origin", async () => {
    const { cookie } = signUp("alice");
    const response = await call("/v1/strava/authorize", { cookie });
    expect(response.status).toBe(200);
    const { url } = (await response.json()) as { url: string };
    const parsed = new URL(url);
    expect(parsed.origin + parsed.pathname).toBe("https://www.strava.com/oauth/mobile/authorize");
    expect(parsed.searchParams.get("client_id")).toBe("287873");
    expect(parsed.searchParams.get("scope")).toBe("activity:write");
    expect(parsed.searchParams.get("response_type")).toBe("code");
    expect(parsed.searchParams.get("redirect_uri")).toBe("https://api.test/strava/callback");
    expect(url).not.toContain(SECRET);
  });

  it("exchanges the code, stores the tokens for the user that began the flow and reports status", async () => {
    const { user, cookie } = signUp("bob");
    const { location } = await connect(user.id, cookie);
    expect(location).toBe("joyofit://settings/strava?status=connected");

    const exchange = stravaUpstream.calls[0];
    expect(exchange?.url).toBe("https://www.strava.com/oauth/token");
    const sent = new URLSearchParams(exchange?.body);
    expect(Object.fromEntries(sent)).toMatchObject({ client_id: "287873", client_secret: SECRET, code: "abc", grant_type: "authorization_code" });

    expect(await row(user.id)).toMatchObject({ athlete_id: 4242, access_token: "acc-1", refresh_token: "ref-1", scope: "read activity:write" });
    const status = (await (await call("/v1/strava", { cookie })).json()) as Record<string, unknown>;
    expect(status).toMatchObject({ configured: true, connected: true, athleteId: 4242 });
    expect(status).not.toHaveProperty("accessToken");
    expect(JSON.stringify(status)).not.toContain("ref-1");
  });

  it("refuses a callback with a forged, missing or expired state and stores nothing", async () => {
    const before = await env.DB.prepare("SELECT COUNT(*) AS n FROM strava_connection").first<{ n: number }>();
    stravaUpstream.handler = () => grant({ access: "a", refresh: "r", expiresIn: 21_600 });
    const forged = await call("/strava/callback?code=abc&scope=activity:write&state=forged.sig");
    expect(forged.headers.get("location")).toBe("joyofit://settings/strava?status=error&reason=invalid_state");
    const none = await call("/strava/callback?code=abc");
    expect(none.headers.get("location")).toBe("joyofit://settings/strava?status=error&reason=invalid_state");
    const expired = await signState(SECRET, "user-x", nowS() - 10_000);
    const late = await call(`/strava/callback?code=abc&state=${expired}`);
    expect(late.headers.get("location")).toBe("joyofit://settings/strava?status=error&reason=invalid_state");
    expect(stravaUpstream.calls).toHaveLength(0);
    const after = await env.DB.prepare("SELECT COUNT(*) AS n FROM strava_connection").first<{ n: number }>();
    expect(after?.n).toBe(before?.n);
  });

  it("reports access_denied without calling Strava", async () => {
    const state = await signState(SECRET, "user-y", nowS());
    const response = await call(`/strava/callback?error=access_denied&state=${state}`);
    expect(response.headers.get("location")).toBe("joyofit://settings/strava?status=error&reason=access_denied");
    expect(stravaUpstream.calls).toHaveLength(0);
  });

  it("revokes and refuses the grant when the athlete unchecked activity:write", async () => {
    const { user, cookie } = signUp("carol");
    stravaUpstream.handler = (url) => (url.endsWith("/oauth/revoke") ? new Response(null, { status: 200 }) : grant({ access: "a", refresh: "r", expiresIn: 21_600, scope: "read" }));
    const auth = await call("/v1/strava/authorize", { cookie });
    const state = new URL(((await auth.json()) as { url: string }).url).searchParams.get("state");
    const response = await call(`/strava/callback?code=abc&scope=read&state=${state}`);
    expect(response.headers.get("location")).toBe("joyofit://settings/strava?status=error&reason=scope_missing");
    expect(stravaUpstream.calls.map((c) => c.url)).toEqual(["https://www.strava.com/oauth/token", "https://www.strava.com/oauth/revoke"]);
    expect(await row(user.id)).toBeNull();
  });

  it("answers 503 when the Strava secret is not set", async () => {
    const { cookie } = signUp("dave");
    const status = await call("/v1/strava", { cookie, env: { STRAVA_CLIENT_SECRET: "" } });
    expect(await status.json()).toEqual({ configured: false, connected: false });
    expect((await call("/v1/strava/authorize", { cookie, env: { STRAVA_CLIENT_SECRET: "" } })).status).toBe(503);
    const token = await call("/v1/strava/token", { method: "POST", cookie, env: { STRAVA_CLIENT_SECRET: "" } });
    expect(token.status).toBe(503);
  });
});

describe("Strava access token for the phone", () => {
  it("is 409 while not connected", async () => {
    const { cookie } = signUp("erin");
    const response = await postJson("/v1/strava/token", {}, cookie);
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "strava_not_connected" });
  });

  it("returns the stored token without calling Strava while it is fresh, and only the access token", async () => {
    const { user, cookie } = signUp("frank");
    await connect(user.id, cookie);
    stravaUpstream.calls = [];
    const response = await postJson("/v1/strava/token", {}, cookie);
    expect(response.status).toBe(200);
    const json = (await response.json()) as Record<string, unknown>;
    expect(json).toMatchObject({ accessToken: "acc-1", athleteId: 4242 });
    expect(JSON.stringify(json)).not.toContain("ref-1");
    expect(JSON.stringify(json)).not.toContain(SECRET);
    expect(stravaUpstream.calls).toHaveLength(0);
  });

  it("refreshes server-side when the token is about to expire and stores the rotated refresh token", async () => {
    const { user, cookie } = signUp("gina");
    await connect(user.id, cookie);
    await env.DB.prepare("UPDATE strava_connection SET expires_at = ?1 WHERE user_id = ?2").bind(nowS() + 30, user.id).run();
    stravaUpstream.calls = [];
    stravaUpstream.handler = () => grant({ access: "acc-2", refresh: "ref-2", expiresIn: 21_600 });

    const response = await postJson("/v1/strava/token", {}, cookie);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ accessToken: "acc-2" });
    const sent = new URLSearchParams(stravaUpstream.calls[0]?.body);
    expect(Object.fromEntries(sent)).toMatchObject({ grant_type: "refresh_token", refresh_token: "ref-1", client_secret: SECRET });
    expect(await row(user.id)).toMatchObject({ access_token: "acc-2", refresh_token: "ref-2" });
  });

  it("drops the connection when Strava rejects the refresh token for good, so the app asks to connect again", async () => {
    const { user, cookie } = signUp("hana");
    await connect(user.id, cookie);
    await env.DB.prepare("UPDATE strava_connection SET expires_at = ?1 WHERE user_id = ?2").bind(nowS() - 5, user.id).run();
    stravaUpstream.handler = () => Response.json({ message: "Bad Request" }, { status: 400 });
    const response = await postJson("/v1/strava/token", {}, cookie);
    expect(response.status).toBe(409);
    expect(await row(user.id)).toBeNull();
  });

  it("keeps the connection and answers 502 when Strava is down", async () => {
    const { user, cookie } = signUp("ivan");
    await connect(user.id, cookie);
    await env.DB.prepare("UPDATE strava_connection SET expires_at = ?1 WHERE user_id = ?2").bind(nowS() - 5, user.id).run();
    stravaUpstream.handler = () => new Response("down", { status: 503 });
    expect((await postJson("/v1/strava/token", {}, cookie)).status).toBe(502);
    expect(await row(user.id)).not.toBeNull();
  });

  it("never hands one user's token to another", async () => {
    const a = signUp("judy");
    const b = signUp("karl");
    await connect(a.user.id, a.cookie);
    expect((await postJson("/v1/strava/token", {}, b.cookie)).status).toBe(409);
    expect(((await (await call("/v1/strava", { cookie: b.cookie })).json()) as { connected: boolean }).connected).toBe(false);
  });
});

describe("Strava disconnect", () => {
  it("revokes the refresh token with Basic auth and deletes the row", async () => {
    const { user, cookie } = signUp("lena");
    await connect(user.id, cookie);
    stravaUpstream.calls = [];
    stravaUpstream.handler = () => new Response(null, { status: 200 });
    const response = await postJson("/v1/strava/disconnect", {}, cookie);
    expect(await response.json()).toEqual({ connected: false, revoked: true });
    const revoke = stravaUpstream.calls[0];
    expect(revoke?.url).toBe("https://www.strava.com/oauth/revoke");
    expect(revoke?.headers.get("authorization")).toBe(`Basic ${btoa(`287873:${SECRET}`)}`);
    expect(new URLSearchParams(revoke?.body).get("token")).toBe("ref-1");
    expect(await row(user.id)).toBeNull();
  });

  it("deletes the row even when Strava cannot be reached", async () => {
    const { user, cookie } = signUp("milo");
    await connect(user.id, cookie);
    stravaUpstream.handler = () => new Response("down", { status: 503 });
    const response = await postJson("/v1/strava/disconnect", {}, cookie);
    expect(await response.json()).toEqual({ connected: false, revoked: false });
    expect(await row(user.id)).toBeNull();
  });
});

describe("Strava webhook", () => {
  const query = "hub.mode=subscribe&hub.challenge=15f7d1a9&hub.verify_token=test-verify-token";

  it("echoes hub.challenge for the right verify token only", async () => {
    const ok = await call(`/strava/webhook?${query}`);
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ "hub.challenge": "15f7d1a9" });
    expect((await call("/strava/webhook?hub.mode=subscribe&hub.challenge=x&hub.verify_token=nope")).status).toBe(403);
    expect((await call(`/strava/webhook?${query}`, { env: { STRAVA_WEBHOOK_VERIFY_TOKEN: "" } })).status).toBe(403);
  });

  it("deletes the tokens of an athlete who deauthorized the app, and only theirs", async () => {
    const a = signUp("nora");
    const b = signUp("omar");
    await connect(a.user.id, a.cookie, grant({ access: "a-acc", refresh: "a-ref", expiresIn: 21_600, athleteId: 111 }));
    await connect(b.user.id, b.cookie, grant({ access: "b-acc", refresh: "b-ref", expiresIn: 21_600, athleteId: 222 }));
    const response = await postJson("/strava/webhook", {
      aspect_type: "update",
      event_time: nowS(),
      object_id: 111,
      object_type: "athlete",
      owner_id: 111,
      subscription_id: 1,
      updates: { authorized: "false" },
    });
    expect(response.status).toBe(200);
    expect(await row(a.user.id)).toBeNull();
    expect(await row(b.user.id)).not.toBeNull();
  });

  it("acknowledges and ignores activity events and garbage", async () => {
    const { user, cookie } = signUp("pia");
    await connect(user.id, cookie, grant({ access: "p-acc", refresh: "p-ref", expiresIn: 21_600, athleteId: 333 }));
    const activity = await postJson("/strava/webhook", { aspect_type: "update", object_id: 9, object_type: "activity", owner_id: 333, updates: { title: "x" } });
    expect(activity.status).toBe(200);
    const garbage = await call("/strava/webhook", { method: "POST", body: "not json" });
    expect(garbage.status).toBe(200);
    expect(await row(user.id)).not.toBeNull();
  });
});
