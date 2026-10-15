/**
 * Generator for the synthetic fixtures in this folder. Every file is built from scratch with this package's own writers
 * (`createHwt`, `FaceBuilder`, `buildMessage` + `SCHEMA_V1`, `encodeImage`, `writeZip`); no third-party artwork or brand
 * imagery is involved. Output is deterministic (fixed zip timestamps, no randomness): `test/synthetic.test.ts` rebuilds
 * everything in memory and requires the committed files to be byte-identical.
 *
 *     bun fixtures/synthetic/generate.ts        # rewrites the .hwt files next to this script
 */
import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { utf8Encode } from "../../src/bytes";
import { buildMessage } from "../../src/compose";
import { FaceBuilder } from "../../src/face";
import { createHwt, writeHwt, type HwtPackage } from "../../src/hwt";
import { encodeImage, type RgbaImage } from "../../src/image";
import { encodePb, type PbField } from "../../src/protobuf";
import { SCHEMA_V1 } from "../../src/schema-v1";
import { encodePng } from "../../src/png";
import { VALUE_TYPE } from "../../src/valuetypes";
import { imageRef, writeWatchface } from "../../src/watchface";
import { writeZip, type ZipEntry } from "../../src/zip";

/** 4 x 4 baseline JPEGs (ImageMagick, quality 50) standing in for the preview pictures; only their presence matters. */
const JPEG_BLUE = Uint8Array.from(
  atob(
    "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDABALDA4MChAODQ4SERATGCgaGBYWGDEjJR0oOjM9PDkzODdASFxOQERXRTc4UG1RV19iZ2hnPk1xeXBkeFxlZ2P/2wBDARESEhgVGC8aGi9jQjhCY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2P/wAARCAAEAAQDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAX/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFAEBAAAAAAAAAAAAAAAAAAAABP/EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAMAwEAAhEDEQA/AJYBor//2Q==",
  ),
  (c) => c.charCodeAt(0),
);
const JPEG_BROWN = Uint8Array.from(
  atob(
    "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDABALDA4MChAODQ4SERATGCgaGBYWGDEjJR0oOjM9PDkzODdASFxOQERXRTc4UG1RV19iZ2hnPk1xeXBkeFxlZ2P/2wBDARESEhgVGC8aGi9jQjhCY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2P/wAARCAAEAAQDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAT/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFAEBAAAAAAAAAAAAAAAAAAAABP/EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAMAwEAAhEDEQA/AIwAzH//2Q==",
  ),
  (c) => c.charCodeAt(0),
);

// ---------------------------------------------------------------------------------------------------------------------
// Pixel helpers

function canvas(width: number, height: number, fill: (x: number, y: number) => [number, number, number, number]): RgbaImage {
  const data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) data.set(fill(x, y), (y * width + x) * 4);
  return { width, height, data };
}

/** Vertical bands of flat colour: long runs, compresses like a designed background. */
function banded(width: number, height: number, seed: number): RgbaImage {
  return canvas(width, height, (x, y) => [((x >> 5) * 20 + seed * 37) & 255, ((y >> 5) * 16 + seed * 11) & 255, 64 + seed * 20, 255]);
}

/** Horizontal runs of 1, 2, 3, 5 and 8 pixels in cycling colours plus transparent gaps: exercises short RLE runs. */
function stripes(width: number, height: number, seed: number): RgbaImage {
  const widths = [2, 3, 1, 5, 8, 2, 2, 3];
  const palette: [number, number, number, number][] = [
    [200, 40 + seed * 30, 40, 255],
    [30, 160, 60 + seed * 20, 255],
    [0, 0, 0, 0],
    [240, 240, 240, 255],
    [20, 20, 120, 128],
  ];
  const data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    let x = 0;
    let k = y;
    while (x < width) {
      const run = widths[k % widths.length]!;
      const px = palette[(k + seed) % palette.length]!;
      for (let i = 0; i < run && x < width; i++, x++) data.set(px, (y * width + x) * 4);
      k++;
    }
  }
  return { width, height, data };
}

/** A block "digit": transparent margin, filled body in a colour per value, a lighter notch that differs per value. */
function glyph(width: number, height: number, value: number): RgbaImage {
  const body: [number, number, number, number] = [(value * 25) & 255, 255 - value * 20, 90 + value * 15, 255];
  return canvas(width, height, (x, y) => {
    if (x < 2 || y < 2 || x >= width - 2 || y >= height - 2) return [0, 0, 0, 0];
    if (x === 4 + value && y > 3 && y < height - 4) return [255, 255, 255, 255];
    return body;
  });
}

