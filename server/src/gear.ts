import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";

import { requireFounder } from "./access";
import { readJson } from "./body";
import { D1_MAX_VALUE_BYTES, utf8Bytes } from "./d1";
import type { AppContext } from "./env";
import { MAX_GEAR_BODY_BYTES } from "./limits";

const nullableText = (max: number) => z.string().max(max).nullable();

const gearSchema = z.looseObject({
  id: z.string().min(1).max(64),
  kind: z.enum(["shoes", "bike", "other"]),
  name: z.string().min(1).max(80),
  brand: nullableText(80),
  model: nullableText(80),
  startDistanceM: z.number().min(0),
  retireAtM: z.number().min(0).nullable(),
  stravaGearId: nullableText(40),
  stravaGearName: nullableText(120),
  retiredAt: z.number().nullable(),
  createdAt: z.number(),
  updatedAt: z.number(),
  deletedAt: z.number().nullable(),
  notified: z.number().int().min(0).max(2).default(0),
});

const defaultSchema = z.looseObject({
  sport: z.enum(["run", "walk", "ride"]),
  gearId: z.string().nullable(),
  since: z.number(),
  updatedAt: z.number(),
});

const assignmentSchema = z.looseObject({
  workoutStart: z.number().int(),
  gearId: z.string().nullable(),
  source: z.enum(["default", "manual"]),
  updatedAt: z.number(),
});

const gearDocSchema = z.looseObject({
  version: z.literal(1),
  gear: z.array(gearSchema).max(200),
  defaults: z.array(defaultSchema).max(20),
  assignments: z.array(assignmentSchema).max(50_000),
});

const putBodySchema = z.object({
  baseRev: z.number().int().min(0),
  doc: gearDocSchema,
});

interface GearRow {
  doc: string;
  rev: number;
}

const selectRow = "SELECT doc, rev FROM gear_doc WHERE user_id = ?1";

export const gear = new Hono<AppContext>();

gear.get("/", async (c) => {
  const row = await c.env.DB.prepare(selectRow).bind(c.get("user").id).first<GearRow>();
  return c.json({ rev: row?.rev ?? 0, doc: row ? (JSON.parse(row.doc) as unknown) : null });
});

gear.put("/", requireFounder, async (c) => {
  const { baseRev, doc } = putBodySchema.parse(await readJson(c.req.raw, MAX_GEAR_BODY_BYTES));
  const userId = c.get("user").id;
  const json = JSON.stringify(doc);
  // The body is capped, but re-serializing can grow it (1e20 parses to a 21-digit number): D1 refuses a value over 2 MB.
  if (utf8Bytes(json) > D1_MAX_VALUE_BYTES) throw new HTTPException(413, { message: "too_large" });
  const now = Date.now();
  // One statement decides: the SELECT yields a row only when baseRev equals the stored rev (0 when absent); that row
  // inserts the first doc or, on conflict, replaces the stored one.
  const result = await c.env.DB.prepare(
    `INSERT INTO gear_doc (user_id, doc, rev, updated_at)
     SELECT ?1, ?2, ?3 + 1, ?4 WHERE ?3 = COALESCE((SELECT rev FROM gear_doc WHERE user_id = ?1), 0)
     ON CONFLICT (user_id) DO UPDATE SET doc = excluded.doc, rev = excluded.rev, updated_at = excluded.updated_at`,
  )
    .bind(userId, json, baseRev, now)
    .run();
  if (result.meta.changes === 1) return c.json({ rev: baseRev + 1 });
  const current = await c.env.DB.prepare(selectRow).bind(userId).first<GearRow>();
  return c.json({ error: "conflict", rev: current?.rev ?? 0, doc: current ? (JSON.parse(current.doc) as unknown) : null }, 409);
});
