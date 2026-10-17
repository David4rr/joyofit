import { describe, expect, it } from "vitest";

import { evaluate, localParts, nextCheckAt, restingBaseline, shiftDate, type EvalInput } from "../src/family/rules";
import { DEFAULT_RULES, HOUR_MS, type DayRow, type Rules, type Scopes, type StateRow } from "../src/family/types";

const ALL: Scopes = { sync: true, steps: true, sleep: true, restingHr: true, spo2: true };
// 2026-10-14 12:00 UTC = 19:00 in WIB
const NOW = Date.parse("2026-10-14T05:00:00Z"); // 12:00 WIB
const TODAY = "2026-10-14";

const day = (date: string, over: Partial<DayRow> = {}): DayRow => ({ date, steps: null, firstStepAt: null, restingHr: null, sleepMin: null, spo2Min: null, spo2LowCount: null, lastSampleAt: null, ...over });
const state = (over: Partial<StateRow> = {}): StateRow => ({ phoneSeenAt: NOW - HOUR_MS, watchSyncAt: NOW - HOUR_MS, battery: 80, tzOffsetMin: 420, ...over });

/** `n` days before today with the given resting HR. */
const history = (n: number, hr: number): DayRow[] => Array.from({ length: n }, (_, i) => day(shiftDate(TODAY, -(i + 1)), { restingHr: hr }));

function run(over: Omit<Partial<EvalInput>, "rules"> & { rules?: Partial<Rules> } = {}) {
  const { rules, ...rest } = over;
  return evaluate({ now: NOW, label: "Ibu", scopes: ALL, rules: { ...DEFAULT_RULES, ...rules }, state: state(), days: [], ...rest });
}
const slot = (v: ReturnType<typeof run>, name: string) => v.find((x) => x.slot === name);

describe("local time", () => {
  it("shifts by the monitored person's offset", () => {
    expect(localParts(Date.parse("2026-10-14T20:00:00Z"), 420)).toEqual({ date: "2026-10-15", hour: 3, minutes: 180 });
    expect(localParts(Date.parse("2026-10-14T20:00:00Z"), -300).date).toBe("2026-10-14");
  });
});

describe("rule 2: no sync", () => {
  it("is quiet before the threshold", () => {
    expect(slot(run({ state: state({ watchSyncAt: NOW - 11 * HOUR_MS }) }), "noSync")).toMatchObject({ active: false });
  });
  it("fires after 12 h inside 07:00-21:00 and says the phone is silent when the phone is silent too", () => {
    const v = slot(run({ state: state({ watchSyncAt: NOW - 13 * HOUR_MS, phoneSeenAt: NOW - 13 * HOUR_MS }) }), "noSync");
    expect(v?.active).toBe(true);
    expect(v?.finding?.body).toContain("Ponsel Ibu");
    expect(v?.finding?.level).toBe("push");
  });
  it("blames the watch when the phone was seen recently, and mentions a low battery", () => {
    const v = slot(run({ state: state({ watchSyncAt: NOW - 13 * HOUR_MS, phoneSeenAt: NOW - 600_000, battery: 8 }) }), "noSync");
    expect(v?.finding?.body).toContain("Jam Ibu");
    expect(v?.finding?.body).toContain("8%");
  });
  it("does not push at night but stays active", () => {
    const night = Date.parse("2026-10-14T18:00:00Z"); // 01:00 WIB
    const v = slot(run({ now: night, state: state({ watchSyncAt: night - 14 * HOUR_MS }) }), "noSync");
    expect(v).toMatchObject({ active: true });
    expect(v?.finding).toBeUndefined();
  });
  it("repeats at 24 h and 72 h as new keys", () => {
    const key = (hours: number) => slot(run({ state: state({ watchSyncAt: NOW - hours * HOUR_MS }) }), "noSync")?.finding?.key;
    expect(new Set([key(13), key(25), key(80)]).size).toBe(3);
    const sync = NOW - 13 * HOUR_MS;
    const at = (now: number) => slot(run({ now, state: state({ watchSyncAt: sync }) }), "noSync")?.finding?.key;
    expect(at(NOW)).toBe(at(NOW + HOUR_MS));
  });
  it("cannot judge a person who never synced", () => {
    expect(slot(run({ state: null }), "noSync")).toMatchObject({ active: null });
  });
});

describe("rule 3: no steps", () => {
  const fresh = state({ watchSyncAt: NOW - 600_000 });
  it("fires when fresh data shows under 200 steps past the hour", () => {
    const v = slot(run({ state: fresh, days: [day(TODAY, { steps: 40 })] }), "noSteps");
    expect(v?.active).toBe(true);
    expect(v?.finding?.key).toBe(`noSteps:${TODAY}`);
  });
  it("is quiet with enough steps, before the hour, or without the steps scope", () => {
    expect(slot(run({ state: fresh, days: [day(TODAY, { steps: 900 })] }), "noSteps")).toMatchObject({ active: false });
    expect(slot(run({ state: fresh, days: [day(TODAY, { steps: 0 })], rules: { noSteps: { on: true, hour: 14 } }, now: NOW - 2 * HOUR_MS }), "noSteps")).toMatchObject({ active: null });
    expect(slot(run({ state: fresh, scopes: { ...ALL, steps: false }, days: [day(TODAY, { steps: 0 })] }), "noSteps")).toMatchObject({ active: null });
  });
  it("is silenced by a stale feed", () => {
    expect(slot(run({ state: state({ watchSyncAt: NOW - 20 * HOUR_MS }), days: [day(TODAY, { steps: 0 })] }), "noSteps")).toMatchObject({ active: null });
  });
});

