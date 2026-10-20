import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { PROTOCOLS } from "../../src/features/scale/registry";
import { build, render } from "./timbangan";

test("every protocol in the app's registry is on the page exactly once", () => {
  const listed = build().flatMap((family) => family.items.map((item) => item.nama));
  expect(listed).toHaveLength(PROTOCOLS.length);
});

test("src/timbangan.ts is what the registry generates", () => {
  const committed = readFileSync(new URL("../src/timbangan.ts", import.meta.url), "utf8");
  expect(committed).toBe(render());
});