function hand(width: number, height: number, rgb: [number, number, number]): RgbaImage {
  return canvas(width, height, (x, y) => (Math.abs(x - width / 2) < width / 2 - 1 && y < height - 8 ? [...rgb, 255] : [0, 0, 0, 0]));
}

const TRANSPARENT = new Uint8Array(0);

// ---------------------------------------------------------------------------------------------------------------------
// Version 1 layouts

type V1Spec =
  | { kind: "image"; image: number; x: number; y: number }
  | { kind: "hand"; image: number; rect: [number, number, number, number]; pivot: [number, number]; start: number; end: number; valueType: number }
  | { kind: "text"; rect: [number, number, number, number]; color: [number, number, number, number]; font: number; align: number; valueType: number }
  | { kind: "glyphs"; x: number; y: number; valueType: number; table: number[] };

/** The v1 root repeats `title_en`, `title_cn` after every element. `slot` is a 0-based image slot, turned into a reference. */
function v1Layout(title: string, elements: V1Spec[]): Uint8Array {
  const fields: PbField[] = [];
  const titleField = (field: number): PbField => ({ field, wire: 2, bytes: utf8Encode(title) });
  for (const e of elements) {
    let value: Record<string, unknown>;
    if (e.kind === "image") {
      value = { type: 0, static_image: { image: imageRef(e.image), x: e.x, y: e.y } };
    } else if (e.kind === "hand") {
      value = {
        type: 1,
        hand: {
          image: imageRef(e.image),
          rect_x: e.rect[0],
          rect_y: e.rect[1],
          rect_width: e.rect[2],
          rect_height: e.rect[3],
          pivot_x: e.pivot[0],
          pivot_y: e.pivot[1],
          start_angle: e.start,
          end_angle: e.end,
          value_type: e.valueType,
        },
      };
    } else if (e.kind === "text") {
      value = {
        type: 3,
        text: {
          rect_x: e.rect[0],
          rect_y: e.rect[1],
          rect_width: e.rect[2],
          rect_height: e.rect[3],
          red: e.color[0],
          green: e.color[1],
          blue: e.color[2],
          alpha: e.color[3],
          font: e.font,
          align: e.align,
          value_type: e.valueType,
        },
      };
    } else {
      const table: Record<string, string> = {};
      // table[v] is the image shown for value v; -1 = no image
      e.table.forEach((slot, v) => {
        table[`value_${v}`] = slot < 0 ? "" : imageRef(slot);
      });
      value = { type: 6, glyphs: { x: e.x, y: e.y, value_type: e.valueType, glyph_table: table } };
    }
    const message = buildMessage(SCHEMA_V1, "Element", value as never);
    fields.push({ field: 1, wire: 2, bytes: encodePb(message), message }, titleField(2), titleField(3));
  }
  return encodePb({ fields });
}

interface V1Options {
  title: string;
  author: string;
  images: Uint8Array[];
  elements: V1Spec[];
  signature: Uint8Array;
}

function buildV1(o: V1Options): Uint8Array {
  const pkg = createHwt({ title: o.title, author: o.author, screen: "HWHD02", version: "2.1.9", cover: JPEG_BLUE, iconSmall: JPEG_BROWN, signature: o.signature });
  const wf = pkg.watchface!;
  wf.version = 1;
  wf.images = o.images;
  wf.layout = v1Layout(o.title, o.elements);
  return writeHwt(pkg);
}

/**
 * HWHD02, version 1 layout, signature 55 55 55 55 01 00 00 01, images written by a "minRun 2" encoder (every run of 2+ pixels
 * becomes an RLE record), an unused image slot 0 (table entry of size 0). Elements: static background, 4 text labels
 * (white, value 134), 6 hands with float angles (first one -150 .. 150, value 157), one hand sweeping 0 .. 360.
 */
