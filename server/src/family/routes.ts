import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { createMiddleware } from "hono/factory";
import { z } from "zod";

import { sha256Hex } from "../auth";
import type { AppContext, AppEnv } from "../env";
import { chipFor, effectiveRules, pushTokens } from "./alerts";
import { evaluateOnIngest } from "./cron";
import { fetchRogoUsers, type RogoUser } from "./joyorogo";
import { sendExpoPush } from "./notify";
import { frozenLinkIds, maxWatching, MAX_WATCHERS } from "./plan";
import { localParts, restingBaseline, shiftDate } from "./rules";
import { deleteLink, effectiveStatus, getLink, historyDays, linksOf, loadDays, loadRules, loadState, unionScopes, type LinkRow } from "./store";
import { DAY_MS, HOUR_MS, NO_SCOPES, rulesSchema, scopesSchema, type Scopes } from "./types";

const INVITE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const INVITE_TTL_MS = 48 * HOUR_MS;
const POKE_THROTTLE_MS = HOUR_MS;
const MAX_DEVICE_TOKENS = 5;
const INVITE_URL = "https://fit.joyorogo.com/keluarga/";

const fail = (status: 400 | 402 | 403 | 404 | 409 | 429, message: string) => new HTTPException(status, { message });

function newInviteCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return Array.from(bytes, (b) => INVITE_ALPHABET[b % INVITE_ALPHABET.length]).join("");
}

const normalizeCode = (code: string) => code.trim().toUpperCase();
const hashCode = (code: string) => sha256Hex(`joyofit-family|${normalizeCode(code)}`);

const label = z.string().trim().min(1).max(40);

async function proOf(env: AppEnv, userId: string): Promise<boolean> {
  return (await fetchRogoUsers(env, [userId])).get(userId)?.pro ?? false;
}

function linkJson(link: LinkRow, me: string, now: number, others: Map<string, RogoUser>, frozen: boolean) {
  const watching = link.watcherId === me;
  const other = others.get(watching ? link.monitoredId : link.watcherId);
  return {
    id: link.id,
    role: watching ? ("watching" as const) : ("watchedBy" as const),
    label: link.label,
    otherName: other?.name ?? (watching ? link.label : "Seseorang"),
    status: effectiveStatus(link, now),
    scopes: link.scopes,
    pausedUntil: link.pausedUntil,
    acceptedAt: link.acceptedAt,
    lastViewedAt: link.lastViewedAt,
    frozen,
  };
}

async function requireOwnLink(env: AppEnv, id: string, me: string): Promise<{ link: LinkRow; asWatcher: boolean }> {
  const link = await getLink(env.DB, id);
  if (!link || (link.watcherId !== me && link.monitoredId !== me)) throw fail(404, "not_found");
  return { link, asWatcher: link.watcherId === me };
}

/** Blank the columns of categories no live link grants (a withdrawn category stops being stored at all). */
async function dropUngranted(env: AppEnv, monitoredId: string, now: number): Promise<void> {
  const { scopes } = unionScopes(await linksOf(env.DB, "monitored_id", monitoredId), now);
  const sets: string[] = [];
  if (!scopes.steps) sets.push("steps = NULL", "first_step_at = NULL");
  if (!scopes.sleep) sets.push("sleep_min = NULL");
  if (!scopes.restingHr) sets.push("resting_hr = NULL");
  if (!scopes.spo2) sets.push("spo2_min = NULL", "spo2_low_count = NULL");
  if (sets.length > 0) await env.DB.prepare(`UPDATE family_day SET ${sets.join(", ")} WHERE user_id = ?1`).bind(monitoredId).run();
}

export const family = new Hono<AppContext>();

// -- invites ---------------------------------------------------------------------------------------------------------

family.post("/invites", async (c) => {
  const user = c.get("user");
  const body = z.object({ role: z.enum(["watcher", "monitored"]), label }).parse(await c.req.json().catch(() => null));
  if (body.role === "watcher") {
    const count = (await linksOf(c.env.DB, "watcher_id", user.id)).length;
    if (count >= maxWatching(await proOf(c.env, user.id))) return c.json({ error: "limit_reached", pro: false }, 409);
  }
  const code = newInviteCode();
  const now = Date.now();
  await c.env.DB.prepare("INSERT INTO family_invite (code_hash, inviter_id, role, label, expires_at) VALUES (?1, ?2, ?3, ?4, ?5)")
    .bind(await hashCode(code), user.id, body.role, body.label, now + INVITE_TTL_MS)
    .run();
  return c.json({ code, url: `${INVITE_URL}${code}`, expiresAt: now + INVITE_TTL_MS });
});

