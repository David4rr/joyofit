import { Hono } from "hono";
import { cors } from "hono/cors";
import { z } from "zod";

import {
  CODE_LENGTH,
  CODE_TTL_MS,
  isRoomCode,
  type CreateRoomResponse,
  type JoinRoomResponse,
} from "../../../src/features/ride/protocol";
import { requireUser, sha256Hex } from "../auth";
import { readJson } from "../body";
import type { AppContext, AppEnv } from "../env";
import { CODE_DRAWS, LIMIT_CREATE_PER_IP, LIMIT_JOIN_PER_IP, LIMIT_JOIN_PER_USER, LIMIT_WS_PER_IP } from "./limits";

/**
 * "Ride on the web" relay routes (docs/ride.md). The phone is the sensor bridge, the web page is the game; a room is one Durable
 * Object (`RideRoom`) per ride, found by a six digit code (`RideIndex`, one instance per code) for the phone and by its id for
 * everything after.
 *
 * - `POST /ride/rooms`: the web opens a room. Public (no login), CORS open, rate limited per IP.
 * - `POST /ride/rooms/join {code}`: the phone joins with its JoyoRogo session. Not CORS: only the app calls it.
 * - `GET /ride/rooms/:roomId/ws?role=phone|web&token=...`: the WebSocket, for both roles.
 */
export const ride = new Hono<AppContext>();

ride.use(
  "/rooms",
  cors({ origin: "*", allowMethods: ["POST", "OPTIONS"], allowHeaders: ["content-type"], maxAge: 86_400 }),
);

/** `cf-connecting-ip`, hashed: the limiter's key never holds an address. */
function clientKey(ip: string | undefined): Promise<string> {
  return sha256Hex(`joyofit-ride|${ip ?? "unknown"}`);
}

/** Counts a call against `<scope>:<who>`; a refusal is the `429` to return, else null. */
async function overLimit(env: AppEnv, scope: string, who: string, rule: { max: number; windowMs: number }, now: number): Promise<{ retryAfterS: number } | null> {
  const result = await env.RIDE_INDEX.getByName(`rl:${scope}:${who}`).hit(rule.max, rule.windowMs, now);
  return result.ok ? null : { retryAfterS: Math.max(1, Math.ceil(result.retryAfterMs / 1000)) };
}

/** A uniformly random six digit code (rejection sampling, so no digit is likelier). */
function randomCode(): string {
  const limit = 4_294_967_296 - (4_294_967_296 % 1_000_000);
  const buffer = new Uint32Array(1);
  do crypto.getRandomValues(buffer);
  while ((buffer[0] ?? 0) >= limit);
  return String((buffer[0] ?? 0) % 1_000_000).padStart(CODE_LENGTH, "0");
}

ride.post("/rooms", async (c) => {
  const now = Date.now();
  const key = await clientKey(c.req.header("cf-connecting-ip"));
  const limited = await overLimit(c.env, "create", key, LIMIT_CREATE_PER_IP, now);
  if (limited) return c.json({ error: "rate_limited" }, 429, { "retry-after": String(limited.retryAfterS) });

  const id = c.env.RIDE_ROOM.newUniqueId();
  const roomId = id.toString();
  const { webToken } = await c.env.RIDE_ROOM.get(id).open(now);
  for (let draw = 0; draw < CODE_DRAWS; draw++) {
    const code = randomCode();
    if (await c.env.RIDE_INDEX.getByName(`code:${code}`).claim(roomId, CODE_TTL_MS, now)) {
      return c.json({ roomId, code, token: webToken, codeExpiresAt: now + CODE_TTL_MS } satisfies CreateRoomResponse);
    }
  }
  return c.json({ error: "no_free_code" }, 503);
});

const joinSchema = z.object({ code: z.string().refine(isRoomCode) });

ride.post("/rooms/join", requireUser, async (c) => {
  const now = Date.now();
  const user = c.get("user");
  const parsed = joinSchema.safeParse(await readJson(c.req.raw, 256));
  if (!parsed.success) return c.json({ error: "invalid_code" }, 400);

  const byUser = await overLimit(c.env, "join-user", user.id, LIMIT_JOIN_PER_USER, now);
  const byIp = byUser ?? (await overLimit(c.env, "join-ip", await clientKey(c.req.header("cf-connecting-ip")), LIMIT_JOIN_PER_IP, now));
  if (byIp) return c.json({ error: "rate_limited" }, 429, { "retry-after": String(byIp.retryAfterS) });

  const roomId = await c.env.RIDE_INDEX.getByName(`code:${parsed.data.code}`).resolve(now);
  if (!roomId) return c.json({ error: "code_not_found" }, 404);
  let stub;
  try {
    stub = c.env.RIDE_ROOM.get(c.env.RIDE_ROOM.idFromString(roomId));
  } catch {
    return c.json({ error: "code_not_found" }, 404);
  }
  const joined = await stub.joinPhone(user.id, now);
  if (!joined.ok) return c.json({ error: joined.error === "taken" ? "room_taken" : "code_not_found" }, joined.error === "taken" ? 409 : 404);
  return c.json({ roomId, token: joined.token } satisfies JoinRoomResponse);
});

ride.get("/rooms/:roomId/ws", async (c) => {
  if (c.req.header("upgrade")?.toLowerCase() !== "websocket") return c.json({ error: "websocket_required" }, 426);
  const role = c.req.query("role");
  const token = c.req.query("token");
  if ((role !== "phone" && role !== "web") || !token) return c.json({ error: "invalid_request" }, 400);
  const limited = await overLimit(c.env, "ws", await clientKey(c.req.header("cf-connecting-ip")), LIMIT_WS_PER_IP, Date.now());
  if (limited) return c.json({ error: "rate_limited" }, 429, { "retry-after": String(limited.retryAfterS) });
  let id: DurableObjectId;
  try {
    id = c.env.RIDE_ROOM.idFromString(c.req.param("roomId"));
  } catch {
    return c.json({ error: "room_not_found" }, 404);
  }
  return c.env.RIDE_ROOM.get(id).fetch(c.req.raw);
});
