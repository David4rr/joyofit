import type { AppEnv } from "../env";
import { DEFAULT_RULES, NO_SCOPES, rulesSchema, scopesSchema, type DayRow, type LinkStatus, type Rules, type Scopes, type StateRow } from "./types";

export interface LinkRow {
  id: string;
  monitoredId: string;
  watcherId: string;
  label: string;
  status: LinkStatus;
  scopes: Scopes;
  pausedUntil: number | null;
  createdAt: number;
  acceptedAt: number | null;
  lastViewedAt: number | null;
  lastPokedAt: number | null;
  snoozeUntil: number | null;
  nextCheckAt: number;
}

interface RawLink {
  id: string;
  monitored_id: string;
  watcher_id: string;
  label: string;
  status: string;
  scopes: string;
  paused_until: number | null;
  created_at: number;
  accepted_at: number | null;
  last_viewed_at: number | null;
  last_poked_at: number | null;
  snooze_until: number | null;
  next_check_at: number;
}

export function parseScopes(json: string): Scopes {
  try {
    const parsed = scopesSchema.safeParse(JSON.parse(json));
    return parsed.success ? parsed.data : NO_SCOPES;
  } catch {
    return NO_SCOPES;
  }
}

export function toLink(row: RawLink): LinkRow {
  return {
    id: row.id,
    monitoredId: row.monitored_id,
    watcherId: row.watcher_id,
    label: row.label,
    status: row.status as LinkStatus,
    scopes: parseScopes(row.scopes),
    pausedUntil: row.paused_until,
    createdAt: row.created_at,
    acceptedAt: row.accepted_at,
    lastViewedAt: row.last_viewed_at,
    lastPokedAt: row.last_poked_at,
    snoozeUntil: row.snooze_until,
    nextCheckAt: row.next_check_at,
  };
}

/** The status a person sees: an active link whose pause has not run out is `paused`. */
export function effectiveStatus(link: LinkRow, now: number): LinkStatus {
  if (link.status !== "active") return link.status;
  return link.pausedUntil === -1 || (link.pausedUntil !== null && link.pausedUntil > now) ? "paused" : "active";
}

export async function getLink(db: D1Database, id: string): Promise<LinkRow | null> {
  const row = await db.prepare("SELECT * FROM family_link WHERE id = ?1").bind(id).first<RawLink>();
  return row ? toLink(row) : null;
}

export async function linksOf(db: D1Database, column: "monitored_id" | "watcher_id", userId: string): Promise<LinkRow[]> {
  const { results } = await db.prepare(`SELECT * FROM family_link WHERE ${column} = ?1 ORDER BY created_at, id`).bind(userId).all<RawLink>();
  return results.map(toLink);
}

interface RawDay {
  date: string;
  steps: number | null;
  first_step_at: number | null;
  resting_hr: number | null;
  sleep_min: number | null;
  spo2_min: number | null;
  spo2_low_count: number | null;
  last_sample_at: number | null;
}

export async function loadDays(db: D1Database, userId: string, fromDate: string): Promise<DayRow[]> {
  const { results } = await db
    .prepare("SELECT date, steps, first_step_at, resting_hr, sleep_min, spo2_min, spo2_low_count, last_sample_at FROM family_day WHERE user_id = ?1 AND date >= ?2 ORDER BY date")
    .bind(userId, fromDate)
    .all<RawDay>();
  return results.map((r) => ({
    date: r.date,
    steps: r.steps,
    firstStepAt: r.first_step_at,
    restingHr: r.resting_hr,
    sleepMin: r.sleep_min,
    spo2Min: r.spo2_min,
    spo2LowCount: r.spo2_low_count,
    lastSampleAt: r.last_sample_at,
  }));
}

export async function loadState(db: D1Database, userId: string): Promise<StateRow | null> {
  const row = await db
    .prepare("SELECT phone_seen_at, watch_sync_at, battery, tz_offset_min FROM family_state WHERE user_id = ?1")
    .bind(userId)
    .first<{ phone_seen_at: number | null; watch_sync_at: number | null; battery: number | null; tz_offset_min: number }>();
  return row ? { phoneSeenAt: row.phone_seen_at, watchSyncAt: row.watch_sync_at, battery: row.battery, tzOffsetMin: row.tz_offset_min } : null;
}

/** Stored rules over the defaults, so a rule added later has a default for old rows. */
export async function loadRules(db: D1Database, linkId: string): Promise<Rules> {
  const row = await db.prepare("SELECT rules FROM family_rule WHERE link_id = ?1").bind(linkId).first<{ rules: string }>();
  if (!row) return DEFAULT_RULES;
  try {
    const parsed = rulesSchema.safeParse({ ...DEFAULT_RULES, ...(JSON.parse(row.rules) as object) });
    return parsed.success ? parsed.data : DEFAULT_RULES;
  } catch {
    return DEFAULT_RULES;
  }
}

/** The categories one device may upload: the union of the scopes of every active, not paused link of the person. */
export function unionScopes(links: LinkRow[], now: number): { scopes: Scopes; enabled: boolean } {
  const live = links.filter((l) => effectiveStatus(l, now) === "active");
  if (live.length === 0) return { scopes: NO_SCOPES, enabled: false };
  const scopes = { ...NO_SCOPES };
  for (const link of live) for (const key of Object.keys(scopes) as (keyof Scopes)[]) scopes[key] = scopes[key] || link.scopes[key];
  return { scopes, enabled: true };
}

/** Deletes everything tied to one link. The monitored person's days stay unless no other live link remains. */
export async function deleteLink(env: AppEnv, link: LinkRow): Promise<void> {
  const others = (await env.DB.prepare("SELECT COUNT(*) AS n FROM family_link WHERE monitored_id = ?1 AND id != ?2 AND status = 'active'").bind(link.monitoredId, link.id).first<{ n: number }>())?.n ?? 0;
  const statements = [
    env.DB.prepare("DELETE FROM family_alert_log WHERE link_id = ?1").bind(link.id),
    env.DB.prepare("DELETE FROM family_alert_state WHERE link_id = ?1").bind(link.id),
    env.DB.prepare("DELETE FROM family_rule WHERE link_id = ?1").bind(link.id),
    env.DB.prepare("DELETE FROM family_link WHERE id = ?1").bind(link.id),
  ];
  if (others === 0) {
    statements.push(env.DB.prepare("DELETE FROM family_day WHERE user_id = ?1").bind(link.monitoredId));
    statements.push(env.DB.prepare("DELETE FROM family_state WHERE user_id = ?1").bind(link.monitoredId));
  }
  await env.DB.batch(statements);
}

export const FAMILY_TABLES_BY_USER = ["family_day", "family_state", "family_push_token", "family_device_token"] as const;

/** Wipes everything family-related for a deleted account: both roles. */
export async function deleteFamilyData(env: AppEnv, userId: string): Promise<void> {
  // As a watcher, each link goes the normal way so a person left with no watcher loses their stored days too.
  for (const link of await linksOf(env.DB, "watcher_id", userId)) await deleteLink(env, link);
  for (const link of await linksOf(env.DB, "monitored_id", userId)) await deleteLink(env, link);
  const statements = [env.DB.prepare("DELETE FROM family_invite WHERE inviter_id = ?1").bind(userId)];
  for (const table of FAMILY_TABLES_BY_USER) statements.push(env.DB.prepare(`DELETE FROM ${table} WHERE user_id = ?1`).bind(userId));
  await env.DB.batch(statements);
}

export const historyDays = (pro: boolean) => (pro ? 90 : 30);