interface InviteRow {
  inviter_id: string;
  role: "watcher" | "monitored";
  label: string;
  expires_at: number;
  used_at: number | null;
}

async function liveInvite(env: AppEnv, code: string, now: number): Promise<InviteRow> {
  const row = await env.DB.prepare("SELECT inviter_id, role, label, expires_at, used_at FROM family_invite WHERE code_hash = ?1").bind(await hashCode(code)).first<InviteRow>();
  if (!row || row.used_at !== null || row.expires_at <= now) throw fail(404, "invite_invalid");
  return row;
}

family.get("/invites/:code", async (c) => {
  const invite = await liveInvite(c.env, c.req.param("code"), Date.now());
  const inviter = (await fetchRogoUsers(c.env, [invite.inviter_id])).get(invite.inviter_id);
  return c.json({ inviterName: inviter?.name ?? "Seseorang", inviterRole: invite.role, label: invite.label, expiresAt: invite.expires_at });
});

family.post("/invites/accept", async (c) => {
  const user = c.get("user");
  const body = z.object({ code: z.string().min(1).max(32), label: label.optional() }).parse(await c.req.json().catch(() => null));
  const now = Date.now();
  const invite = await liveInvite(c.env, body.code, now);
  if (invite.inviter_id === user.id) throw fail(400, "own_invite");
  const watcherId = invite.role === "watcher" ? invite.inviter_id : user.id;
  const monitoredId = invite.role === "watcher" ? user.id : invite.inviter_id;
  const db = c.env.DB;
  if ((await db.prepare("SELECT 1 AS x FROM family_link WHERE monitored_id = ?1 AND watcher_id = ?2").bind(monitoredId, watcherId).first()) !== null) throw fail(409, "already_linked");
  if ((await linksOf(db, "watcher_id", watcherId)).length >= maxWatching(await proOf(c.env, watcherId))) return c.json({ error: "limit_reached", pro: false }, 409);
  if ((await linksOf(db, "monitored_id", monitoredId)).length >= MAX_WATCHERS) return c.json({ error: "limit_reached", pro: true }, 409);
  const used = await db.prepare("UPDATE family_invite SET used_at = ?2 WHERE code_hash = ?1 AND used_at IS NULL").bind(await hashCode(body.code), now).run();
  if (used.meta.changes !== 1) throw fail(404, "invite_invalid");
  const id = crypto.randomUUID();
  await db
    .prepare("INSERT INTO family_link (id, monitored_id, watcher_id, label, status, scopes, created_at) VALUES (?1, ?2, ?3, ?4, 'pending', ?5, ?6)")
    .bind(id, monitoredId, watcherId, body.label ?? invite.label, JSON.stringify(NO_SCOPES), now)
    .run();
  const link = (await getLink(db, id))!;
  const others = await fetchRogoUsers(c.env, [invite.inviter_id]);
  return c.json({ link: linkJson(link, user.id, now, others, false) });
});

// -- links -----------------------------------------------------------------------------------------------------------

family.get("/links", async (c) => {
  const me = c.get("user").id;
  const now = Date.now();
  const db = c.env.DB;
  const watching = await linksOf(db, "watcher_id", me);
  const watchedBy = await linksOf(db, "monitored_id", me);
  const users = await fetchRogoUsers(c.env, [me, ...watching.map((l) => l.monitoredId), ...watchedBy.map((l) => l.watcherId)], now);
  const pro = users.get(me)?.pro ?? false;
  const frozen = frozenLinkIds(watching, pro);
  const items = [];
  for (const link of watching) {
    const base = linkJson(link, me, now, users, frozen.has(link.id));
    let today: { steps: number | null; restingHr: number | null; sleepMin: number | null } | null = null;
    let baselineHr: number | null = null;
    let chip: "ok" | "check" | "nosync" = "nosync";
    let dataAt: number | null = null;
    if (base.status === "active" && !base.frozen) {
      const rules = effectiveRules(await loadRules(db, link.id), pro);
      ({ chip, dataAt } = await chipFor(db, link, rules, now));
      const state = await loadState(db, link.monitoredId);
      const date = localParts(now, state?.tzOffsetMin ?? 420).date;
      const rows = await loadDays(db, link.monitoredId, shiftDate(date, -14));
      const row = rows.find((d) => d.date === date);
      if (link.scopes.restingHr) baselineHr = restingBaseline(rows, date).restingHr;
      today = { steps: link.scopes.steps ? (row?.steps ?? null) : null, restingHr: link.scopes.restingHr ? (row?.restingHr ?? null) : null, sleepMin: link.scopes.sleep ? (row?.sleepMin ?? null) : null };
    }
    items.push({ ...base, dataAt, chip, today, baselineHr });
  }
  return c.json({
    watching: items,
    watchedBy: watchedBy.map((l) => linkJson(l, me, now, users, false)),
    limits: { pro, maxWatching: maxWatching(pro), maxWatchers: MAX_WATCHERS, historyDays: historyDays(pro) },
  });
});

