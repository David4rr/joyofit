import { describe, expect, it } from "vitest";

import { chunk, chunkByWeight, D1_MAX_PARAMS, D1_MAX_STATEMENT_BYTES, D1_MAX_VALUE_BYTES, utf8Bytes } from "../src/d1";
import { env } from "./helpers";

const placeholders = (n: number) => Array.from({ length: n }, (_, i) => `?${i + 1}`).join(",");

describe("chunk", () => {
  it("splits in order, keeps the remainder, and gives nothing for nothing", () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(chunk([1, 2], 2)).toEqual([[1, 2]]);
    expect(chunk([], 3)).toEqual([]);
  });
  it("refuses a size that would loop forever", () => {
    expect(() => chunk([1], 0)).toThrow(RangeError);
    expect(() => chunk([1], 1.5)).toThrow(RangeError);
  });
  it("a slice of D1_MAX_PARAMS rows binds at most 100 parameters at one parameter each", () => {
    const slices = chunk(Array.from({ length: 250 }, (_, i) => i), D1_MAX_PARAMS);
    expect(slices.map((s) => s.length)).toEqual([100, 100, 50]);
  });
});

describe("chunkByWeight", () => {
  it("closes a slice before it would pass the cap and keeps order", () => {
    expect(chunkByWeight([4, 4, 4, 4, 4], (n) => n, 10)).toEqual([[4, 4], [4, 4], [4]]);
  });
  it("gives an item heavier than the cap a slice of its own", () => {
    expect(chunkByWeight([1, 50, 1], (n) => n, 10)).toEqual([[1], [50], [1]]);
  });
  it("gives nothing for nothing", () => {
    expect(chunkByWeight([], () => 1, 10)).toEqual([]);
  });
});

describe("the test D1 refuses what production D1 refuses", () => {
  it("accepts exactly 100 bound parameters and refuses 101 (statement and batch)", async () => {
    const select = (n: number) => `SELECT json_array(${placeholders(n)}) AS s`;
    const ok = await env.DB.prepare(select(D1_MAX_PARAMS)).bind(...Array(D1_MAX_PARAMS).fill(1)).first<{ s: string }>();
    expect(JSON.parse(ok!.s)).toHaveLength(D1_MAX_PARAMS);
    await expect(env.DB.batch([env.DB.prepare(select(D1_MAX_PARAMS)).bind(...Array(D1_MAX_PARAMS).fill(1))])).resolves.toHaveLength(1);
    expect(() => env.DB.prepare(select(D1_MAX_PARAMS + 1)).bind(...Array(D1_MAX_PARAMS + 1).fill(1))).toThrow(/101 bound parameters/);
    expect(() => env.DB.batch([env.DB.prepare("SELECT ?1").bind(...Array(D1_MAX_PARAMS + 1).fill(1))])).toThrow(/101 bound parameters/);
  });

  it("refuses statement text over 100 KB", () => {
    expect(() => env.DB.prepare(`SELECT 1 /*${"x".repeat(D1_MAX_STATEMENT_BYTES)}*/`)).toThrow(/statement text/);
  });

  it("refuses a string over 2 MB by its UTF-8 size, and takes one at the cap", async () => {
    const atCap = "x".repeat(D1_MAX_VALUE_BYTES);
    const row = await env.DB.prepare("SELECT length(?1) AS n").bind(atCap).first<{ n: number }>();
    expect(row?.n).toBe(D1_MAX_VALUE_BYTES);
    expect(() => env.DB.prepare("SELECT ?1").bind(`${atCap}x`)).toThrow(/bytes/);
    // 700 000 three-byte characters are under 2 MB as a string length but over it as UTF-8.
    const wide = "€".repeat(700_000);
    expect(wide.length).toBeLessThan(D1_MAX_VALUE_BYTES);
    expect(utf8Bytes(wide)).toBeGreaterThan(D1_MAX_VALUE_BYTES);
    expect(() => env.DB.prepare("SELECT ?1").bind(wide)).toThrow(/bytes/);
    expect(() => env.DB.prepare("SELECT ?1").bind(new Uint8Array(D1_MAX_VALUE_BYTES + 1))).toThrow(/bytes/);
  });

  it("the local D1 itself refuses a LIKE pattern over 50 bytes", async () => {
    await expect(env.DB.prepare("SELECT 'a' LIKE ?1").bind(`%${"a".repeat(60)}`).first()).rejects.toThrow(/LIKE or GLOB pattern too complex/);
  });
});
