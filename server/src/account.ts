import { Hono } from "hono";

import type { AppContext, AppEnv } from "./env";
import { deleteFamilyData } from "./family/store";
import { dropStravaConnection } from "./strava";

/** Every table with a `user_id` column. `user_state` goes last so a half-finished deletion can still be repeated. */
const USER_TABLES = ["workout_points", "workouts", "step_samples", "sleep_segments", "device", "imports", "user_state"] as const;

/** Deletes the objects under `imports/<user id>/` in pages; R2 lists at most 1000 keys per call. */
async function deleteImportFiles(env: AppEnv, userId: string): Promise<void> {
  const prefix = `imports/${userId}/`;
  for (let cursor: string | undefined; ; ) {
    const page = await env.IMPORTS.list({ prefix, cursor });
    if (page.objects.length > 0) await env.IMPORTS.delete(page.objects.map((o) => o.key));
    if (!page.truncated) return;
    cursor = page.cursor;
  }
}

/** Everything JoyoFit holds for one JoyoRogo user: synced rows, imported files, the Strava connection, family links (both roles). Repeatable. */
export async function deleteUserData(env: AppEnv, userId: string): Promise<void> {
  await dropStravaConnection(env, userId);
  await deleteFamilyData(env, userId);
  await deleteImportFiles(env, userId);
  await env.DB.batch(USER_TABLES.map((table) => env.DB.prepare(`DELETE FROM ${table} WHERE user_id = ?1`).bind(userId)));
}

/**
 * `DELETE /v1/account` — wipes this user's JoyoFit cloud data (the app calls it before it deletes the JoyoRogo
 * account itself, App Store 5.1.1(v)). Mounted under `/v1`, behind `requireUser`.
 */
export const account = new Hono<AppContext>();

account.delete("/", async (c) => {
  await deleteUserData(c.env, c.get("user").id);
  return c.json({ deleted: true });
});
