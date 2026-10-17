/**
 * Renders icon.svg to the two icons the Lite Wearable template ships: icon.png (114 x 114) and icon_small.png (80 x 80),
 * into entry/src/main/resources/base/media. The Huawei install guide names 80 x 80 and 114 x 114 as the normal icon
 * sizes (error 40 can come from a larger icon).
 *
 * Needs @resvg/resvg-js, which faces/ already depends on: run `bun install` in faces/ once, then
 *   bun watchapp/fuel/scripts/make-icons.ts
 */
import { createRequire } from "node:module";
import { readFileSync, writeFileSync } from "node:fs";

const require = createRequire(new URL("../../../faces/package.json", import.meta.url));
const { Resvg } = require("@resvg/resvg-js") as typeof import("@resvg/resvg-js");

const root = new URL("../", import.meta.url);
const svg = readFileSync(new URL("icon.svg", root));
const media = new URL("entry/src/main/resources/base/media/", root);

for (const [name, size] of [
  ["icon.png", 114],
  ["icon_small.png", 80],
] as const) {
  const png = new Resvg(svg, { fitTo: { mode: "width", value: size } }).render().asPng();
  writeFileSync(new URL(name, media), png);
  console.log(`${name}: ${size}x${size}, ${png.length} bytes`);
}
