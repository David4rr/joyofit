import { describe, expect, it } from "vitest";

import { call, env, grantApi, signUp } from "./helpers";

function shoe(id: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    kind: "shoes",
    name: "Pegasus",
    brand: "Nike",
    model: null,
    startDistanceM: 0,
    retireAtM: 800_000,
    stravaGearId: null,
    stravaGearName: null,
    retiredAt: null,
    createdAt: 1,
    updatedAt: 2,
    deletedAt: null,
    ...extra,
  };
}

function docWith(...ids: string[]) {
  return {
    version: 1,
    gear: ids.map((id) => shoe(id)),
    defaults: [{ sport: "run", gearId: ids[0] ?? null, since: 1, updatedAt: 2 }],
    assignments: [{ workoutStart: 1000, gearId: ids[0] ?? null, source: "default", updatedAt: 3 }],
  };
}

function put(body: unknown, cookie?: string, init: RequestInit = {}): Promise<Response> {
  return call("/v1/gear", {
    method: "PUT",
    body: typeof body === "string" ? body : JSON.stringify(body),
    headers: { "content-type": "application/json" },
    ...(cookie ? { cookie } : {}),
    ...init,
  });
}

async function stored(userId: string): Promise<{ doc: string; rev: number } | null> {
  return env.DB.prepare("SELECT doc, rev FROM gear_doc WHERE user_id = ?1").bind(userId).first<{ doc: string; rev: number }>();
}

describe("GET /v1/gear", () => {
  it("requires a session", async () => {
    expect((await call("/v1/gear")).status).toBe(401);
  });

  it("answers rev 0 and doc null when the user has none, also for a free account", async () => {
    const { cookie } = signUp("free-empty", { founder: false });
    const response = await call("/v1/gear", { cookie });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ rev: 0, doc: null });
  });
});

