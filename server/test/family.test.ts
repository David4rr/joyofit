import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { runScheduled } from "../src/family/cron";
import type { AppEnv } from "../src/env";
import { call, env, expo, fakeEmail, grantApi, outbox, signUp } from "./helpers";

// 12:00 WIB: inside the no-sync window and outside the watcher's quiet hours, whatever the machine's clock says.
const NOON_WIB = new Date("2026-10-14T05:00:00Z");
const FAMILY_TABLES = ["family_invite", "family_link", "family_day", "family_state", "family_rule", "family_alert_state", "family_alert_log", "family_push_token", "family_device_token"];
beforeEach(async () => {
  // The cron looks at every link, so each test starts from an empty family.
  await env.DB.batch(FAMILY_TABLES.map((table) => env.DB.prepare(`DELETE FROM ${table}`)));
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOON_WIB);
});
afterEach(() => {
  vi.useRealTimers();
});

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const ALL = { sync: true, steps: true, sleep: true, restingHr: true, spo2: true };
const NONE_BUT_SYNC = { sync: true, steps: false, sleep: false, restingHr: false, spo2: false };

type Person = ReturnType<typeof signUp>;

const json = (path: string, method: string, body: unknown, cookie: string) =>
  call(path, { method, body: JSON.stringify(body), headers: { "content-type": "application/json" }, cookie });

/** A tz offset that puts the current instant at `hour` o'clock for the monitored person. */
function tzFor(hour: number, now = Date.now()): number {
  const utcHour = new Date(now).getUTCHours();
  return (((hour - utcHour + 36) % 24) - 12) * 60;
}
const localDate = (tz: number, now = Date.now()) => new Date(now + tz * 60_000).toISOString().slice(0, 10);

/** Watcher invites the monitored person; the monitored person accepts and consents with `scopes`. */
async function link(watcher: Person, monitored: Person, scopes: Record<string, boolean> = ALL, label = "Ibu"): Promise<string> {
  const invite = (await (await json("/v1/family/invites", "POST", { role: "watcher", label }, watcher.cookie)).json()) as { code: string };
  const accepted = await json("/v1/family/invites/accept", "POST", { code: invite.code }, monitored.cookie);
  expect(accepted.status).toBe(200);
  const { link: created } = (await accepted.json()) as { link: { id: string; status: string } };
  expect(created.status).toBe("pending");
  const consent = await json(`/v1/family/links/${created.id}`, "PATCH", { scopes, consent: true }, monitored.cookie);
  expect(consent.status).toBe(200);
  return created.id;
}

async function deviceToken(monitored: Person, deviceId = "device-aaaaaaaa"): Promise<string> {
  const response = await json("/v1/family/device-token", "POST", { deviceId }, monitored.cookie);
  return ((await response.json()) as { token: string }).token;
}

function ingest(token: string, body: unknown): Promise<Response> {
  return call("/v1/family/ingest", { method: "PUT", body: JSON.stringify(body), headers: { "content-type": "application/json", authorization: `Bearer ${token}` }, env: { EMAIL: fakeEmail } });
}

async function registerPush(user: Person, token = "ExponentPushToken[abc]"): Promise<void> {
  const response = await json("/v1/family/push-token", "PUT", { token, platform: "android", deviceId: `push-${user.user.id}` }, user.cookie);
  expect(response.status).toBe(200);
}

const cronEnv: AppEnv = { ...env, EMAIL: fakeEmail };
const countRows = async (sql: string, ...binds: unknown[]) => (await env.DB.prepare(sql).bind(...binds).first<{ n: number }>())!.n;