function v1Hands(): Uint8Array {
  const enc = (img: RgbaImage) => encodeImage(img, { minRun: 2 });
  const images = [TRANSPARENT, enc(stripes(454, 454, 0)), enc(hand(14, 190, [220, 220, 220])), enc(hand(10, 230, [200, 40, 40])), enc(stripes(60, 60, 1))];
  const elements: V1Spec[] = [{ kind: "image", image: 1, x: 0, y: 0 }];
  for (const [i, [x, y]] of ([[107, 253], [250, 253], [180, 120], [180, 330]] as const).entries()) {
    elements.push({ kind: "text", rect: [x, y, 33, 18], color: [255, 255, 255, 255], font: 1, align: 1, valueType: 134 + i });
  }
  elements.push({ kind: "hand", image: 2, rect: [227, 37, 14, 190], pivot: [7, 190], start: -150, end: 150, valueType: 157 });
  for (const [i, [start, end]] of ([[-135.5, 135.5], [0, 360], [0, 270], [-90, 90], [0, 360]] as const).entries()) {
    elements.push({ kind: "hand", image: i % 2 === 0 ? 3 : 2, rect: [222, 0, 10, 230], pivot: [5, 230], start, end, valueType: 150 + i });
  }
  elements.push({ kind: "image", image: 4, x: 197, y: 197 });
  return buildV1({ title: "SynthHands", author: "joyofit-fixtures", images, elements, signature: Uint8Array.from([0x55, 0x55, 0x55, 0x55, 0x01, 0x00, 0x00, 0x01]) });
}

/**
 * HWHD02, version 1 layout, signature 2e 2e 2e 2e 01 00 00 01, minRun 4 images. Elements: 2 static images, 8 glyph tables
 * (value types 59 hour high / 60 hour low / 61 minute high / 62 minute low / 51 month / 70 date high / 71 date low / 52 week),
 * one hand sweeping 0 .. 360 (value 154) with pivot (13, 226).
 */
function v1Glyphs(): Uint8Array {
  const digitBase = 3; // slots 3..12 = digits 0..9
  const images: Uint8Array[] = [encodeImage(glyph(30, 30, 0)), encodeImage(banded(454, 454, 0)), encodeImage(banded(454, 454, 1))];
  for (let d = 0; d < 10; d++) images.push(encodeImage(glyph(44, 66, d)));
  images.push(encodeImage(hand(26, 240, [240, 60, 60]))); // slot 13
  const digits = (n: number) => Array.from({ length: n }, (_, d) => digitBase + d);
  const elements: V1Spec[] = [
    { kind: "image", image: 1, x: 0, y: 0 },
    { kind: "image", image: 2, x: 0, y: 0 },
    { kind: "glyphs", x: 136, y: 100, valueType: 59, table: digits(3) },
    { kind: "glyphs", x: 186, y: 100, valueType: 60, table: digits(10) },
    { kind: "glyphs", x: 136, y: 190, valueType: 61, table: digits(6) },
    { kind: "glyphs", x: 186, y: 190, valueType: 62, table: digits(10) },
    { kind: "glyphs", x: 300, y: 300, valueType: 51, table: [-1, ...Array.from({ length: 12 }, (_, m) => digitBase + (m % 10))] },
    { kind: "glyphs", x: 300, y: 340, valueType: 70, table: digits(4) },
    { kind: "glyphs", x: 340, y: 340, valueType: 71, table: digits(10) },
    { kind: "glyphs", x: 300, y: 380, valueType: 52, table: [-1, ...digits(7)] },
    { kind: "hand", image: 13, rect: [214, 0, 26, 240], pivot: [13, 226], start: 0, end: 360, valueType: 154 },
  ];
  return buildV1({ title: "SynthGlyphs", author: "joyofit-fixtures", images, elements, signature: Uint8Array.from([0x2e, 0x2e, 0x2e, 0x2e, 0x01, 0x00, 0x00, 0x01]) });
}

// ---------------------------------------------------------------------------------------------------------------------
// Version 2 layouts

function digitSet(width: number, height: number): RgbaImage[] {
  return Array.from({ length: 10 }, (_, d) => glyph(width, height, d));
}

function sha256Upper(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex").toUpperCase();
}

/**
 * HWHD09 (466 x 466), version 2 layout, NESTED container: `com.huawei.watchface` is a zip with `watchface.bin`,
 * `watchface/res/*.png`, `watch_face_config.xml`, `watch_face_info.xml`; the outer zip also carries `ability.xml` and
 * `hashCode` (comma separated upper-case SHA-256 of description.xml, com.huawei.watchface, ability.xml, watchface.bin; the
 * real exporter's 4th digest input is unknown, so this one is our own choice). Elements: background, hour/minute digits,
 * a seconds hand.
 */
