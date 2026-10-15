import { createMiddleware } from "hono/factory";
import { z } from "zod";

import { AuthUnavailableError, callJoyorogo, sessionCookies, sha256Hex } from "./auth";
import type { AppContext, AppEnv } from "./env";
import { ACCESS_CACHE_TTL_MS, ACCESS_LOCKED_CACHE_TTL_MS, AUTH_CACHE_MAX_ENTRIES } from "./limits";

/** The answer of JoyoRogo's `fitness.cloudAccess`: Founder, or any account on a server that has no paywall. */
const accessSchema = z.object({ json: z.object({ unlocked: z.boolean() }) });

interface CacheEntry {
  unlocked: boolean;
  expiresAt: number;
}

/** Per-isolate cache keyed by a hash of the session cookies, like the session cache in auth.ts. Failures are never cached. */
const known = new Map<string, CacheEntry>();

/** Test hook: forget every access answer. */
export function clearAccessCache(): void {
  known.clear();
}

function remember(key: string, unlocked: boolean, now: number): void {
  if (known.size >= AUTH_CACHE_MAX_ENTRIES) {
    for (const [k, v] of known) if (v.expiresAt <= now) known.delete(k);
    if (known.size >= AUTH_CACHE_MAX_ENTRIES) {
      const oldest = known.keys().next();
      if (!oldest.done) known.delete(oldest.value);
    }
  }
  known.set(key, { unlocked, expiresAt: now + (unlocked ? ACCESS_CACHE_TTL_MS : ACCESS_LOCKED_CACHE_TTL_MS) });
}

/**
 * Whether the account behind this session may upload (JoyoRogo Founder). Asks JoyoRogo's oRPC `fitness/cloudAccess`
 * with the forwarded session cookies; the decision (tier, paid period, no-paywall self-host) stays JoyoRogo's.
 * Returns null when JoyoRogo no longer knows the session. Throws AuthUnavailableError when JoyoRogo cannot answer,
 * so an outage never reads as "not Founder" and never unlocks anything.
 */
export async function cloudUnlocked(env: AppEnv, cookieHeader: string | null): Promise<boolean | null> {
  const cookie = sessionCookies(cookieHeader);
  if (!cookie) return null;
  const key = await sha256Hex(cookie);
  const now = Date.now();
  const hit = known.get(key);
  if (hit && hit.expiresAt > now) return hit.unlocked;
  known.delete(key);

  const response = await callJoyorogo(env, "/rpc/fitness/cloudAccess", cookie, { method: "POST", body: JSON.stringify({ json: {} }) });
  if (response.status === 401 || response.status === 403) {
    await response.body?.cancel();
    return null;
  }
  if (!response.ok) {
    await response.body?.cancel();
    throw new AuthUnavailableError(`JoyoRogo cloudAccess answered ${response.status}`);
  }
  let json: unknown;
  try {
    json = await response.json();
  } catch {
    throw new AuthUnavailableError("JoyoRogo cloudAccess answered with invalid JSON");
  }
  const parsed = accessSchema.safeParse(json);
  if (!parsed.success) throw new AuthUnavailableError("JoyoRogo cloudAccess answered with an unexpected shape");
  remember(key, parsed.data.json.unlocked, now);
  return parsed.data.json.unlocked;
}

/** What a non-Founder gets on a write: 402 with `paywall: true`, so a client can show the upgrade offer instead of an error. */
export const FOUNDER_REQUIRED = { error: "founder_required", paywall: true } as const;

/** Rejects with 402 unless the caller's JoyoRogo account may use the cloud. Mount after `requireUser`, on writes only. */
export const requireFounder = createMiddleware<AppContext>(async (c, next) => {
  let unlocked: boolean | null;
  try {
    unlocked = await cloudUnlocked(c.env, c.req.header("cookie") ?? null);
  } catch (error) {
    if (error instanceof AuthUnavailableError) {
      console.error(JSON.stringify({ event: "access_unavailable", message: error.message }));
      return c.json({ error: "auth_unavailable" }, 503);
    }
    throw error;
  }
  if (unlocked === null) return c.json({ error: "unauthorized" }, 401);
  if (!unlocked) return c.json(FOUNDER_REQUIRED, 402);
  await next();
});