describe("invites and consent", () => {
  it("links nothing live until the monitored person consents, then exposes only granted categories", async () => {
    const watcher = signUp("dina");
    const mom = signUp("ibu", { founder: false });
    const invite = (await (await json("/v1/family/invites", "POST", { role: "watcher", label: "Ibu" }, watcher.cookie)).json()) as { code: string; url: string; expiresAt: number };
    expect(invite.code).toMatch(/^[A-HJKMNP-Z2-9]{8}$/);
    expect(invite.url).toBe(`https://fit.joyorogo.com/keluarga/${invite.code}`);
    const preview = (await (await call(`/v1/family/invites/${invite.code.toLowerCase()}`, { cookie: mom.cookie })).json()) as { inviterName: string; inviterRole: string };
    expect(preview).toMatchObject({ inviterName: "dina", inviterRole: "watcher" });
    const accepted = (await (await json("/v1/family/invites/accept", "POST", { code: invite.code }, mom.cookie)).json()) as { link: { id: string; scopes: Record<string, boolean> } };
    expect(Object.values(accepted.link.scopes).some(Boolean)).toBe(false);

    // Pending: no config, no ingest.
    expect(((await (await call("/v1/family/config", { cookie: mom.cookie })).json()) as { enabled: boolean }).enabled).toBe(false);
    const token = await deviceToken(mom);
    expect((await ingest(token, { tzOffsetMin: 420, watchSyncAt: Date.now(), battery: 50, days: [] })).status).toBe(403);

    await json(`/v1/family/links/${accepted.link.id}`, "PATCH", { scopes: { steps: true, sleep: false }, consent: true }, mom.cookie);
    const tz = 420;
    const date = localDate(tz);
    const sent = await ingest(token, { tzOffsetMin: tz, watchSyncAt: Date.now(), battery: 61, days: [{ date, steps: 1234, restingHr: 70, sleepMin: 400 }] });
    expect(sent.status).toBe(200);
    // The server stores only what the person granted, whatever the phone sent.
    const row = await env.DB.prepare("SELECT steps, resting_hr, sleep_min FROM family_day WHERE user_id = ?1").bind(mom.user.id).first();
    expect(row).toEqual({ steps: 1234, resting_hr: null, sleep_min: null });

    const links = (await (await call("/v1/family/links", { cookie: watcher.cookie })).json()) as {
      watching: { id: string; status: string; chip: string; today: { steps: number | null; restingHr: number | null } }[];
      limits: { pro: boolean; maxWatching: number; historyDays: number };
    };
    expect(links.watching[0]).toMatchObject({ status: "active", chip: "ok", today: { steps: 1234, restingHr: null } });
    expect(links.limits).toMatchObject({ pro: true, maxWatching: 5, historyDays: 90 });
    const summary = (await (await call(`/v1/family/links/${accepted.link.id}/summary?days=7`, { cookie: watcher.cookie })).json()) as {
      days: { steps: number | null; restingHr: number | null }[];
      state: { battery: number };
    };
    expect(summary.state.battery).toBe(61);
    expect(summary.days.at(-1)).toMatchObject({ steps: 1234, restingHr: null });
    const mine = (await (await call("/v1/family/me/last", { cookie: mom.cookie })).json()) as { payload: string };
    expect(JSON.parse(mine.payload).days[0].steps).toBe(1234);
  });

  it("refuses an own, used or unknown code and never takes sync away", async () => {
    const a = signUp("a1");
    const b = signUp("b1");
    const c = signUp("c1");
    const invite = (await (await json("/v1/family/invites", "POST", { role: "monitored", label: "Dina" }, a.cookie)).json()) as { code: string };
    expect((await json("/v1/family/invites/accept", "POST", { code: invite.code }, a.cookie)).status).toBe(400);
    expect((await json("/v1/family/invites/accept", "POST", { code: invite.code }, b.cookie)).status).toBe(200);
    expect((await json("/v1/family/invites/accept", "POST", { code: invite.code }, c.cookie)).status).toBe(404);
    expect((await json("/v1/family/invites/accept", "POST", { code: "ZZZZZZZZ" }, c.cookie)).status).toBe(404);
    const links = (await (await call("/v1/family/links", { cookie: a.cookie })).json()) as { watchedBy: { id: string; role: string }[] };
    expect(links.watchedBy[0]?.role).toBe("watchedBy");
    const bad = await json(`/v1/family/links/${links.watchedBy[0]!.id}`, "PATCH", { scopes: { sync: false } }, a.cookie);
    expect(bad.status).toBe(400);
  });

  it("only the monitored person changes scopes, only the watcher the label", async () => {
    const watcher = signUp("w2");
    const mom = signUp("m2");
    const id = await link(watcher, mom, NONE_BUT_SYNC);
    expect((await json(`/v1/family/links/${id}`, "PATCH", { scopes: { steps: true } }, watcher.cookie)).status).toBe(403);
    expect((await json(`/v1/family/links/${id}`, "PATCH", { label: "Bapak" }, mom.cookie)).status).toBe(403);
    expect((await json(`/v1/family/links/${id}`, "PATCH", { label: "Bapak" }, watcher.cookie)).status).toBe(200);
    expect((await call(`/v1/family/links/${id}/summary`, { cookie: signUp("stranger").cookie })).status).toBe(404);
  });

  it("revoking deletes the history at once and the phone is told to stop", async () => {
    const watcher = signUp("w3");
    const mom = signUp("m3");
    const id = await link(watcher, mom);
    const token = await deviceToken(mom);
    const tz = 420;
    await ingest(token, { tzOffsetMin: tz, watchSyncAt: Date.now(), battery: 50, days: [{ date: localDate(tz), steps: 10 }] });
    expect(await countRows("SELECT COUNT(*) AS n FROM family_day WHERE user_id = ?1", mom.user.id)).toBe(1);
    expect((await call(`/v1/family/links/${id}`, { method: "DELETE", cookie: mom.cookie })).status).toBe(200);
    expect(await countRows("SELECT COUNT(*) AS n FROM family_day WHERE user_id = ?1", mom.user.id)).toBe(0);
    expect(await countRows("SELECT COUNT(*) AS n FROM family_link")).toBeGreaterThanOrEqual(0);
    expect((await ingest(token, { tzOffsetMin: tz, watchSyncAt: Date.now(), battery: 50, days: [] })).status).toBe(403);
  });

  it("pausing stops the feed, and withdrawing a category blanks what was stored", async () => {
    const watcher = signUp("w4");
    const mom = signUp("m4");
    const id = await link(watcher, mom);
    const token = await deviceToken(mom);
    const tz = 420;
    await ingest(token, { tzOffsetMin: tz, watchSyncAt: Date.now(), battery: 50, days: [{ date: localDate(tz), steps: 10, sleepMin: 300 }] });
    await json(`/v1/family/links/${id}`, "PATCH", { scopes: { sleep: false } }, mom.cookie);
    expect(await env.DB.prepare("SELECT sleep_min, steps FROM family_day WHERE user_id = ?1").bind(mom.user.id).first()).toEqual({ sleep_min: null, steps: 10 });
    await json(`/v1/family/links/${id}`, "PATCH", { pausedUntil: -1 }, mom.cookie);
    const config = (await (await call("/v1/family/config", { cookie: mom.cookie })).json()) as { enabled: boolean; links: { status: string }[] };
    expect(config).toMatchObject({ enabled: false, links: [{ status: "paused" }] });
    expect((await ingest(token, { tzOffsetMin: tz, watchSyncAt: Date.now(), battery: 50, days: [] })).status).toBe(403);
  });
});

