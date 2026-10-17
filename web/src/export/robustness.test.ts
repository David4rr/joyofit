import { describeLayout, getLayout, readHwt, type NamedObject } from "@joyofit/hwt";
import { afterEach, describe, expect, it, vi } from "vitest";
import { emptyProject, newHand, newImage, newTime } from "@/model/defaults";
import type { Element, Project } from "@/model/types";
import { ensureFont, fontFailed, fontSettled } from "@/render/fonts";
import { glyphCacheSizes, renderDigitSet } from "@/render/glyphs";
import { defaultSim, shownSim } from "@/render/values";
import { buildHwt } from "./build";
import { elementSupport } from "./support";

const sim = defaultSim();

function withElements(elements: Element[]): Project {
  const base = emptyProject("Robust");
  return { ...base, elements: [base.elements[0]!, ...elements] };
}

function drawTypes(bytes: Uint8Array): string[] {
  const named = describeLayout(getLayout(readHwt(bytes).watchface!));
  const out: string[] = [];
  const list = (v: unknown) => (Array.isArray(v) ? (v as NamedObject[]) : []);
  for (const element of list(named.element)) {
    for (const layer of list(element.layer)) out.push(String(layer.draw_type));
    for (const container of list(element.container)) for (const layer of list(container.layer)) out.push(String(layer.draw_type));
  }
  return out;
}

describe("export with images that did not load", () => {
  const ghostImage = newImage("never-loaded", 100, 100, { name: "Ghost image", x: 20, y: 20 });
  const ghostHand = newHand("second", { shape: "custom", assetId: "never-loaded", name: "Ghost hand" });
  const ghostPhoto = { ...emptyProject().elements[0]!, name: "Ghost photo", fill: { kind: "image", assetId: "never-loaded", zoom: 1, offsetX: 0, offsetY: 0, dim: 0 } } as Element;

  it("gates every image element on its decoded bitmap, not only on the id", () => {
    for (const el of [ghostImage, ghostHand, ghostPhoto]) {
      const support = elementSupport(el);
      expect(support.level, el.name).toBe("preview-only");
      expect(support.note).toMatch(/did not load/);
    }
  });

  it("does not throw, lists each problem, and writes no hand, no white square and no image for them", async () => {
    const project: Project = { ...withElements([ghostImage, ghostHand, newTime()]), elements: [ghostPhoto, ghostImage, ghostHand, newTime()] };
    const result = await buildHwt(project, sim, { includeExperimental: true });
    for (const el of [ghostPhoto, ghostImage, ghostHand]) {
      const entry = result.elements.find((e) => e.id === el.id)!;
      expect(entry.exported, el.name).toBe(false);
      expect(entry.detail, el.name).toMatch(/Preview only.*did not load/);
    }
    expect(result.elements.find((e) => e.type === "time")!.exported).toBe(true);
    expect(drawTypes(result.bytes)).not.toContain("DRAW_TYPE_HAND_RES");
    expect(result.notes.filter((n) => n.level === "error")).toEqual([]);
  });
});

describe("the time the export shows", () => {
  afterEach(() => vi.useRealTimers());

  it("is the time the stage shows when the clock is running", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 5, 1, 13, 37, 20));
    const now = Date.now();
    expect(shownSim({ ...sim, live: true, timeMs: 0 }).timeMs).toBe(now);
    expect(shownSim({ ...sim, live: false, timeMs: 123 }).timeMs).toBe(123);
    const result = await buildHwt(withElements([newTime()]), { ...sim, live: true, timeMs: 0 }, { includeExperimental: true });
    expect((result.debug.sim as { timeMs: number }).timeMs).toBe(now);
  });
});

describe("fonts that fail to load", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("lists the font in the export notes and caches its glyphs once loading has finished", async () => {
    // A browser where the file never arrives: `document.fonts.load` finds no face.
    vi.stubGlobal("document", { fonts: { load: async () => [], check: () => false } });
    const font = { family: "Plus Jakarta Sans Variable", weight: 800 };
    await ensureFont(font);
    expect(fontSettled(font)).toBe(true);
    expect(fontFailed(font)).toBe(true);

    const before = glyphCacheSizes().digits;
    const style = { font, digitHeight: 61, color: "#FFFFFF", outline: null };
    const first = renderDigitSet(style);
    expect(glyphCacheSizes().digits).toBe(before + 1);
    expect(renderDigitSet(style)).toBe(first);

    const result = await buildHwt(withElements([newTime({ font })]), sim, { includeExperimental: true });
    const note = result.notes.find((n) => /did not load/.test(n.text));
    expect(note?.level).toBe("warning");
    expect(note?.text).toContain("Plus Jakarta Sans Variable 800");
  });

  it("does not cache glyphs while the font is still loading", async () => {
    vi.stubGlobal("document", { fonts: { load: () => Promise.withResolvers<never[]>().promise, check: () => false } });
    const font = { family: "Plus Jakarta Sans Variable", weight: 300 };
    void ensureFont(font);
    expect(fontSettled(font)).toBe(false);
    const before = glyphCacheSizes().digits;
    const style = { font, digitHeight: 63, color: "#FFFFFF", outline: null };
    const a = renderDigitSet(style);
    expect(renderDigitSet(style)).not.toBe(a);
    expect(glyphCacheSizes().digits).toBe(before);
  });
});