function nested(): Uint8Array {
  const pkg: HwtPackage = createHwt({
    title: "SynthNested",
    author: "joyofit-fixtures",
    screen: "HWHD09",
    version: "2.0.4",
    cover: JPEG_BLUE,
    aod: JPEG_BROWN,
    iconSmall: JPEG_BLUE,
    thumbnail: banded(250, 250, 2),
  });
  const face = new FaceBuilder(pkg.watchface!);
  const background = banded(466, 466, 3);
  const digits = digitSet(40, 60);
  const secondHand = hand(12, 200, [230, 90, 30]);
  face.element("background", (e) => e.singleImage({ image: background, x: 0, y: 0, ambient: "normal" }), { preview: background });
  face.element("time", (e) => {
    e.digits({ digits, x: 150, y: 150, align: "right", valueType: VALUE_TYPE.hour, ambient: "both" });
    e.digits({ digits, x: 250, y: 150, align: "left", valueType: VALUE_TYPE.minute, ambient: "both" });
  });
  face.element("widget", (e) => e.hand({ image: secondHand, rect: { x: 227, y: 33, width: 12, height: 200 }, pivot: { x: 6, y: 200 }, startAngle: 0, endAngle: 360, valueType: VALUE_TYPE.secondRatio, ambient: "normal" }));
  face.commit();

  const binary = writeWatchface(pkg.watchface!);
  const config = `<?xml version="1.0" encoding="UTF-8"?>\n<WatchFace generator="joyofit-fixtures" screen="HWHD09" images="${pkg.watchface!.images.length}"/>\n`;
  const nestedEntries: ZipEntry[] = [
    { name: "watchface/", data: new Uint8Array(0) },
    { name: "watchface/res/", data: new Uint8Array(0) },
    { name: "watchface/res/A100_001.png", data: encodePng(background) },
    { name: "watchface/res/A100_002.png", data: encodePng(secondHand) },
    { name: "watchface/watch_face_config.xml", data: utf8Encode(config) },
    { name: "watchface/watch_face_info.xml", data: new Uint8Array(0) }, // filled with description.xml below
    { name: "watchface.bin", data: binary },
  ];
  pkg.container = "nested";
  pkg.nested = { entries: nestedEntries, comment: new Uint8Array(0), prefix: new Uint8Array(0) };
  const outer = pkg.archive.entries;
  const get = (name: string) => outer.find((e) => e.name === name)!;
  nestedEntries[5]!.data = get("description.xml").data;
  get("com.huawei.watchface").data = writeZip(pkg.nested);
  const ability: ZipEntry = { name: "ability.xml", data: utf8Encode(`<?xml version="1.0" encoding="UTF-8"?>\n<ability generator="joyofit-fixtures"/>\n`) };
  const hash: ZipEntry = { name: "hashCode", data: new Uint8Array(0) };
  hash.data = utf8Encode(
    [get("description.xml").data, get("com.huawei.watchface").data, ability.data, binary].map(sha256Upper).join(","),
  );
  const order = ["ability.xml", "com.huawei.watchface", "description.xml", "hashCode", "preview/", "preview/aod.jpg", "preview/cover.jpg", "preview/icon_small.jpg"];
  const byName = new Map([...outer, ability, hash].map((e) => [e.name, e]));
  pkg.archive.entries = order.map((n) => byName.get(n)!);
  return writeHwt(pkg);
}

/** HWHD07 (368 x 194, band), flat version 2 package: background plus a time element. Covers the HWHD07 description and resolution. */
function band(): Uint8Array {
  const pkg = createHwt({ title: "SynthBand", author: "joyofit-fixtures", screen: "HWHD07", version: "2.1.1", cover: JPEG_BROWN, aod: JPEG_BLUE, iconSmall: JPEG_BROWN });
  const face = new FaceBuilder(pkg.watchface!);
  const background = banded(194, 368, 4);
  const digits = digitSet(36, 54);
  face.element("background", (e) => e.singleImage({ image: background, x: 0, y: 0, ambient: "normal" }), { preview: background });
  face.element("time", (e) => {
    e.digits({ digits, x: 60, y: 40, align: "right", valueType: VALUE_TYPE.hour, ambient: "both" });
    e.digits({ digits, x: 100, y: 40, align: "left", valueType: VALUE_TYPE.minute, ambient: "both" });
  });
  face.commit();
  return writeHwt(pkg);
}

/** File name (relative to this folder) -> bytes. */
export function buildSyntheticFixtures(): Record<string, Uint8Array> {
  return {
    "SynthV1Hands.hwhd02.hwt": v1Hands(),
    "SynthV1Glyphs.hwhd02.hwt": v1Glyphs(),
    "SynthNested.hwhd09.hwt": nested(),
    "SynthBand.hwhd07.hwt": band(),
  };
}

if (import.meta.main) {
  for (const [name, bytes] of Object.entries(buildSyntheticFixtures())) {
    writeFileSync(join(import.meta.dir, name), bytes);
    console.log(`${name}  ${bytes.length} bytes`);
  }
}
