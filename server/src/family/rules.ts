import { DAY_MS, HOUR_MS, type AlertLevel, type Chip, type DayRow, type RuleId, type Rules, type Scopes, type StateRow } from "./types";

/** Local calendar pieces of an instant in the monitored person's time zone (offset in minutes east of UTC). */
export function localParts(now: number, tzOffsetMin: number): { date: string; hour: number; minutes: number } {
  const shifted = new Date(now + tzOffsetMin * 60_000);
  return {
    date: shifted.toISOString().slice(0, 10),
    hour: shifted.getUTCHours(),
    minutes: shifted.getUTCHours() * 60 + shifted.getUTCMinutes(),
  };
}

export function shiftDate(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

/** "Data per" instant: the newer of the last watch sync and the newest sample. */
export function dataAt(state: StateRow | null, days: DayRow[]): number | null {
  let latest = state?.watchSyncAt ?? null;
  for (const day of days) if (day.lastSampleAt !== null && (latest === null || day.lastSampleAt > latest)) latest = day.lastSampleAt;
  return latest;
}

export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

export const BASELINE_DAYS = 14;
export const BASELINE_MIN_DAYS = 7;

/** Median resting HR over the 14 days before `today`; null until 7 of them have a value. */
export function restingBaseline(days: DayRow[], today: string): { restingHr: number | null; days: number } {
  const from = shiftDate(today, -BASELINE_DAYS);
  const values = days.filter((d) => d.date >= from && d.date < today && d.restingHr !== null).map((d) => d.restingHr!);
  return { restingHr: values.length >= BASELINE_MIN_DAYS ? median(values) : null, days: values.length };
}

export interface Finding {
  rule: RuleId;
  /** What an episode is called: one finding per key is ever sent. */
  key: string;
  level: AlertLevel;
  title: string;
  body: string;
}

/** A rule's verdict: `active` says whether its condition holds now; `finding` is what to tell the watcher if it is not already open. */
export interface Verdict {
  /** The rule family whose open/clear state this verdict drives (rhrHigh and rhrLow share `restingHr`). */
  slot: "noSync" | "restingHr" | "noSteps" | "sleep" | "spo2";
  /** null = cannot judge (no data, stale feed): the stored state is left alone. */
  active: boolean | null;
  finding?: Finding;
}

export interface EvalInput {
  now: number;
  label: string;
  scopes: Scopes;
  rules: Rules;
  state: StateRow | null;
  /** At least the last 14 days, any order. */
  days: DayRow[];
}

const tag = (label: string) => label;

/** Which of the two silent states it is, from the last time the phone talked to the server and the watch battery. */
function silenceCause(state: StateRow | null, now: number, hours: number): "phone" | "watch" {
  if (!state?.phoneSeenAt) return "phone";
  return now - state.phoneSeenAt >= (hours * HOUR_MS) / 2 ? "phone" : "watch";
}

/** Rule 2. Fires from `rules.noSync.hours` of silence between 07:00 and 21:00 local, again at 24 h and 72 h, then stops. */
function noSync(input: EvalInput, last: number | null, local: { hour: number }): Verdict {
  const { now, label, rules, state } = input;
  const hours = rules.noSync.hours;
  if (last === null) return { slot: "noSync", active: null };
  const silent = (now - last) / HOUR_MS;
  if (silent < hours) return { slot: "noSync", active: false };
  if (local.hour < 7 || local.hour >= 21) return { slot: "noSync", active: true };
  const tier = silent >= 72 ? 2 : silent >= 24 ? 1 : 0;
  const cause = silenceCause(state, now, hours);
  const low = state?.battery !== null && state?.battery !== undefined && state.battery <= 15;
  const what =
    cause === "phone"
      ? `Ponsel ${tag(label)} belum mengirim kabar sejak ${Math.floor(silent)} jam lalu. Mungkin ponselnya mati, tanpa internet, atau JoyoFit belum dibuka.`
      : `Jam ${tag(label)} belum tersinkron sejak ${Math.floor(silent)} jam lalu. Ponselnya masih terhubung, jadi jamnya mungkin jauh dari ponsel atau tidak terpasang.`;
  return {
    slot: "noSync",
    active: true,
    finding: {
      rule: "noSync",
      key: `noSync:${last}:${tier}`,
      level: "push",
      title: `Belum ada kabar dari ${tag(label)}`,
      body: low ? `${what} Baterai jam terakhir terbaca ${state!.battery}%.` : what,
    },
  };
}

function noSteps(input: EvalInput, fresh: boolean, local: { date: string; hour: number }, today: DayRow | undefined): Verdict {
  const { label, rules, scopes } = input;
  if (!scopes.steps || !fresh || !today || today.steps === null) return { slot: "noSteps", active: null };
  if (local.hour < rules.noSteps.hour) return { slot: "noSteps", active: null };
  if (today.steps >= 200) return { slot: "noSteps", active: false };
  return {
    slot: "noSteps",
    active: true,
    finding: {
      rule: "noSteps",
      key: `noSteps:${local.date}`,
      level: "push",
      title: `Belum ada langkah dari ${tag(label)}`,
      body: `Sampai jam ${String(local.hour).padStart(2, "0")}.00 baru ${today.steps} langkah tercatat dari ${tag(label)}. Mungkin jamnya belum dipakai. Coba tanya kabarnya.`,
    },
  };
}

function restingHr(input: EvalInput, local: { date: string }, byDate: Map<string, DayRow>): Verdict[] {
  const { label, scopes, rules, days } = input;
  if (!scopes.restingHr) return [{ slot: "restingHr", active: null }];
  const today = byDate.get(local.date);
  const yesterday = byDate.get(shiftDate(local.date, -1));
  const value = today?.restingHr ?? null;
  if (value === null) return [{ slot: "restingHr", active: null }];
  const base = restingBaseline(days, local.date).restingHr;
  const step = (hr: number | null | undefined) => (base === null || hr === null || hr === undefined ? false : hr >= base + Math.max(10, base * 0.15));
  const high = value >= 100 || (base !== null && (value >= base + 20 || (step(value) && step(yesterday?.restingHr))));
  const low = base !== null && value <= base - 15 && value <= 45;
  if (!rules.restingHr.on) return [{ slot: "restingHr", active: null }];
  if (high) {
    return [
      {
        slot: "restingHr",
        active: true,
        finding: {
          rule: "rhrHigh",
          key: `rhrHigh:${local.date}`,
          level: "push",
          title: `Detak jantung istirahat ${tag(label)} lebih tinggi dari biasanya`,
          body: `Detak jantung istirahat ${tag(label)} ${value} bpm${base === null ? "" : `, biasanya sekitar ${Math.round(base)} bpm`}. Ini bukan diagnosis. Coba tanya kabarnya.`,
        },
      },
    ];
  }
  if (low) {
    return [
      {
        slot: "restingHr",
        active: true,
        finding: {
          rule: "rhrLow",
          key: `rhrLow:${local.date}`,
          level: "push",
          title: `Detak jantung istirahat ${tag(label)} lebih rendah dari biasanya`,
          body: `Detak jantung istirahat ${tag(label)} ${value} bpm, biasanya sekitar ${Math.round(base!)} bpm. Ini bukan diagnosis. Coba tanya kabarnya.`,
        },
      },
    ];
  }
  return [{ slot: "restingHr", active: false }];
}

function sleep(input: EvalInput, local: { date: string }, byDate: Map<string, DayRow>): Verdict {
  const { label, scopes, rules } = input;
  if (!scopes.sleep || !rules.sleep.on) return { slot: "sleep", active: null };
  const night = (offset: number) => byDate.get(shiftDate(local.date, -offset))?.sleepMin ?? null;
  const last = night(0);
  // Missing sleep data is not poor sleep.
  if (last === null) return { slot: "sleep", active: null };
  const nights = [night(0), night(1), night(2)];
  const run = nights.every((m) => m !== null && m < 330);
  if (last >= 240 && !run) return { slot: "sleep", active: false };
  const hours = (last / 60).toFixed(1).replace(".", ",");
  return {
    slot: "sleep",
    active: true,
    finding: {
      rule: "sleep",
      key: `sleep:${local.date}`,
      level: "digest",
      title: `Tidur ${tag(label)} kurang dari biasanya`,
      body: run && last >= 240 ? `${tag(label)} tidur kurang dari 5,5 jam tiga malam berturut-turut.` : `Semalam ${tag(label)} tidur sekitar ${hours} jam.`,
    },
  };
}

function spo2(input: EvalInput, local: { date: string }, byDate: Map<string, DayRow>): Verdict {
  const { label, scopes, rules, days } = input;
  if (!scopes.spo2 || !rules.spo2.on) return { slot: "spo2", active: null };
  const from = shiftDate(local.date, -7);
  // Only people whose watch has reported SpO2 in the last week.
  if (!days.some((d) => d.date >= from && d.spo2Min !== null)) return { slot: "spo2", active: null };
  const today = byDate.get(local.date);
  if (!today || today.spo2Min === null) return { slot: "spo2", active: null };
  const yesterday = byDate.get(shiftDate(local.date, -1));
  const lowReadings = (today.spo2LowCount ?? 0) >= 2;
  const lowNights = today.spo2Min <= 90 && yesterday?.spo2Min !== null && yesterday?.spo2Min !== undefined && yesterday.spo2Min <= 90;
  if (!lowReadings && !lowNights) return { slot: "spo2", active: false };
  return {
    slot: "spo2",
    active: true,
    finding: {
      rule: "spo2",
      key: `spo2:${local.date}`,
      level: "push",
      title: `Jam ${tag(label)} mencatat oksigen rendah`,
      body: `Kata jam, kadar oksigen ${tag(label)} sempat di ${today.spo2Min}%. Angka jam bisa meleset dan ini bukan diagnosis. Coba tanya kabarnya.`,
    },
  };
}

/**
 * Runs every rule of one link against the monitored person's data. The pure core of the evaluator: no I/O, the clock
 * and the time zone are inputs. A stale feed (past the no-sync threshold) silences rules 1, 3, 4 and 5.
 */
export function evaluate(input: EvalInput): Verdict[] {
  const { now, rules, state, days } = input;
  const local = localParts(now, state?.tzOffsetMin ?? 420);
  const byDate = new Map(days.map((d) => [d.date, d]));
  const last = dataAt(state, days);
  const stale = last === null || (now - last) / HOUR_MS >= rules.noSync.hours;
  const verdicts: Verdict[] = [];
  if (rules.noSync.on) verdicts.push(noSync(input, last, local));
  if (stale) {
    for (const slot of ["restingHr", "noSteps", "sleep", "spo2"] as const) verdicts.push({ slot, active: null });
    return verdicts;
  }
  if (rules.noSteps.on) verdicts.push(noSteps(input, true, local, byDate.get(local.date)));
  verdicts.push(...restingHr(input, local, byDate), sleep(input, local, byDate), spo2(input, local, byDate));
  return verdicts;
}

/** Chip of a person card: no sync past the threshold, any open episode, else fine. */
export function chipOf(now: number, last: number | null, hours: number, openRules: number): Chip {
  if (last === null || (now - last) / HOUR_MS >= hours) return "nosync";
  return openRules > 0 ? "check" : "ok";
}

/** When the cron has to look at the absence rules of this link again; never sooner than 15 minutes. */
export function nextCheckAt(input: EvalInput): number {
  const { now, rules, state, days } = input;
  const floor = now + 15 * 60_000;
  const last = dataAt(state, days);
  const candidates: number[] = [];
  if (rules.noSync.on) {
    if (last === null) candidates.push(now + HOUR_MS);
    else {
      const due = [rules.noSync.hours, 24, 72].map((h) => last + h * HOUR_MS).filter((t) => t > now);
      if (due.length > 0) candidates.push(Math.min(...due));
    }
  }
  if (rules.noSteps.on && last !== null && now - last < rules.noSync.hours * HOUR_MS) candidates.push(floor + 45 * 60_000);
  if (candidates.length === 0) return now + DAY_MS;
  return Math.max(floor, Math.min(...candidates));
}
