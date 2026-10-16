import { describe, expect, it } from "vitest";

import { WAITLIST_MAX_PER_HOUR } from "../src/limits";
import { call, env, postJson } from "./helpers";

const TOKEN = "test-admin-token";

function submit(body: unknown, ip = "203.0.113.1") {
  return call("/v1/waitlist", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json", "cf-connecting-ip": ip, origin: "https://fit.joyorogo.com" },
  });
}

const rows = (email: string) =>
  env.DB.prepare("SELECT * FROM waitlist WHERE email = ?1 ORDER BY kind").bind(email).all<{
    kind: string;
    strava_profile: string | null;
    watch_model: string | null;
    status: string;
    created_at: number;
    updated_at: number;
  }>();

describe("POST /v1/waitlist", () => {
  it("stores a pending entry without a session and answers CORS for the site", async () => {
    const res = await submit({ kind: "strava", email: "  Ada@Example.COM ", stravaProfile: "https://www.strava.com/athletes/1" }, "198.51.100.1");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(res.headers.get("access-control-allow-origin")).toBe("https://fit.joyorogo.com");
    const { results } = await rows("ada@example.com");
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ kind: "strava", strava_profile: "https://www.strava.com/athletes/1", status: "pending" });
  });

  it("answers the preflight for the site origin only", async () => {
    const ok = await call("/v1/waitlist", {
      method: "OPTIONS",
      headers: { origin: "https://fit.joyorogo.com", "access-control-request-method": "POST", "access-control-request-headers": "content-type" },
    });
    expect(ok.headers.get("access-control-allow-origin")).toBe("https://fit.joyorogo.com");
    const other = await call("/v1/waitlist", {
      method: "OPTIONS",
      headers: { origin: "https://evil.example", "access-control-request-method": "POST" },
    });
    expect(other.headers.get("access-control-allow-origin")).not.toBe("https://evil.example");
  });

  it("rejects bad emails, unknown kinds and over-long fields", async () => {
    for (const [i, body] of [
      { kind: "strava", email: "not-an-email" },
      { kind: "strava", email: "" },
      { kind: "android", email: "a@example.com" },
      { kind: "iphone", email: "a@example.com", watchModel: "x".repeat(101) },
      { kind: "iphone", email: "a@example.com", note: "x".repeat(501) },
      { email: "a@example.com" },
    ].entries()) {
      const res = await submit(body, `198.51.100.${10 + i}`);
      expect(res.status, JSON.stringify(body)).toBe(400);
    }
    expect((await rows("a@example.com")).results).toHaveLength(0);
  });

  it("rejects bodies that are not JSON or too large", async () => {
    const bad = await call("/v1/waitlist", { method: "POST", body: "nope", headers: { "cf-connecting-ip": "198.51.100.30" } });
    expect(bad.status).toBe(400);
    const big = await submit({ kind: "iphone", email: "big@example.com", note: "x".repeat(10_000) }, "198.51.100.31");
    expect(big.status).toBe(413);
  });

  it("upserts by (kind, email): the second send updates, keeps created_at and status, and does not erase fields", async () => {
    await submit({ kind: "iphone", email: "up@example.com", watchModel: "Watch Fit 4 Pro" }, "198.51.100.40");
    const first = (await rows("up@example.com")).results[0]!;
    await env.DB.prepare("UPDATE waitlist SET status = 'invited', created_at = created_at - 1000 WHERE email = 'up@example.com'").run();
    await submit({ kind: "iphone", email: "UP@example.com", note: "halo" }, "198.51.100.41");
    const { results } = await rows("up@example.com");
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ status: "invited", watch_model: "Watch Fit 4 Pro" });
    expect(results[0]!.created_at).toBe(first.created_at - 1000);
    expect(results[0]!.updated_at).toBeGreaterThanOrEqual(first.updated_at);
  });

  it("keeps the two lists apart for the same email", async () => {
    await submit({ kind: "strava", email: "both@example.com" }, "198.51.100.50");
    await submit({ kind: "iphone", email: "both@example.com" }, "198.51.100.51");
    expect((await rows("both@example.com")).results.map((r) => r.kind)).toEqual(["iphone", "strava"]);
  });

  it("answers ok but stores nothing when the honeypot is filled", async () => {
    const res = await submit({ kind: "strava", email: "bot@example.com", website: "http://spam.example" }, "198.51.100.60");
    expect(res.status).toBe(200);
    expect((await rows("bot@example.com")).results).toHaveLength(0);
  });

  it("rate limits per IP, not per email, and other IPs are unaffected", async () => {
    const ip = "198.51.100.70";
    for (let i = 0; i < WAITLIST_MAX_PER_HOUR; i++) {
      expect((await submit({ kind: "iphone", email: `rl${i}@example.com` }, ip)).status).toBe(200);
    }
    const blocked = await submit({ kind: "iphone", email: "rl-extra@example.com" }, ip);
    expect(blocked.status).toBe(429);
    expect(Number(blocked.headers.get("retry-after"))).toBeGreaterThan(0);
    expect((await rows("rl-extra@example.com")).results).toHaveLength(0);
    expect((await submit({ kind: "iphone", email: "rl-other@example.com" }, "198.51.100.71")).status).toBe(200);
  });

  it("stores only a hash of the IP", async () => {
    await submit({ kind: "iphone", email: "hash@example.com" }, "198.51.100.80");
    const { results } = await env.DB.prepare("SELECT ip_hash FROM waitlist_rate").all<{ ip_hash: string }>();
    expect(results.length).toBeGreaterThan(0);
    expect(results.some((r) => r.ip_hash.includes("198.51.100.80"))).toBe(false);
  });
});

describe("GET /v1/waitlist", () => {
  const list = (headers: Record<string, string> = {}, query = "", e: { WAITLIST_ADMIN_TOKEN?: string } = { WAITLIST_ADMIN_TOKEN: TOKEN }) =>
    call(`/v1/waitlist${query}`, { headers, env: e });

  it("needs the bearer token", async () => {
    expect((await list()).status).toBe(401);
    expect((await list({ authorization: "Bearer wrong" })).status).toBe(401);
    expect((await list({ authorization: TOKEN })).status).toBe(401);
  });

  it("is off when no token is configured", async () => {
    const res = await list({ authorization: "Bearer anything" }, "", {});
    expect(res.status).toBe(503);
  });

  it("lists entries and filters by kind", async () => {
    await submit({ kind: "strava", email: "l1@example.com", stravaProfile: "Ada R" }, "198.51.100.90");
    await submit({ kind: "iphone", email: "l2@example.com" }, "198.51.100.91");
    const all = (await (await list({ authorization: `Bearer ${TOKEN}` })).json()) as { count: number; entries: { email: string }[] };
    expect(all.entries.map((e) => e.email)).toEqual(expect.arrayContaining(["l1@example.com", "l2@example.com"]));
    const strava = (await (await list({ authorization: `Bearer ${TOKEN}` }, "?kind=strava")).json()) as {
      entries: { kind: string; stravaProfile: string | null }[];
    };
    expect(strava.entries.every((e) => e.kind === "strava")).toBe(true);
    expect(strava.entries.find((e) => e.stravaProfile === "Ada R")).toBeTruthy();
    expect((await list({ authorization: `Bearer ${TOKEN}` }, "?kind=x")).status).toBe(400);
  });

  it("does not need a JoyoRogo session for POST but other /v1 routes still do", async () => {
    expect((await postJson("/v1/sync", {})).status).toBe(401);
  });
});