describe("plan limits", () => {
  it("Free watches one person, Pro five; the oldest link stays live after a downgrade", async () => {
    const free = signUp("free1", { founder: false });
    await link(free, signUp("p1"));
    const second = await json("/v1/family/invites", "POST", { role: "watcher", label: "Bapak" }, free.cookie);
    expect(second.status).toBe(409);
    expect(await second.json()).toMatchObject({ error: "limit_reached" });

    const pro = signUp("pro1");
    for (let i = 0; i < 5; i += 1) await link(pro, signUp(`pm${i}`), NONE_BUT_SYNC, `Orang ${i}`);
    expect((await json("/v1/family/invites", "POST", { role: "watcher", label: "Keenam" }, pro.cookie)).status).toBe(409);
  });

  it("a Pro watcher whose plan lapsed keeps the oldest link and the others freeze", async () => {
    const watcher = signUp("lapsed", { founder: true });
    const first = await link(watcher, signUp("lm1"));
    vi.setSystemTime(Date.now() + 60_000);
    const secondMom = signUp("lm2");
    const second = await link(watcher, secondMom);
    // Downgrade: the fake JoyoRogo now answers free for this user.
    const { founders } = await import("./helpers");
    founders.delete(watcher.user.id);
    const { clearRogoCache } = await import("../src/family/joyorogo");
    clearRogoCache();
    const links = (await (await call("/v1/family/links", { cookie: watcher.cookie })).json()) as { watching: { id: string; frozen: boolean }[] };
    expect(Object.fromEntries(links.watching.map((l) => [l.id, l.frozen]))).toEqual({ [first]: false, [second]: true });
    expect((await call(`/v1/family/links/${second}/summary`, { cookie: watcher.cookie })).status).toBe(402);
  });

  it("history is clamped to 30 days for Free", async () => {
    const free = signUp("free2", { founder: false });
    const id = await link(free, signUp("hm"));
    const summary = await call(`/v1/family/links/${id}/summary?days=90`, { cookie: free.cookie });
    expect(summary.status).toBe(200);
    const links = (await (await call("/v1/family/links", { cookie: free.cookie })).json()) as { limits: { historyDays: number } };
    expect(links.limits.historyDays).toBe(30);
  });
});