describe("PUT /v1/gear", () => {
  it("refuses a free account with 402 and stores nothing", async () => {
    const { user, cookie } = signUp("free-gear", { founder: false });
    const response = await put({ baseRev: 0, doc: docWith("a") }, cookie);
    expect(response.status).toBe(402);
    expect(await response.json()).toEqual({ error: "founder_required", paywall: true });
    expect(await stored(user.id)).toBeNull();
  });

  it("stores the doc for a Founder, bumps rev, and GET returns it with defaults filled and unknown keys kept", async () => {
    const { user, cookie } = signUp("founder-gear");
    const doc = { ...docWith("a"), futureField: { x: 1 } };
    doc.gear[0] = shoe("a", { extraGearKey: "kept" });
    const first = await put({ baseRev: 0, doc }, cookie);
    expect(first.status).toBe(200);
    expect(await first.json()).toEqual({ rev: 1 });

    const read = await call("/v1/gear", { cookie });
    expect(await read.json()).toEqual({
      rev: 1,
      doc: { ...doc, gear: [{ ...doc.gear[0], notified: 0 }] },
    });
    expect((await stored(user.id))?.rev).toBe(1);

    const second = await put({ baseRev: 1, doc: docWith("a", "b") }, cookie);
    expect(await second.json()).toEqual({ rev: 2 });
    const reread = (await (await call("/v1/gear", { cookie })).json()) as { rev: number; doc: { gear: unknown[] } };
    expect(reread.rev).toBe(2);
    expect(reread.doc.gear).toHaveLength(2);
  });

  it("answers 409 with the current state on a baseRev mismatch and overwrites nothing", async () => {
    const { user, cookie } = signUp("conflict");
    await put({ baseRev: 0, doc: docWith("a") }, cookie);
    const before = await stored(user.id);

    const stale = await put({ baseRev: 0, doc: docWith("z") }, cookie);
    expect(stale.status).toBe(409);
    const body = (await stale.json()) as { error: string; rev: number; doc: { gear: { id: string }[] } };
    expect(body.error).toBe("conflict");
    expect(body.rev).toBe(1);
    expect(body.doc.gear.map((g) => g.id)).toEqual(["a"]);

    const ahead = await put({ baseRev: 5, doc: docWith("z") }, cookie);
    expect(ahead.status).toBe(409);
    expect(await stored(user.id)).toEqual(before);
  });

  it("refuses a first write whose baseRev is not 0", async () => {
    const { user, cookie } = signUp("first-ahead");
    const response = await put({ baseRev: 3, doc: docWith("a") }, cookie);
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "conflict", rev: 0, doc: null });
    expect(await stored(user.id)).toBeNull();
  });

  it("lets only one of two PUTs with the same baseRev win", async () => {
    const { user, cookie } = signUp("race");
    const [a, b] = await Promise.all([put({ baseRev: 0, doc: docWith("a") }, cookie), put({ baseRev: 0, doc: docWith("b") }, cookie)]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    expect((await stored(user.id))?.rev).toBe(1);

    const third = await put({ baseRev: 1, doc: docWith("c") }, cookie);
    expect(third.status).toBe(200);
    const fourth = await put({ baseRev: 1, doc: docWith("d") }, cookie);
    expect(fourth.status).toBe(409);
    expect(((await fourth.json()) as { rev: number }).rev).toBe(2);
  });

  it("answers 400 for an invalid body", async () => {
    const { user, cookie } = signUp("invalid");
    const bad: unknown[] = [
      "not json",
      { doc: docWith("a") },
      { baseRev: -1, doc: docWith("a") },
      { baseRev: 0, doc: { ...docWith("a"), version: 2 } },
      { baseRev: 0, doc: { ...docWith("a"), gear: [shoe("a", { kind: "unicycle" })] } },
      { baseRev: 0, doc: { ...docWith("a"), gear: [shoe("")] } },
      { baseRev: 0, doc: { ...docWith("a"), gear: [shoe("a", { startDistanceM: -1 })] } },
      { baseRev: 0, doc: { ...docWith("a"), gear: [shoe("a", { notified: 3 })] } },
      { baseRev: 0, doc: { ...docWith("a"), assignments: [{ workoutStart: 1.5, gearId: null, source: "manual", updatedAt: 1 }] } },
      { baseRev: 0, doc: { ...docWith("a"), defaults: [{ sport: "swim", gearId: null, since: 1, updatedAt: 1 }] } },
      { baseRev: 0, doc: { ...docWith("a"), gear: Array.from({ length: 201 }, (_, i) => shoe(`g${i}`)) } },
    ];
    for (const body of bad) {
      expect((await put(body, cookie)).status, JSON.stringify(body).slice(0, 80)).toBe(400);
    }
    expect(await stored(user.id)).toBeNull();
  });

  it("answers 413 for a body over 1 MiB, declared or not", async () => {
    const { user, cookie } = signUp("big");
    const padding = "x".repeat(1_048_576);
    const declared = await put(JSON.stringify({ baseRev: 0, doc: docWith("a"), padding }), cookie);
    expect(declared.status).toBe(413);
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(JSON.stringify({ baseRev: 0, padding })));
        controller.close();
      },
    });
    const streamed = await call("/v1/gear", {
      method: "PUT",
      body: stream,
      headers: { "content-type": "application/json" },
      cookie,
      // @ts-expect-error duplex is required for stream bodies
      duplex: "half",
    });
    expect(streamed.status).toBe(413);
    expect(await stored(user.id)).toBeNull();
  });

  it("keeps each user's doc to themselves", async () => {
    const alice = signUp("gear-alice");
    const bob = signUp("gear-bob");
    await put({ baseRev: 0, doc: docWith("alice-shoe") }, alice.cookie);
    expect(await (await call("/v1/gear", { cookie: bob.cookie })).json()).toEqual({ rev: 0, doc: null });
    // Bob's first write is not blocked by Alice's rev.
    expect((await put({ baseRev: 0, doc: docWith("bob-shoe") }, bob.cookie)).status).toBe(200);
    const aliceDoc = (await (await call("/v1/gear", { cookie: alice.cookie })).json()) as { doc: { gear: { id: string }[] } };
    expect(aliceDoc.doc.gear.map((g) => g.id)).toEqual(["alice-shoe"]);
  });

  it("is removed by DELETE /v1/data and DELETE /v1/account, only for the caller", async () => {
    const carol = signUp("gear-carol");
    const dave = signUp("gear-dave");
    for (const who of [carol, dave]) await put({ baseRev: 0, doc: docWith("a") }, who.cookie);

    expect((await call("/v1/data", { method: "DELETE", cookie: carol.cookie })).status).toBe(200);
    expect(await stored(carol.user.id)).toBeNull();
    expect(await stored(dave.user.id)).not.toBeNull();
    expect(await (await call("/v1/gear", { cookie: carol.cookie })).json()).toEqual({ rev: 0, doc: null });

    grantApi.handler = () => Response.json({ revoked: true });
    await put({ baseRev: 0, doc: docWith("a") }, carol.cookie);
    expect((await call("/v1/account", { method: "DELETE", cookie: dave.cookie })).status).toBe(200);
    expect(await stored(dave.user.id)).toBeNull();
    expect(await stored(carol.user.id)).not.toBeNull();
  });
});

describe("PUT /v1/gear, a document that grows when stored", () => {
  it("answers 413 instead of a D1 error when re-serializing passes D1's 2 MB value cap (1e20 becomes 21 digits)", async () => {
    const { cookie } = signUp("gear-big");
    const head = JSON.stringify(docWith("a")).slice(0, -1);
    const body = `{"baseRev":0,"doc":${head},"extra":[${Array(180_000).fill("1e20").join(",")}]}}`;
    expect(body.length).toBeLessThan(1_048_576);
    const response = await put(body, cookie);
    expect(response.status).toBe(413);
  });
});

