import { createHash } from "node:crypto";
import { describe, expect, test } from "bun:test";
import { bytesEqual, utf8Decode } from "../src/bytes";
import { getEntry } from "../src/hwt";
import { readV1Elements, getLayout } from "../src/layout";
import { buildSyntheticFixtures } from "../fixtures/synthetic/generate";
import { parsedFixtures } from "./helpers";

const synthetic = parsedFixtures().filter((f) => f.name.startsWith("synthetic/"));
const byName = (name: string) => synthetic.find((f) => f.name === `synthetic/${name}`)!;

describe("synthetic fixtures", () => {
  test("committed files are exactly what fixtures/synthetic/generate.ts produces", () => {
    const built = buildSyntheticFixtures();
    expect(synthetic.map((f) => f.name.slice("synthetic/".length)).sort()).toEqual(Object.keys(built).sort());
    for (const f of synthetic) expect(bytesEqual(f.bytes, built[f.name.slice("synthetic/".length)]!)).toBe(true);
  });

  test("hashCode lists SHA-256 of description.xml, com.huawei.watchface, ability.xml and watchface.bin", () => {
    const { pkg } = byName("SynthNested.hwhd09.hwt");
    const sha = (b: Uint8Array) => createHash("sha256").update(b).digest("hex").toUpperCase();
    const digests = utf8Decode(getEntry(pkg, "hashCode")!).split(",");
    expect(digests).toEqual(
      [getEntry(pkg, "description.xml")!, getEntry(pkg, "com.huawei.watchface")!, getEntry(pkg, "ability.xml")!, pkg.nested!.entries.find((e) => e.name === "watchface.bin")!.data].map(sha),
    );
    expect(pkg.archive.entries.map((e) => e.name)).toEqual(["ability.xml", "com.huawei.watchface", "description.xml", "hashCode", "preview/", "preview/aod.jpg", "preview/cover.jpg", "preview/icon_small.jpg"]);
  });

  test("version 1 samples differ in signature, image encoder and empty slot", () => {
    const hands = byName("SynthV1Hands.hwhd02.hwt").pkg.watchface!;
    const glyphs = byName("SynthV1Glyphs.hwhd02.hwt").pkg.watchface!;
    expect(hands.images[0]!.length).toBe(0);
    expect(glyphs.images.every((i) => i.length > 0)).toBe(true);
    expect([...hands.signature]).toEqual([0x55, 0x55, 0x55, 0x55, 1, 0, 0, 1]);
    expect([...glyphs.signature]).toEqual([0x2e, 0x2e, 0x2e, 0x2e, 1, 0, 0, 1]);
    expect(readV1Elements(getLayout(hands)).filter((e) => e.kind === "hand").some((e) => e.kind === "hand" && !Number.isInteger(e.startAngle))).toBe(true);
  });
});