const patchBody = z.object({
  scopes: scopesSchema.partial().optional(),
  pausedUntil: z.number().int().nullable().optional(),
  consent: z.literal(true).optional(),
  label: label.optional(),
});

family.patch("/links/:id", async (c) => {
  const me = c.get("user").id;
  const now = Date.now();
  const { link, asWatcher } = await requireOwnLink(c.env, c.req.param("id"), me);
  const body = patchBody.parse(await c.req.json().catch(() => null));
  const db = c.env.DB;
  if (asWatcher) {
    if (body.scopes || body.pausedUntil !== undefined || body.consent) throw fail(403, "monitored_only");
    if (body.label) await db.prepare("UPDATE family_link SET label = ?2 WHERE id = ?1").bind(link.id, body.label).run();
  } else {
    if (body.label) throw fail(403, "watcher_only");
    const scopes: Scopes = { ...link.scopes, ...body.scopes };
    if (body.scopes?.sync === false) throw fail(400, "sync_required");
    if (body.consent) {
      if (link.status !== "pending") throw fail(409, "not_pending");
      scopes.sync = true;
    }
    if (link.status === "pending" && !body.consent) {
      // Switches can be prepared on the consent screen, but nothing is live until `consent`.
      scopes.sync = false;
    }
    if (body.pausedUntil !== undefined && body.pausedUntil !== null && body.pausedUntil !== -1 && body.pausedUntil <= now) throw fail(400, "invalid_pause");
    await db
      .prepare("UPDATE family_link SET scopes = ?2, paused_until = ?3, status = ?4, accepted_at = COALESCE(accepted_at, ?5) WHERE id = ?1")
      .bind(link.id, JSON.stringify(scopes), body.pausedUntil === undefined ? link.pausedUntil : body.pausedUntil, body.consent ? "active" : link.status, body.consent ? now : null)
      .run();
    await dropUngranted(c.env, link.monitoredId, now);
  }
  const updated = (await getLink(db, link.id))!;
  const others = await fetchRogoUsers(c.env, [asWatcher ? updated.monitoredId : updated.watcherId]);
  return c.json({ link: linkJson(updated, me, now, others, false) });
});

family.delete("/links/:id", async (c) => {
  const { link } = await requireOwnLink(c.env, c.req.param("id"), c.get("user").id);
  await deleteLink(c.env, link);
  await dropUngranted(c.env, link.monitoredId, Date.now());
  return c.json({ deleted: true });
});

async function watcherLink(env: AppEnv, id: string, me: string): Promise<{ link: LinkRow; pro: boolean; frozen: boolean }> {
  const { link, asWatcher } = await requireOwnLink(env, id, me);
  if (!asWatcher) throw fail(403, "watcher_only");
  const pro = await proOf(env, me);
  return { link, pro, frozen: frozenLinkIds(await linksOf(env.DB, "watcher_id", me), pro).has(link.id) };
}

