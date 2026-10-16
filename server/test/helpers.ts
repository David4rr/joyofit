import { createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { afterEach, beforeEach, vi } from "vitest";

import app from "../src";
import { clearAccessCache } from "../src/access";
import { clearAuthCache } from "../src/auth";
import type { AppEnv } from "../src/env";

export interface FakeUser {
  id: string;
  email: string;
  name: string;
}

/** The sessions the fake JoyoRogo knows: token -> user. */
const sessions = new Map<string, FakeUser>();
/** Users whose JoyoRogo account counts as Founder (`fitness.cloudAccess` says `unlocked`). */
const founders = new Set<string>();
export const upstream = {
  calls: [] as { url: string; cookie: string | null }[],
  failWith: null as number | null,
  /** Status the fake `fitness/cloudAccess` answers instead of the real answer; null = normal. */
  accessFailWith: null as number | null,
};

/** What the fake Strava saw, and how it answers: set `handler` per test; it receives the URL and the request init. */
export const stravaUpstream = {
  calls: [] as { url: string; method: string; headers: Headers; body: string }[],
  handler: null as ((url: string, init: RequestInit) => Response) | null,
};

let counter = 0;
/** Registers a user and returns the Cookie header the app would send for them. Founder unless `founder` is false. */
export function signUp(name: string, { founder = true }: { founder?: boolean } = {}): { user: FakeUser; cookie: string } {
  counter += 1;
  const user = { id: `user-${name}-${counter}`, email: `${name}-${counter}@example.com`, name };
  const token = `token-${name}-${counter}`;
  sessions.set(token, user);
  if (founder) founders.add(user.id);
  return { user, cookie: `__Secure-better-auth.session_token=${token}.sig` };
}

/** What JoyoRogo's `/api/auth/get-session` answers for a Cookie header. */
export function fakeGetSession(cookie: string | null): Response {
  if (upstream.failWith) return new Response("boom", { status: upstream.failWith });
  const match = /session_token=(token-[^.;]+)/.exec(cookie ?? "");
  const user = match?.[1] ? sessions.get(match[1]) : undefined;
  if (!user) return Response.json(null);
  return Response.json({
    user,
    session: { id: "s", userId: user.id, expiresAt: new Date(Date.now() + 3_600_000).toISOString() },
  });
}

/** What JoyoRogo's oRPC `fitness/cloudAccess` answers for a Cookie header. */
export function fakeCloudAccess(cookie: string | null): Response {
  if (upstream.accessFailWith) return new Response("boom", { status: upstream.accessFailWith });
  const match = /session_token=(token-[^.;]+)/.exec(cookie ?? "");
  const user = match?.[1] ? sessions.get(match[1]) : undefined;
  if (!user) return Response.json({ json: { defined: false, code: "UNAUTHORIZED", status: 401 } }, { status: 401 });
  const unlocked = founders.has(user.id);
  return Response.json({ json: { unlocked, tier: unlocked ? "founder" : "free" } });
}

/** The fake JoyoRogo as a whole: routes by URL like the real server. */
export function fakeJoyorogo(url: string, cookie: string | null): Response {
  return url.endsWith("/rpc/fitness/cloudAccess") ? fakeCloudAccess(cookie) : fakeGetSession(cookie);
}

beforeEach(() => {
  clearAuthCache();
  clearAccessCache();
  upstream.calls = [];
  upstream.failWith = null;
  upstream.accessFailWith = null;
  stravaUpstream.calls = [];
  stravaUpstream.handler = null;
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    if (String(input).startsWith("https://www.strava.com/")) {
      stravaUpstream.calls.push({
        url: String(input),
        method: init?.method ?? "GET",
        headers: new Headers(init?.headers),
        body: String(init?.body ?? ""),
      });
      if (!stravaUpstream.handler) throw new Error(`unexpected Strava call: ${String(input)}`);
      return stravaUpstream.handler(String(input), init ?? {});
    }
    const headers = new Headers(init?.headers);
    upstream.calls.push({ url: String(input), cookie: headers.get("cookie") });
    return fakeJoyorogo(String(input), headers.get("cookie"));
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

export async function call(
  path: string,
  init: RequestInit & { cookie?: string; env?: Partial<AppEnv> } = {},
): Promise<Response> {
  const { cookie, env: overrides, ...rest } = init;
  const headers = new Headers(rest.headers);
  if (cookie) headers.set("cookie", cookie);
  const ctx = createExecutionContext();
  const response = await app.fetch(new Request(`https://api.test${path}`, { ...rest, headers }), { ...env, ...overrides }, ctx);
  await waitOnExecutionContext(ctx);
  return response;
}

export function postJson(path: string, body: unknown, cookie?: string): Promise<Response> {
  return call(path, {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
    ...(cookie ? { cookie } : {}),
  });
}

export { env };
