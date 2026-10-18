import { z } from "zod";

import type { AppEnv } from "../env";

/** What JoyoRogo knows about a user that the evaluator needs and cannot get from a session cookie. */
export interface RogoUser {
  id: string;
  name: string;
  email: string;
  locale: string;
  /** JoyoRogo Pro (Founder), or any account on a server without a paywall. */
  pro: boolean;
}

const answerSchema = z.object({
  users: z.array(z.object({ id: z.string(), name: z.string(), email: z.string(), locale: z.string(), pro: z.boolean() })),
});

const CACHE_TTL_MS = 300_000;
const MAX_IDS = 50;
const cache = new Map<string, { user: RogoUser | null; expiresAt: number }>();

/** Test hook. */
export function clearRogoCache(): void {
  cache.clear();
}

/**
 * Asks JoyoRogo's `/internal/joyofit/family/users` (Basic auth with the Strava client credentials both Workers hold).
 * Answers are cached for five minutes per isolate. A JoyoRogo that cannot answer yields an empty map for the ids not
 * cached, so callers treat the person as not Pro and never block on it.
 */
export async function fetchRogoUsers(env: AppEnv, ids: string[], now: number = Date.now()): Promise<Map<string, RogoUser>> {
  const found = new Map<string, RogoUser>();
  const missing: string[] = [];
  for (const id of new Set(ids)) {
    const hit = cache.get(id);
    if (hit && hit.expiresAt > now) {
      if (hit.user) found.set(id, hit.user);
    } else missing.push(id);
  }
  if (missing.length === 0 || !env.STRAVA_CLIENT_ID || !env.STRAVA_CLIENT_SECRET) return found;
  for (let i = 0; i < missing.length; i += MAX_IDS) {
    const chunk = missing.slice(i, i + MAX_IDS);
    const url = `${env.JOYOROGO_AUTH_URL.replace(/\/+$/, "")}/internal/joyofit/family/users`;
    const request: RequestInit = {
      method: "POST",
      headers: {
        authorization: `Basic ${btoa(`${env.STRAVA_CLIENT_ID}:${env.STRAVA_CLIENT_SECRET}`)}`,
        "content-type": "application/json",
        accept: "application/json",
      },
      body: JSON.stringify({ userIds: chunk }),
      redirect: "manual",
      signal: AbortSignal.timeout(5_000),
    };
    try {
      const response = await (env.AUTH_SERVICE ? env.AUTH_SERVICE.fetch(url, request) : fetch(url, request));
      if (!response.ok) throw new Error(`answered ${response.status}`);
      const parsed = answerSchema.parse(await response.json());
      const byId = new Map(parsed.users.map((u) => [u.id, u]));
      for (const id of chunk) {
        const user = byId.get(id) ?? null;
        cache.set(id, { user, expiresAt: now + CACHE_TTL_MS });
        if (user) found.set(id, user);
      }
    } catch (error) {
      console.error(JSON.stringify({ event: "family_rogo_unavailable", message: error instanceof Error ? error.message : String(error) }));
    }
  }
  return found;
}
