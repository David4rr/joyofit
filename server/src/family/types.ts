import { z } from "zod";

export const HOUR_MS = 3_600_000;
export const DAY_MS = 86_400_000;

export const scopesSchema = z.object({
  sync: z.boolean(),
  steps: z.boolean(),
  sleep: z.boolean(),
  restingHr: z.boolean(),
  spo2: z.boolean(),
});
export type Scopes = z.infer<typeof scopesSchema>;

export const NO_SCOPES: Scopes = { sync: false, steps: false, sleep: false, restingHr: false, spo2: false };

export type LinkStatus = "pending" | "active" | "paused" | "revoked";
export type Chip = "ok" | "check" | "nosync";

/** A day of the monitored person's summary, as stored. */
export interface DayRow {
  date: string;
  steps: number | null;
  firstStepAt: number | null;
  restingHr: number | null;
  sleepMin: number | null;
  spo2Min: number | null;
  spo2LowCount: number | null;
  lastSampleAt: number | null;
}

export interface StateRow {
  phoneSeenAt: number | null;
  watchSyncAt: number | null;
  battery: number | null;
  tzOffsetMin: number;
}

export const rulesSchema = z.object({
  noSync: z.object({ on: z.boolean(), hours: z.number().int().min(3).max(48) }),
  restingHr: z.object({ on: z.boolean() }),
  noSteps: z.object({ on: z.boolean(), hour: z.number().int().min(9).max(14) }),
  sleep: z.object({ on: z.boolean() }),
  spo2: z.object({ on: z.boolean() }),
  push: z.boolean(),
  email: z.boolean(),
  quietStart: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  quietEnd: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
});
export type Rules = z.infer<typeof rulesSchema>;

/** Defaults: the free "no sync" push is on; the SpO2 rule is off until the watcher turns it on. */
export const DEFAULT_RULES: Rules = {
  noSync: { on: true, hours: 12 },
  restingHr: { on: true },
  noSteps: { on: true, hour: 11 },
  sleep: { on: true },
  spo2: { on: false },
  push: true,
  email: false,
  quietStart: "21:30",
  quietEnd: "06:30",
};

export type RuleId = "noSync" | "rhrHigh" | "rhrLow" | "noSteps" | "sleep" | "spo2";
export type AlertLevel = "push" | "digest";
