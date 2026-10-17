import type { AppEnv } from "../env";
import { fetchRogoUsers } from "./joyorogo";
import { sendExpoPush, sendFamilyEmail } from "./notify";
import { chipOf, dataAt, evaluate, localParts, nextCheckAt, shiftDate, type EvalInput, type Finding, type Verdict } from "./rules";
import { effectiveStatus, loadDays, loadRules, loadState, type LinkRow } from "./store";
import { DAY_MS, type Rules } from "./types";

/** WIB: the watcher's clock for quiet hours, the daily push cap and the 19:00 digest. */
const WATCHER_TZ_MIN = 420;
export const MAX_PUSHES_PER_DAY = 3;
const RULE_COOLDOWN_MS = DAY_MS;

const minutesOf = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3));

/** Next time the quiet hours end, as an instant: today's `quietEnd` WIB if still ahead, else tomorrow's. */
export function quietUntil(now: number, rules: Rules): number | null {
  const { minutes, date } = localParts(now, WATCHER_TZ_MIN);
  const start = minutesOf(rules.quietStart);
  const end = minutesOf(rules.quietEnd);
  const inQuiet = start > end ? minutes >= start || minutes < end : minutes >= start && minutes < end;
  if (!inQuiet) return null;
  const endDate = start > end && minutes >= start ? shiftDate(date, 1) : date;
  return Date.parse(`${endDate}T00:00:00Z`) + end * 60_000 - WATCHER_TZ_MIN * 60_000;
}

interface AlertState {
  open_since: number | null;
  clear_since: number | null;
  last_sent_at: number | null;
}

async function loadAlertStates(db: D1Database, linkId: string): Promise<Map<string, AlertState>> {
  const { results } = await db.prepare("SELECT rule, open_since, clear_since, last_sent_at FROM family_alert_state WHERE link_id = ?1").bind(linkId).all<AlertState & { rule: string }>();
  return new Map(results.map((r) => [r.rule, r]));
}

async function saveAlertState(db: D1Database, linkId: string, slot: string, patch: { openSince: number | null; clearSince: number | null; lastSentAt?: number }): Promise<void> {
  await db
    .prepare(
      `INSERT INTO family_alert_state (link_id, rule, open_since, clear_since, last_sent_at, count) VALUES (?1, ?2, ?3, ?4, ?5, ?6)
       ON CONFLICT (link_id, rule) DO UPDATE SET open_since = ?3, clear_since = ?4,
         last_sent_at = COALESCE(?5, last_sent_at), count = count + ?6`,
    )
    .bind(linkId, slot, patch.openSince, patch.clearSince, patch.lastSentAt ?? null, patch.lastSentAt === undefined ? 0 : 1)
    .run();
}