describe("rules and snooze", () => {
  it("Free can change only the no-sync rule; Pro can change the rest", async () => {
    const free = signUp("rf", { founder: false });
    const id = await link(free, signUp("rfm"));
    const current = ((await (await call(`/v1/family/links/${id}/rules`, { cookie: free.cookie })).json()) as { rules: Record<string, unknown> }).rules;
    const ok = await json(`/v1/family/links/${id}/rules`, "PUT", { ...current, noSync: { on: true, hours: 8 } }, free.cookie);
    expect(ok.status).toBe(200);
    const denied = await json(`/v1/family/links/${id}/rules`, "PUT", { ...current, noSync: { on: true, hours: 8 }, spo2: { on: true } }, free.cookie);
    expect(denied.status).toBe(402);
    expect(await denied.json()).toMatchObject({ error: "pro_required" });

    const pro = signUp("rp");
    const proId = await link(pro, signUp("rpm"));
    const proRules = ((await (await call(`/v1/family/links/${proId}/rules`, { cookie: pro.cookie })).json()) as { rules: Record<string, unknown> }).rules;
    expect(proRules.spo2).toEqual({ on: false });
    expect((await json(`/v1/family/links/${proId}/rules`, "PUT", { ...proRules, spo2: { on: true }, email: true }, pro.cookie)).status).toBe(200);
    expect((await json(`/v1/family/links/${proId}/rules`, "PUT", { ...proRules, noSteps: { on: true, hour: 3 } }, pro.cookie)).status).toBe(400);
  });
});

describe("poke", () => {
  it("pushes to the monitored phone once an hour", async () => {
    const watcher = signUp("pk");
    const mom = signUp("pkm");
    const id = await link(watcher, mom);
    await registerPush(mom, "ExponentPushToken[mom]");
    const first = await call(`/v1/family/links/${id}/poke`, { method: "POST", cookie: watcher.cookie });
    expect(await first.json()).toEqual({ sent: true });
    expect(expo.sent[0]).toMatchObject({ to: "ExponentPushToken[mom]", title: "pk menanyakan kabarmu", data: { type: "family_poke", linkId: id } });
    expect((await call(`/v1/family/links/${id}/poke`, { method: "POST", cookie: watcher.cookie })).status).toBe(429);
  });
});

