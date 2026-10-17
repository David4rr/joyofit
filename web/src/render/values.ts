import { FIELDS, fieldDef } from "@/model/fields";
import type { Sim } from "@/model/types";

/** What a digit sequence or a selected-by-value image shows. `field` is a data number: the part says which id. */
export type DataRole = "hour" | "minute" | "second" | "ampm" | "weekday" | "day" | "month" | "field";

export interface ClockFields {
  hour: number;
  minute: number;
  second: number;
  pm: boolean;
  weekday: number;
  day: number;
  month: number;
}

export function clockFields(timeMs: number, ampm: boolean): ClockFields {
  const d = new Date(timeMs);
  const h = d.getHours();
  return {
    hour: ampm ? h % 12 || 12 : h,
    minute: d.getMinutes(),
    second: d.getSeconds(),
    pm: h >= 12,
    /** 0 = Monday ... 6 = Sunday. */
    weekday: (d.getDay() + 6) % 7,
    day: d.getDate(),
    month: d.getMonth(),
  };
}

export function digitList(value: number, minDigits: number): number[] {
  return String(Math.max(0, Math.floor(value))).padStart(minDigits, "0").split("").map(Number);
}

export function defaultSim(now = Date.now()): Sim {
  const d = new Date(now);
  d.setHours(10, 9, 36, 0);
  const values: Record<number, number> = {};
  for (const f of FIELDS) if (f.sim) values[f.id] = f.sim.default;
  return { timeMs: d.getTime(), live: false, stepGoal: 10000, values };
}

/** The state the stage shows: a running clock reads the real time at the moment of the call. */
export function shownSim(sim: Sim): Sim {
  return sim.live ? { ...sim, timeMs: Date.now() } : sim;
}

/** Preview value of a field before it is clamped to what the watch can show. */
export function simValue(sim: Sim, id: number): number {
  return sim.values[id] ?? fieldDef(id)?.sim?.default ?? 0;
}

/** Value of a number field, clamped to what the watch can show. */
export function fieldValue(id: number, sim: Sim): number {
  const spec = fieldDef(id)?.number;
  const v = Math.round(simValue(sim, id));
  return spec ? Math.max(spec.min, Math.min(spec.max, v)) : Math.max(0, v);
}

/** Fraction 0..1 a ratio field fills, from the number it follows. */
export function fieldFraction(id: number, sim: Sim): number {
  const spec = fieldDef(id)?.ratio;
  if (!spec) return 0;
  return Math.max(0, Math.min(1, spec.scale(fieldValue(spec.follows, sim), sim)));
}

/** Index of the image an icon set shows. */
export function iconSetIndex(id: number, sim: Sim): number {
  const spec = fieldDef(id)?.iconSet;
  return spec ? spec.index(fieldValue(spec.follows, sim)) : 0;
}