/** Pushes already used today (WIB) by this watcher, queued ones included. */
async function pushesToday(db: D1Database, watcherId: string, now: number): Promise<number> {
  const { date } = localParts(now, WATCHER_TZ_MIN);
  const from = Date.parse(`${date}T00:00:00Z`) - WATCHER_TZ_MIN * 60_000;
  const row = await db
    .prepare("SELECT COUNT(*) AS n FROM family_alert_log WHERE watcher_id = ?1 AND level = 'push' AND status IN ('sent', 'queued') AND at >= ?2")
    .bind(watcherId, from)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

export interface LinkContext {
  link: LinkRow;
  rules: Rules;
  pro: boolean;
}

/** Free keeps only the "no sync" push: every other rule, email and the digest need Pro. */
export function effectiveRules(rules: Rules, pro: boolean): Rules {
  if (pro) return rules;
  return {
    ...rules,
    restingHr: { on: false },
    noSteps: { ...rules.noSteps, on: false },
    sleep: { on: false },
    spo2: { on: false },
    push: true,
    email: false,
  };
}

interface Delivered {
  channels: string[];
}

async function removeDeadTokens(env: AppEnv, userId: string, dead: string[]): Promise<void> {
  for (const token of dead) await env.DB.prepare("DELETE FROM family_push_token WHERE user_id = ?1 AND token = ?2").bind(userId, token).run();
}

export async function pushTokens(db: D1Database, userId: string): Promise<string[]> {
  const { results } = await db.prepare("SELECT token FROM family_push_token WHERE user_id = ?1").bind(userId).all<{ token: string }>();
  return results.map((r) => r.token);
}

/** Sends one alert on the channels the watcher chose. Email is Pro only; it is the fallback when push reached nobody. */
export async function deliver(env: AppEnv, watcherId: string, rules: Rules, pro: boolean, title: string, lines: string[], data: Record<string, string>): Promise<Delivered> {
  const channels: string[] = [];
  if (rules.push) {
    const tokens = await pushTokens(env.DB, watcherId);
    const result = await sendExpoPush(env, tokens, { title, body: lines[0] ?? "", data });
    await removeDeadTokens(env, watcherId, result.dead);
    if (result.delivered > 0) channels.push("push");
  }
  if (pro && (rules.email || (rules.push && channels.length === 0))) {
    const users = await fetchRogoUsers(env, [watcherId]);
    const email = users.get(watcherId)?.email;
    if (email && (await sendFamilyEmail(env, email, title, lines))) channels.push("email");
  }
  return { channels };
}

/** Takes the claim for this finding and delivers it. False when it was snoozed or already claimed. */
async function fire(env: AppEnv, ctx: LinkContext, finding: Finding, now: number): Promise<boolean> {
  const { link, rules, pro } = ctx;
  const db = env.DB;
  if (link.snoozeUntil !== null && link.snoozeUntil > now) return false;
  let level = finding.level;
  if (level === "push" && (await pushesToday(db, link.watcherId, now)) >= MAX_PUSHES_PER_DAY) level = "digest";
  const queuedUntil = level === "push" ? quietUntil(now, rules) : null;
  const status = level === "digest" ? "digest" : queuedUntil === null ? "sent" : "queued";
  // The claim: only the run that inserts this row sends anything.
  const id = crypto.randomUUID();
  const claimed = await db
    .prepare("INSERT OR IGNORE INTO family_alert_log (id, link_id, watcher_id, rule, dedupe_key, at, level, status, send_after, title, body) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)")
    .bind(id, link.id, link.watcherId, finding.rule, finding.key, now, level, status, queuedUntil, finding.title, finding.body)
    .run();
  if (claimed.meta.changes !== 1) return false;
  if (status !== "sent") return true;
  const delivered = await deliver(env, link.watcherId, rules, pro, finding.title, [finding.body], { type: "family_alert", linkId: link.id, rule: finding.rule });
  await db
    .prepare("UPDATE family_alert_log SET channels = ?2, status = ?3 WHERE id = ?1")
    .bind(id, delivered.channels.join(","), delivered.channels.length > 0 ? "sent" : "failed")
    .run();
  return true;
}

async function apply(env: AppEnv, ctx: LinkContext, verdicts: Verdict[], now: number): Promise<void> {
  const states = await loadAlertStates(env.DB, ctx.link.id);
  for (const verdict of verdicts) {
    if (verdict.active === null) continue;
    const state = states.get(verdict.slot);
    const open = state?.open_since ?? null;
    if (!verdict.active) {
      if (open === null) continue;
      if (state?.clear_since == null) await saveAlertState(env.DB, ctx.link.id, verdict.slot, { openSince: open, clearSince: now });
      else if (now - state.clear_since >= DAY_MS) await saveAlertState(env.DB, ctx.link.id, verdict.slot, { openSince: null, clearSince: null });
      continue;
    }
    const finding = verdict.finding;
    if (!finding) continue;
    // "No sync" repeats on its own schedule (24 h and 72 h are new keys); every other rule stays quiet while its episode is open.
    if (open !== null && verdict.slot !== "noSync") {
      if (state?.clear_since != null) await saveAlertState(env.DB, ctx.link.id, verdict.slot, { openSince: open, clearSince: null });
      continue;
    }
    // One push per rule per 24 h.
    if (verdict.slot !== "noSync" && state?.last_sent_at != null && now - state.last_sent_at < RULE_COOLDOWN_MS) continue;
    if (await fire(env, ctx, finding, now)) await saveAlertState(env.DB, ctx.link.id, verdict.slot, { openSince: open ?? now, clearSince: null, lastSentAt: now });
  }
}

export interface EvaluateOptions {
  /** Cron run: only the absence rules (no sync, no steps). Ingest runs everything. */
  absenceOnly?: boolean;
  /** Whether this watcher is Pro; looked up when omitted. */
  pro?: boolean;
  /** Whether the watcher's link is within their plan (not frozen). */
  frozen?: boolean;
}

/** Evaluates one link now, sends what is due and schedules the next absence check. */
export async function evaluateLink(env: AppEnv, link: LinkRow, now: number, options: EvaluateOptions = {}): Promise<void> {
  if (effectiveStatus(link, now) !== "active") return;
  const pro = options.pro ?? (await fetchRogoUsers(env, [link.watcherId], now)).get(link.watcherId)?.pro ?? false;
  const stored = await loadRules(env.DB, link.id);
  const rules = effectiveRules(stored, pro);
  const state = await loadState(env.DB, link.monitoredId);
  const local = localParts(now, state?.tzOffsetMin ?? 420);
  const days = await loadDays(env.DB, link.monitoredId, shiftDate(local.date, -21));
  const input: EvalInput = { now, label: link.label, scopes: link.scopes, rules, state, days };
  if (!options.frozen) {
    let verdicts = evaluate(input);
    if (options.absenceOnly) verdicts = verdicts.filter((v) => v.slot === "noSync" || v.slot === "noSteps");
    await apply(env, { link, rules, pro }, verdicts, now);
  }
  await env.DB.prepare("UPDATE family_link SET next_check_at = ?2 WHERE id = ?1").bind(link.id, nextCheckAt(input)).run();
}

/** Open episodes of a link, for the person card's chip. */
export async function openEpisodes(db: D1Database, linkId: string): Promise<number> {
  const row = await db.prepare("SELECT COUNT(*) AS n FROM family_alert_state WHERE link_id = ?1 AND open_since IS NOT NULL AND rule != 'noSync'").bind(linkId).first<{ n: number }>();
  return row?.n ?? 0;
}

export async function chipFor(db: D1Database, link: LinkRow, rules: Rules, now: number): Promise<{ chip: ReturnType<typeof chipOf>; dataAt: number | null }> {
  const state = await loadState(db, link.monitoredId);
  const days = await loadDays(db, link.monitoredId, shiftDate(localParts(now, state?.tzOffsetMin ?? 420).date, -3));
  const last = dataAt(state, days);
  return { chip: chipOf(now, last, rules.noSync.hours, await openEpisodes(db, link.id)), dataAt: last };
}