family.get("/links/:id/summary", async (c) => {
  const me = c.get("user").id;
  const now = Date.now();
  const { link, pro, frozen } = await watcherLink(c.env, c.req.param("id"), me);
  if (frozen) return c.json({ error: "frozen", paywall: true }, 402);
  const db = c.env.DB;
  const requested = Number(c.req.query("days") ?? "7");
  const days = Math.min([7, 30, 90].includes(requested) ? requested : 7, historyDays(pro));
  await db.prepare("UPDATE family_link SET last_viewed_at = ?2 WHERE id = ?1").bind(link.id, now).run();
  const rules = await loadRules(db, link.id);
  const status = effectiveStatus(link, now);
  const alerts = await db
    .prepare("SELECT id, rule, at, level, status, body FROM family_alert_log WHERE link_id = ?1 ORDER BY at DESC LIMIT 30")
    .bind(link.id)
    .all<{ id: string; rule: string; at: number; level: string; status: string; body: string }>();
  const others = await fetchRogoUsers(c.env, [link.monitoredId, me], now);
  const base = {
    link: linkJson({ ...link, lastViewedAt: now }, me, now, others, false),
    pro,
    rules,
    snoozeUntil: link.snoozeUntil !== null && link.snoozeUntil > now ? link.snoozeUntil : null,
    alerts: alerts.results.map((a) => ({ id: a.id, rule: a.rule, at: a.at, level: a.level, body: a.body })),
  };
  if (status !== "active") return c.json({ ...base, state: null, chip: "nosync", dataAt: null, days: [], baseline: { restingHr: null, days: 0 } });
  const state = await loadState(db, link.monitoredId);
  const today = localParts(now, state?.tzOffsetMin ?? 420).date;
  const rows = await loadDays(db, link.monitoredId, shiftDate(today, -Math.max(days, 21)));
  const { chip, dataAt } = await chipFor(db, link, effectiveRules(rules, pro), now);
  const from = shiftDate(today, -(days - 1));
  return c.json({
    ...base,
    state: state ? { phoneSeenAt: state.phoneSeenAt, watchSyncAt: state.watchSyncAt, battery: state.battery } : null,
    chip,
    dataAt,
    days: rows
      .filter((d) => d.date >= from)
      .map((d) => ({
        date: d.date,
        steps: link.scopes.steps ? d.steps : null,
        restingHr: link.scopes.restingHr ? d.restingHr : null,
        sleepMin: link.scopes.sleep ? d.sleepMin : null,
        spo2Min: link.scopes.spo2 ? d.spo2Min : null,
      })),
    baseline: link.scopes.restingHr ? restingBaseline(rows, today) : { restingHr: null, days: 0 },
  });
});

family.get("/links/:id/rules", async (c) => {
  const { link, pro } = await watcherLink(c.env, c.req.param("id"), c.get("user").id);
  return c.json({ rules: await loadRules(c.env.DB, link.id), pro });
});

family.put("/links/:id/rules", async (c) => {
  const { link, pro } = await watcherLink(c.env, c.req.param("id"), c.get("user").id);
  const next = rulesSchema.parse(await c.req.json().catch(() => null));
  const current = await loadRules(c.env.DB, link.id);
  if (!pro) {
    // Free changes only the "no sync" switch and hours; everything else must stay as it is.
    const same = JSON.stringify({ ...next, noSync: current.noSync }) === JSON.stringify(current);
    if (!same) return c.json({ error: "pro_required", paywall: true }, 402);
  }
  await c.env.DB.prepare("INSERT INTO family_rule (link_id, rules) VALUES (?1, ?2) ON CONFLICT (link_id) DO UPDATE SET rules = ?2").bind(link.id, JSON.stringify(next)).run();
  return c.json({ rules: next, pro });
});

family.post("/links/:id/snooze", async (c) => {
  const { link } = await watcherLink(c.env, c.req.param("id"), c.get("user").id);
  const { days } = z.object({ days: z.union([z.literal(1), z.literal(3), z.literal(7)]) }).parse(await c.req.json().catch(() => null));
  const snoozeUntil = Date.now() + days * DAY_MS;
  await c.env.DB.prepare("UPDATE family_link SET snooze_until = ?2 WHERE id = ?1").bind(link.id, snoozeUntil).run();
  return c.json({ snoozeUntil });
});

family.post("/links/:id/poke", async (c) => {
  const me = c.get("user");
  const now = Date.now();
  const { link } = await watcherLink(c.env, c.req.param("id"), me.id);
  if (effectiveStatus(link, now) !== "active") throw fail(409, "not_active");
  // Claim the slot first so two quick taps cannot both go out.
  const claimed = await c.env.DB.prepare("UPDATE family_link SET last_poked_at = ?2 WHERE id = ?1 AND (last_poked_at IS NULL OR last_poked_at <= ?3)").bind(link.id, now, now - POKE_THROTTLE_MS).run();
  if (claimed.meta.changes !== 1) {
    c.header("retry-after", String(Math.max(1, Math.ceil(((link.lastPokedAt ?? now) + POKE_THROTTLE_MS - now) / 1000))));
    throw fail(429, "poke_throttled");
  }
  const name = (await fetchRogoUsers(c.env, [me.id])).get(me.id)?.name ?? me.name ?? "Seseorang";
  const result = await sendExpoPush(c.env, await pushTokens(c.env.DB, link.monitoredId), {
    title: `${name} menanyakan kabarmu`,
    body: "Kalau sempat, kabari ya.",
    data: { type: "family_poke", linkId: link.id },
  });
  return c.json({ sent: result.delivered > 0 });
});