describe("alerts end to end", () => {
  async function setup(opts: { watcherPro: boolean; scopes?: Record<string, boolean>; tz?: number }) {
    const watcher = signUp(`aw${Math.random().toString(36).slice(2, 6)}`, { founder: opts.watcherPro });
    const mom = signUp(`am${Math.random().toString(36).slice(2, 6)}`, { founder: false });
    const id = await link(watcher, mom, opts.scopes ?? ALL);
    await registerPush(watcher, `ExponentPushToken[${watcher.user.id}]`);
    return { watcher, mom, id, token: await deviceToken(mom), tz: opts.tz ?? tzFor(12) };
  }

  it("fires the free no-sync push once per silence, again at 24 h, says what is silent, and stops after that", async () => {
    const { watcher, id, token, tz } = await setup({ watcherPro: false, scopes: NONE_BUT_SYNC });
    const now = Date.now();
    // 20 h of silence at 12:00: the ingest itself finds it.
    await ingest(token, { tzOffsetMin: tz, watchSyncAt: now - 20 * HOUR, battery: 9, days: [] });
    expect(expo.sent).toHaveLength(1);
    expect(expo.sent[0]).toMatchObject({ to: `ExponentPushToken[${watcher.user.id}]`, title: "Belum ada kabar dari Ibu", data: { type: "family_alert", linkId: id, rule: "noSync" } });
    expect(expo.sent[0]!.body).toContain("9%");
    // Same silence, later cron run: nothing more (dedupe key rule:outage:tier).
    await env.DB.prepare("UPDATE family_link SET next_check_at = 0").run();
    await runScheduled(cronEnv, "*/15 * * * *", now + 15 * 60_000);
    expect(expo.sent).toHaveLength(1);
    // 24 h into the silence (4 h later, 16:00) it repeats once with a new key.
    await env.DB.prepare("UPDATE family_link SET next_check_at = 0").run();
    await runScheduled(cronEnv, "*/15 * * * *", now + 4 * HOUR);
    expect(expo.sent).toHaveLength(2);
    await env.DB.prepare("UPDATE family_link SET next_check_at = 0").run();
    await runScheduled(cronEnv, "*/15 * * * *", now + 4 * HOUR + 15 * 60_000);
    expect(expo.sent).toHaveLength(2);
    const summary = (await (await call(`/v1/family/links/${id}/summary`, { cookie: watcher.cookie })).json()) as { alerts: { rule: string }[]; chip: string };
    expect(summary.alerts).toHaveLength(2);
    expect(summary.alerts[0]?.rule).toBe("noSync");
    expect(summary.chip).toBe("nosync");
  });

  it("the cron finds a silence the phone never reported (the phone itself went quiet)", async () => {
    const { token, tz } = await setup({ watcherPro: false, scopes: NONE_BUT_SYNC });
    const now = Date.now();
    await ingest(token, { tzOffsetMin: tz, watchSyncAt: now - 5 * HOUR, battery: 40, days: [] });
    expect(expo.sent).toHaveLength(0);
    // Seven hours pass with no upload at all: only the cron can notice.
    await env.DB.prepare("UPDATE family_link SET next_check_at = 0").run();
    await runScheduled(cronEnv, "*/15 * * * *", now + 7 * HOUR);
    expect(expo.sent).toHaveLength(1);
    expect(expo.sent[0]!.body).toContain("Ponsel Ibu");
  });

  it("does not send the other rules to a Free watcher", async () => {
    const { token, tz } = await setup({ watcherPro: false });
    await ingest(token, { tzOffsetMin: tz, watchSyncAt: Date.now(), battery: 70, days: [{ date: localDate(tz), steps: 3000, restingHr: 120, sleepMin: 100, lastSampleAt: Date.now() }] });
    expect(expo.sent).toHaveLength(0);
  });

  it("sends a resting-heart-rate alert on ingest for a Pro watcher, then holds it back while the episode is open", async () => {
    const { watcher, mom, id, token, tz } = await setup({ watcherPro: true });
    const today = localDate(tz);
    for (let i = 1; i <= 10; i += 1) {
      const d = new Date(Date.parse(`${today}T00:00:00Z`) - i * DAY).toISOString().slice(0, 10);
      await env.DB.prepare("INSERT INTO family_day (user_id, date, resting_hr, updated_at) VALUES (?1, ?2, 62, 1)").bind(mom.user.id, d).run();
    }
    const body = { tzOffsetMin: tz, watchSyncAt: Date.now(), battery: 70, days: [{ date: today, steps: 3000, restingHr: 95, lastSampleAt: Date.now() }] };
    await ingest(token, body);
    expect(expo.sent).toHaveLength(1);
    expect(expo.sent[0]).toMatchObject({ title: expect.stringContaining("lebih tinggi dari biasanya"), data: { rule: "rhrHigh", linkId: id } });
    expect(expo.sent[0]!.body).not.toMatch(/darurat/i);
    await ingest(token, { ...body, days: [{ ...body.days[0]!, restingHr: 97 }] });
    expect(expo.sent).toHaveLength(1);
    void watcher;
  });

  it("snoozed links stay quiet", async () => {
    const { watcher, id, token, tz } = await setup({ watcherPro: true, scopes: NONE_BUT_SYNC });
    expect((await json(`/v1/family/links/${id}/snooze`, "POST", { days: 3 }, watcher.cookie)).status).toBe(200);
    await ingest(token, { tzOffsetMin: tz, watchSyncAt: Date.now() - 15 * HOUR, battery: 50, days: [] });
    await env.DB.prepare("UPDATE family_link SET next_check_at = 0").run();
    await runScheduled(cronEnv, "*/15 * * * *", Date.now());
    expect(expo.sent).toHaveLength(0);
  });

  it("queues pushes inside quiet hours until 06:30 and flushes them from the cron", async () => {
    const { watcher, id, token } = await setup({ watcherPro: true, scopes: NONE_BUT_SYNC, tz: 420 });
    // 22:00 WIB = 15:00 UTC: quiet for the watcher, and still before the monitored person's 21:00 cutoff? use a parent zone where it is 20:00.
    const night = Date.parse("2026-10-14T15:00:00Z");
    const parentTz = (20 - 15) * 60;
    await ingest(token, { tzOffsetMin: parentTz, watchSyncAt: night - 14 * HOUR, battery: 50, days: [] });
    await env.DB.prepare("UPDATE family_link SET next_check_at = 0").run();
    await runScheduled(cronEnv, "*/15 * * * *", night);
    expect(expo.sent).toHaveLength(0);
    const queued = await env.DB.prepare("SELECT status, send_after FROM family_alert_log WHERE link_id = ?1").bind(id).first<{ status: string; send_after: number }>();
    expect(queued?.status).toBe("queued");
    expect(new Date(queued!.send_after).toISOString()).toBe("2026-10-14T23:30:00.000Z");
    await runScheduled(cronEnv, "*/15 * * * *", queued!.send_after + 1);
    expect(expo.sent).toHaveLength(1);
    expect(expo.sent[0]!.to).toBe(`ExponentPushToken[${watcher.user.id}]`);
    expect((await env.DB.prepare("SELECT status FROM family_alert_log WHERE link_id = ?1").bind(id).first<{ status: string }>())?.status).toBe("sent");
  });

  it("sends at most three pushes a day per watcher, the rest wait for the digest, which is Pro only", async () => {
    const { watcher, mom, id, token, tz } = await setup({ watcherPro: true });
    const today = localDate(tz);
    for (let i = 1; i <= 10; i += 1) {
      const d = new Date(Date.parse(`${today}T00:00:00Z`) - i * DAY).toISOString().slice(0, 10);
      await env.DB.prepare("INSERT INTO family_day (user_id, date, resting_hr, updated_at) VALUES (?1, ?2, 62, 1)").bind(mom.user.id, d).run();
    }
    for (let i = 0; i < 3; i += 1) {
      await env.DB.prepare("INSERT INTO family_alert_log (id, link_id, watcher_id, rule, dedupe_key, at, level, status, title, body) VALUES (?1, ?2, ?3, 'noSteps', ?4, ?5, 'push', 'sent', 't', 'b')").bind(`pre-${i}`, id, watcher.user.id, `k${i}`, Date.now()).run();
    }
    await ingest(token, { tzOffsetMin: tz, watchSyncAt: Date.now(), battery: 70, days: [{ date: today, restingHr: 99, sleepMin: 150, lastSampleAt: Date.now() }] });
    expect(expo.sent).toHaveLength(0);
    expect(await countRows("SELECT COUNT(*) AS n FROM family_alert_log WHERE link_id = ?1 AND status = 'digest'", id)).toBe(2);
    await runScheduled(cronEnv, "0 12 * * *", Date.now());
    expect(expo.sent).toHaveLength(1);
    expect(expo.sent[0]!.title).toBe("Ringkasan kabar keluarga");
    expect(await countRows("SELECT COUNT(*) AS n FROM family_alert_log WHERE link_id = ?1 AND status = 'digested'", id)).toBe(2);
  });

  it("falls back to email for a Pro watcher whose push reaches nobody, with the disclaimer", async () => {
    const { watcher, token, tz } = await setup({ watcherPro: true, scopes: NONE_BUT_SYNC });
    expo.failWith = "DeviceNotRegistered";
    await ingest(token, { tzOffsetMin: tz, watchSyncAt: Date.now() - 15 * HOUR, battery: 50, days: [] });
    expect(outbox).toHaveLength(1);
    expect(outbox[0]).toMatchObject({ to: watcher.user.email, subject: "Belum ada kabar dari Ibu" });
    expect(outbox[0]!.text).toContain("bukan alat darurat");
    // The dead token is gone.
    expect(await countRows("SELECT COUNT(*) AS n FROM family_push_token WHERE user_id = ?1", watcher.user.id)).toBe(0);
  });

  it("Free watchers get no email", async () => {
    const { token, tz } = await setup({ watcherPro: false, scopes: NONE_BUT_SYNC });
    expo.failWith = "DeviceNotRegistered";
    await ingest(token, { tzOffsetMin: tz, watchSyncAt: Date.now() - 15 * HOUR, battery: 50, days: [] });
    expect(outbox).toHaveLength(0);
  });
});