describe("rule 1: resting heart rate", () => {
  const base = history(14, 62);
  it("needs seven days of baseline before comparing", () => {
    expect(restingBaseline(history(6, 62), TODAY).restingHr).toBeNull();
    expect(restingBaseline(base, TODAY).restingHr).toBe(62);
    const v = slot(run({ days: [...history(3, 62), day(TODAY, { restingHr: 85 })] }), "restingHr");
    expect(v?.active).toBe(false);
  });
  it("fires once at baseline + 20", () => {
    const v = slot(run({ days: [...base, day(TODAY, { restingHr: 83 })] }), "restingHr");
    expect(v?.finding?.rule).toBe("rhrHigh");
    expect(v?.finding?.body).toContain("bukan diagnosis");
  });
  it("fires on two days at baseline + max(10, 15%) but not on one", () => {
    const oneDay = slot(run({ days: [...history(14, 62).slice(1), day(shiftDate(TODAY, -1), { restingHr: 62 }), day(TODAY, { restingHr: 73 })] }), "restingHr");
    expect(oneDay?.active).toBe(false);
    const twoDays = slot(run({ days: [...history(14, 62).slice(1), day(shiftDate(TODAY, -1), { restingHr: 73 }), day(TODAY, { restingHr: 73 })] }), "restingHr");
    expect(twoDays?.finding?.rule).toBe("rhrHigh");
  });
  it("fires at 100 bpm even without a baseline", () => {
    expect(slot(run({ days: [day(TODAY, { restingHr: 101 })] }), "restingHr")?.finding?.rule).toBe("rhrHigh");
  });
  it("fires low only when far under baseline and under 45", () => {
    expect(slot(run({ days: [...base, day(TODAY, { restingHr: 44 })] }), "restingHr")?.finding?.rule).toBe("rhrLow");
    expect(slot(run({ days: [...base, day(TODAY, { restingHr: 50 })] }), "restingHr")?.active).toBe(false);
  });
  it("respects the switch and the scope", () => {
    expect(slot(run({ days: [day(TODAY, { restingHr: 120 })], rules: { restingHr: { on: false } } }), "restingHr")?.active).toBeNull();
    expect(slot(run({ days: [day(TODAY, { restingHr: 120 })], scopes: { ...ALL, restingHr: false } }), "restingHr")?.active).toBeNull();
  });
});

describe("rule 4: poor sleep", () => {
  it("is a digest item under 4 h", () => {
    const v = slot(run({ days: [day(TODAY, { sleepMin: 200 })] }), "sleep");
    expect(v?.finding?.level).toBe("digest");
  });
  it("fires on three nights under 5.5 h but not two", () => {
    const three = [day(TODAY, { sleepMin: 320 }), day(shiftDate(TODAY, -1), { sleepMin: 300 }), day(shiftDate(TODAY, -2), { sleepMin: 310 })];
    expect(slot(run({ days: three }), "sleep")?.active).toBe(true);
    expect(slot(run({ days: [three[0]!, three[1]!, day(shiftDate(TODAY, -2), { sleepMin: 420 })] }), "sleep")?.active).toBe(false);
  });
  it("treats missing sleep as unknown, not poor", () => {
    expect(slot(run({ days: [day(TODAY, { steps: 500 })] }), "sleep")?.active).toBeNull();
  });
});

describe("rule 5: low SpO2", () => {
  const on = { spo2: { on: true } };
  it("is off by default", () => {
    expect(slot(run({ days: [day(TODAY, { spo2Min: 85, spo2LowCount: 4 })] }), "spo2")?.active).toBeNull();
  });
  it("fires on two low readings and speaks of the watch's reading", () => {
    const v = slot(run({ rules: on, days: [day(TODAY, { spo2Min: 88, spo2LowCount: 2 })] }), "spo2");
    expect(v?.finding?.body).toContain("Kata jam");
    expect(v?.finding?.title).toContain("Jam Ibu");
  });
  it("fires on two nights at or under 90 and needs a reading in the last week", () => {
    expect(slot(run({ rules: on, days: [day(TODAY, { spo2Min: 90, spo2LowCount: 1 }), day(shiftDate(TODAY, -1), { spo2Min: 89 })] }), "spo2")?.active).toBe(true);
    expect(slot(run({ rules: on, days: [day(TODAY, { steps: 5 })] }), "spo2")?.active).toBeNull();
  });
});

describe("nextCheckAt", () => {
  it("waits for the first threshold but never under 15 minutes", () => {
    const next = nextCheckAt({ now: NOW, label: "Ibu", scopes: ALL, rules: { ...DEFAULT_RULES, noSteps: { on: false, hour: 11 } }, state: state({ watchSyncAt: NOW - 2 * HOUR_MS }), days: [] });
    expect(next).toBe(NOW + 10 * HOUR_MS);
    const soon = nextCheckAt({ now: NOW, label: "Ibu", scopes: ALL, rules: { ...DEFAULT_RULES, noSteps: { on: false, hour: 11 } }, state: state({ watchSyncAt: NOW - 12 * HOUR_MS + 60_000 }), days: [] });
    expect(soon).toBe(NOW + 15 * 60_000);
  });
});
