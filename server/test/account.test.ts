import { describe, expect, it } from "vitest";

import { call, env, grantApi, signUp } from "./helpers";

async function seed(userId: string) {
  await env.DB.batch([
    env.DB.prepare("INSERT INTO user_state (user_id, rev, last_sync_at) VALUES (?1, 1, 1)").bind(userId),
    env.DB.prepare(
      "INSERT INTO step_samples (user_id, timestamp, steps, calories, distance, rev, updated_at) VALUES (?1, 60, 5, 1, 1, 1, 1)",
    ).bind(userId),
    env.DB.prepare(
      "INSERT INTO sleep_segments (user_id, start, \"end\", type, rev, updated_at) VALUES (?1, 1, 2, 1, 1, 1)",
    ).bind(userId),
    env.DB.prepare(
      `INSERT INTO workouts (user_id, start, workout_number, "end", sport_type, sport_name, duration, distance, calories, steps, summary_json, complete, point_count, rev, updated_at)
       VALUES (?1, 10, 1, 20, 1, 'Run', 10, 1, 1, 1, '{}', 1, 1, 1, 1)`,
    ).bind(userId),
    env.DB.prepare("INSERT INTO workout_points (user_id, workout_start, seq, ts) VALUES (?1, 10, 0, 10)").bind(userId),
    env.DB.prepare("INSERT INTO device (user_id, address, name, rev, updated_at) VALUES (?1, 'AA', 'Watch', 1, 1)").bind(userId),
    env.DB.prepare(
      "INSERT INTO imports (id, user_id, r2_key, status, created_at) VALUES (?1, ?2, ?3, 'uploaded', 1)",
    ).bind(`import-${userId}`, userId, `imports/${userId}/file`),
  ]);
  await env.IMPORTS.put(`imports/${userId}/file`, "zip");
}

async function rows(table: string, userId: string): Promise<number> {
  const row = await env.DB.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE user_id = ?1`).bind(userId).first<{ n: number }>();
  return row?.n ?? 0;
}

const TABLES = ["user_state", "step_samples", "sleep_segments", "workouts", "workout_points", "device", "imports"];

describe("DELETE /v1/account", () => {
  it("requires a session", async () => {
    expect((await call("/v1/account", { method: "DELETE" })).status).toBe(401);
  });

  it("deletes the caller's rows and files and leaves other users alone", async () => {
    const alice = signUp("alice");
    const bob = signUp("bob");
    await seed(alice.user.id);
    await seed(bob.user.id);
    grantApi.handler = () => Response.json({ revoked: true });

    const response = await call("/v1/account", { method: "DELETE", cookie: alice.cookie });
    expect(grantApi.calls.map((c) => [c.action, c.body.userId])).toEqual([["disconnect", alice.user.id]]);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ deleted: true });

    for (const table of TABLES) {
      expect(await rows(table, alice.user.id), table).toBe(0);
      expect(await rows(table, bob.user.id), table).toBe(1);
    }
    expect(await env.IMPORTS.get(`imports/${alice.user.id}/file`)).toBeNull();
    expect(await env.IMPORTS.get(`imports/${bob.user.id}/file`)).not.toBeNull();
  });

  it("works for an account with nothing stored", async () => {
    const { cookie } = signUp("carol");
    grantApi.handler = () => Response.json({ revoked: true });
    expect((await call("/v1/account", { method: "DELETE", cookie })).status).toBe(200);
  });
});