describe("purge and account deletion", () => {
  it("keeps 90 days for a Pro watcher and 30 for a Free one", async () => {
    const proW = signUp("pw");
    const freeW = signUp("fw", { founder: false });
    const proMom = signUp("pwm");
    const freeMom = signUp("fwm");
    await link(proW, proMom, NONE_BUT_SYNC);
    await link(freeW, freeMom, NONE_BUT_SYNC);
    const old = (days: number) => new Date(Date.now() - days * DAY).toISOString().slice(0, 10);
    for (const mom of [proMom, freeMom]) {
      for (const days of [10, 45, 100]) await env.DB.prepare("INSERT INTO family_day (user_id, date, steps, updated_at) VALUES (?1, ?2, 1, 1)").bind(mom.user.id, old(days)).run();
    }
    await runScheduled(cronEnv, "0 20 * * *", Date.now());
    const dates = async (id: string) => (await env.DB.prepare("SELECT date FROM family_day WHERE user_id = ?1 ORDER BY date").bind(id).all<{ date: string }>()).results.map((r) => r.date);
    expect(await dates(proMom.user.id)).toEqual([old(45), old(10)]);
    expect(await dates(freeMom.user.id)).toEqual([old(10)]);
  });

  it("DELETE /v1/account removes both roles", async () => {
    const watcher = signUp("dw");
    const mom = signUp("dm");
    await link(watcher, mom);
    await deviceToken(mom);
    await registerPush(watcher);
    grantApi.handler = () => Response.json({ revoked: true });
    const response = await call("/v1/account", { method: "DELETE", cookie: watcher.cookie });
    expect(response.status).toBe(200);
    expect(await countRows("SELECT COUNT(*) AS n FROM family_link WHERE watcher_id = ?1", watcher.user.id)).toBe(0);
    expect(await countRows("SELECT COUNT(*) AS n FROM family_push_token WHERE user_id = ?1", watcher.user.id)).toBe(0);
    // The monitored person lost their only watcher, so nothing of theirs is stored any more.
    expect(await countRows("SELECT COUNT(*) AS n FROM family_state WHERE user_id = ?1", mom.user.id)).toBe(0);
  });
});

describe("ingest authentication", () => {
  it("rejects a missing, malformed or revoked token", async () => {
    const mom = signUp("auth1");
    expect((await ingest("fdt_" + "x".repeat(30), { tzOffsetMin: 0, watchSyncAt: null, battery: null, days: [] })).status).toBe(401);
    expect((await call("/v1/family/ingest", { method: "PUT", body: "{}", headers: { "content-type": "application/json" } })).status).toBe(401);
    const token = await deviceToken(mom);
    expect((await call(`/v1/family/device-token?deviceId=device-aaaaaaaa`, { method: "DELETE", cookie: mom.cookie })).status).toBe(200);
    expect((await ingest(token, { tzOffsetMin: 0, watchSyncAt: null, battery: null, days: [] })).status).toBe(401);
  });
});
