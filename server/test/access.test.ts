import { describe, expect, it } from "vitest";

import { call, env, postJson, signUp, upstream } from "./helpers";

const stepBody = { stepSamples: [{ timestamp: 1000, steps: 5, calories: 1, distance: 3 }] };

async function stepCount(userId: string): Promise<number> {
  const row = await env.DB.prepare("SELECT COUNT(*) AS n FROM step_samples WHERE user_id = ?1").bind(userId).first<{ n: number }>();
  return row?.n ?? 0;
}

describe("Founder access", () => {
  it("refuses sync uploads from a free account with 402 and paywall: true, and stores nothing", async () => {
    const { user, cookie } = signUp("free", { founder: false });
    const response = await postJson("/v1/sync", stepBody, cookie);
    expect(response.status).toBe(402);
    expect(await response.json()).toEqual({ error: "founder_required", paywall: true });
    expect(await stepCount(user.id)).toBe(0);
  });

  it("refuses raw import uploads from a free account before touching R2 or D1", async () => {
    const { user, cookie } = signUp("free", { founder: false });
    const response = await call("/v1/imports", {
      method: "POST",
      body: new Uint8Array(10),
      headers: { "content-length": "10" },
      cookie,
    });
    expect(response.status).toBe(402);
    expect(((await response.json()) as { paywall: boolean }).paywall).toBe(true);
    const row = await env.DB.prepare("SELECT COUNT(*) AS n FROM imports WHERE user_id = ?1").bind(user.id).first<{ n: number }>();
    expect(row?.n).toBe(0);
  });

  it("keeps reads open for a free account: /me, pull and the import list", async () => {
    const { cookie } = signUp("free", { founder: false });
    expect((await call("/v1/sync", { cookie })).status).toBe(200);
    expect((await call("/v1/imports", { cookie })).status).toBe(200);
    const me = await call("/v1/me", { cookie });
    expect(me.status).toBe(200);
    expect(((await me.json()) as { cloud: { unlocked: boolean } }).cloud).toEqual({ unlocked: false });
  });

  it("accepts uploads from a Founder and reports unlocked on /me", async () => {
    const { user, cookie } = signUp("founder");
    expect((await postJson("/v1/sync", stepBody, cookie)).status).toBe(200);
    expect(await stepCount(user.id)).toBe(1);
    const me = await call("/v1/me", { cookie });
    expect(((await me.json()) as { cloud: { unlocked: boolean } }).cloud).toEqual({ unlocked: true });
  });

  it("asks JoyoRogo's fitness/cloudAccess with only the session cookies, once per burst", async () => {
    const { cookie } = signUp("founder");
    await postJson("/v1/sync", stepBody, cookie);
    await postJson("/v1/sync", stepBody, cookie);
    const access = upstream.calls.filter((c) => c.url === "https://api.joyorogo.com/rpc/fitness/cloudAccess");
    expect(access).toEqual([{ url: "https://api.joyorogo.com/rpc/fitness/cloudAccess", cookie }]);
  });

  it("answers 503 and stores nothing when JoyoRogo cannot say, instead of unlocking or locking", async () => {
    const { user, cookie } = signUp("founder");
    upstream.accessFailWith = 500;
    expect((await postJson("/v1/sync", stepBody, cookie)).status).toBe(503);
    expect(await stepCount(user.id)).toBe(0);
    // A 404 (JoyoRogo not deployed with the procedure yet) is unavailable too, never "free".
    upstream.accessFailWith = 404;
    expect((await call("/v1/me", { cookie })).status).toBe(503);
    // Failures are not cached.
    upstream.accessFailWith = null;
    expect((await postJson("/v1/sync", stepBody, cookie)).status).toBe(200);
  });
});