// -- the monitored person's phone ------------------------------------------------------------------------------------

family.get("/config", async (c) => {
  const now = Date.now();
  const links = await linksOf(c.env.DB, "monitored_id", c.get("user").id);
  const { scopes, enabled } = unionScopes(links, now);
  return c.json({ scopes, enabled, links: links.map((l) => ({ id: l.id, scopes: l.scopes, status: effectiveStatus(l, now) })) });
});

family.post("/device-token", async (c) => {
  const me = c.get("user").id;
  const body = z.object({ deviceId: z.string().min(8).max(64), label: z.string().max(60).optional() }).parse(await c.req.json().catch(() => null));
  const token = `fdt_${btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32)))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")}`;
  const db = c.env.DB;
  await db.batch([
    db.prepare("DELETE FROM family_device_token WHERE user_id = ?1 AND device_id = ?2").bind(me, body.deviceId),
    db.prepare("INSERT INTO family_device_token (token_hash, user_id, device_id, label, created_at) VALUES (?1, ?2, ?3, ?4, ?5)").bind(await sha256Hex(token), me, body.deviceId, body.label ?? null, Date.now()),
    db
      .prepare("DELETE FROM family_device_token WHERE user_id = ?1 AND token_hash NOT IN (SELECT token_hash FROM family_device_token WHERE user_id = ?1 ORDER BY created_at DESC LIMIT ?2)")
      .bind(me, MAX_DEVICE_TOKENS),
  ]);
  return c.json({ token });
});

const deviceIdOf = async (c: { req: { query: (k: string) => string | undefined; json: () => Promise<unknown> } }): Promise<string> => {
  const fromQuery = c.req.query("deviceId");
  if (fromQuery) return fromQuery;
  return z.object({ deviceId: z.string().min(8).max(64) }).parse(await c.req.json().catch(() => null)).deviceId;
};

family.delete("/device-token", async (c) => {
  await c.env.DB.prepare("DELETE FROM family_device_token WHERE user_id = ?1 AND device_id = ?2").bind(c.get("user").id, await deviceIdOf(c)).run();
  return c.json({ deleted: true });
});

family.put("/push-token", async (c) => {
  const body = z
    .object({ token: z.string().regex(/^Expo(nent)?PushToken\[.+\]$/), platform: z.enum(["ios", "android"]), deviceId: z.string().min(8).max(64) })
    .parse(await c.req.json().catch(() => null));
  const me = c.get("user").id;
  await c.env.DB.batch([
    // A token belongs to one person: a phone handed to someone else must not keep notifying the old account.
    c.env.DB.prepare("DELETE FROM family_push_token WHERE token = ?1 AND user_id != ?2").bind(body.token, me),
    c.env.DB
      .prepare("INSERT INTO family_push_token (user_id, device_id, token, platform, updated_at) VALUES (?1, ?2, ?3, ?4, ?5) ON CONFLICT (user_id, device_id) DO UPDATE SET token = ?3, platform = ?4, updated_at = ?5")
      .bind(me, body.deviceId, body.token, body.platform, Date.now()),
  ]);
  return c.json({ ok: true });
});

family.delete("/push-token", async (c) => {
  await c.env.DB.prepare("DELETE FROM family_push_token WHERE user_id = ?1 AND device_id = ?2").bind(c.get("user").id, await deviceIdOf(c)).run();
  return c.json({ deleted: true });
});

family.get("/me/last", async (c) => {
  const row = await c.env.DB.prepare("SELECT last_payload, last_payload_at FROM family_state WHERE user_id = ?1").bind(c.get("user").id).first<{ last_payload: string | null; last_payload_at: number | null }>();
  return c.json({ payload: row?.last_payload ?? null, at: row?.last_payload_at ?? null });
});

// -- ingest (device bearer token, no session) ------------------------------------------------------------------------

const dateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const ingestBody = z.object({
  sentAt: z.number().int().optional(),
  tzOffsetMin: z.number().int().min(-840).max(840),
  watchSyncAt: z.number().int().nullable(),
  battery: z.number().int().min(0).max(100).nullable(),
  days: z
    .array(
      z.object({
        date: dateString,
        steps: z.number().int().min(0).max(200_000).optional(),
        firstStepAt: z.number().int().optional(),
        restingHr: z.number().int().min(20).max(250).optional(),
        sleepMin: z.number().int().min(0).max(1_440).optional(),
        spo2Min: z.number().int().min(30).max(100).optional(),
        spo2LowCount: z.number().int().min(0).max(10_000).optional(),
        lastSampleAt: z.number().int().optional(),
      }),
    )
    .max(3),
});
const MAX_INGEST_BYTES = 16_384;

export const familyDevice = new Hono<AppContext>();

const requireDeviceToken = createMiddleware<AppContext & { Variables: { deviceUser: string } }>(async (c, next) => {
  const match = /^Bearer (fdt_[A-Za-z0-9_-]{20,})$/.exec(c.req.header("authorization") ?? "");
  if (!match?.[1]) return c.json({ error: "bad_token" }, 401);
  const hash = await sha256Hex(match[1]);
  const row = await c.env.DB.prepare("SELECT user_id FROM family_device_token WHERE token_hash = ?1").bind(hash).first<{ user_id: string }>();
  if (!row) return c.json({ error: "bad_token" }, 401);
  c.set("deviceUser", row.user_id);
  await c.env.DB.prepare("UPDATE family_device_token SET last_used_at = ?2 WHERE token_hash = ?1").bind(hash, Date.now()).run();
  await next();
});

familyDevice.put("/ingest", requireDeviceToken, async (c) => {
  const userId = c.get("deviceUser");
  const now = Date.now();
  const raw = await c.req.text();
  if (raw.length > MAX_INGEST_BYTES) throw fail(400, "too_large");
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    throw fail(400, "invalid_json");
  }
  const body = ingestBody.parse(json);
  const links = await linksOf(c.env.DB, "monitored_id", userId);
  const { scopes, enabled } = unionScopes(links, now);
  if (!enabled) return c.json({ error: "no_active_link" }, 403);
  const db = c.env.DB;
  const earliest = Date.parse(`${localParts(now, body.tzOffsetMin).date}T00:00:00Z`) - 7 * DAY_MS;
  const statements = body.days
    .filter((d) => Date.parse(`${d.date}T00:00:00Z`) >= earliest && d.date <= shiftDate(localParts(now, body.tzOffsetMin).date, 1))
    .map((d) =>
      db
        .prepare(
          `INSERT INTO family_day (user_id, date, steps, first_step_at, resting_hr, sleep_min, spo2_min, spo2_low_count, last_sample_at, updated_at)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)
           ON CONFLICT (user_id, date) DO UPDATE SET
             steps = COALESCE(?3, steps), first_step_at = COALESCE(?4, first_step_at), resting_hr = COALESCE(?5, resting_hr),
             sleep_min = COALESCE(?6, sleep_min), spo2_min = COALESCE(?7, spo2_min), spo2_low_count = COALESCE(?8, spo2_low_count),
             last_sample_at = COALESCE(?9, last_sample_at), updated_at = ?10`,
        )
        .bind(
          userId,
          d.date,
          scopes.steps ? (d.steps ?? null) : null,
          scopes.steps ? (d.firstStepAt ?? null) : null,
          scopes.restingHr ? (d.restingHr ?? null) : null,
          scopes.sleep ? (d.sleepMin ?? null) : null,
          scopes.spo2 ? (d.spo2Min ?? null) : null,
          scopes.spo2 ? (d.spo2LowCount ?? null) : null,
          d.lastSampleAt ?? null,
          now,
        ),
    );
  statements.push(
    db
      .prepare(
        `INSERT INTO family_state (user_id, phone_seen_at, watch_sync_at, battery, tz_offset_min, last_payload, last_payload_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?2)
         ON CONFLICT (user_id) DO UPDATE SET phone_seen_at = ?2, watch_sync_at = COALESCE(?3, watch_sync_at), battery = COALESCE(?4, battery),
           tz_offset_min = ?5, last_payload = ?6, last_payload_at = ?2`,
      )
      .bind(userId, now, body.watchSyncAt, body.battery, body.tzOffsetMin, raw),
  );
  await db.batch(statements);
  c.executionCtx.waitUntil(evaluateOnIngest(c.env, userId, now));
  return c.json({ ok: true, config: { scopes, enabled } });
});

