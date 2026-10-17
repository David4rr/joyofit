import { VALUE_TYPE, VALUE_TYPES, WIDGET_DATA_TYPE, valueTypeInfo } from "@joyofit/hwt";
import { describe, expect, it } from "vitest";
import { readSaved, readSavedState, STORAGE_KEY } from "@/editor/store";
import { elementSupport, levelOfId } from "@/export/support";
import { canDrawIconSet } from "@/render/iconsets";
import { defaultSim, fieldFraction, fieldValue, simValue } from "@/render/values";
import { layoutWidget } from "@/render/layout";
import { emptyProject, newIconSet, newRing, newWidget } from "./defaults";
import { FIELDS, HOSTED_BY, LEGACY_CALORIES_ID, NO_ELEMENT, fieldDef } from "./fields";
import { parseProjectFile, restoreProject, ProjectFileError, serializeProject } from "./projectFile";
import { PROJECT_VERSION, type Element } from "./types";

const slots = new Set<number>(Object.values(WIDGET_DATA_TYPE));

describe("field registry", () => {
  it("keys every field by a codec id and agrees with the codec's own table", () => {
    const ids = new Set<number>();
    for (const f of FIELDS) {
      expect(ids.has(f.id), `duplicate id ${f.id}`).toBe(false);
      ids.add(f.id);
      const info = valueTypeInfo(f.id);
      expect(info, `id ${f.id} is not in VALUE_TYPES`).toBeDefined();
      // Exactly one way of drawing the field, and it matches the codec's data category.
      expect([f.number, f.ratio, f.iconSet].filter(Boolean)).toHaveLength(1);
      expect(info!.category).toBe(f.number ? "raw" : f.ratio ? "ratio" : "enum");
      if (f.slot !== undefined) expect(slots.has(f.slot)).toBe(true);
    }
  });

  it("gives every number field a preview slider inside its value range, and sim defaults for all of them", () => {
    const sim = defaultSim();
    for (const f of FIELDS.filter((x) => x.number)) {
      const range = f.sim!;
      expect(range.min).toBeLessThan(range.max);
      expect(range.default).toBeGreaterThanOrEqual(range.min);
      expect(range.default).toBeLessThanOrEqual(range.max);
      expect(range.min).toBeGreaterThanOrEqual(f.number!.min);
      expect(range.max).toBeLessThanOrEqual(f.number!.max);
      expect(simValue(sim, f.id)).toBe(range.default);
    }
  });

  it("ties every ratio and icon set to a number field and reads the codec's image count", () => {
    for (const f of FIELDS) {
      const follows = f.ratio?.follows ?? f.iconSet?.follows;
      if (follows !== undefined) expect(fieldDef(follows)?.number).toBeDefined();
      if (f.iconSet) {
        expect(f.iconSet.count).toBe(valueTypeInfo(f.id)!.imageCount);
        expect(canDrawIconSet(f.id)).toBe(true);
      }
    }
  });

  it("does not list an id as both a field and a reason it has no element", () => {
    for (const id of [...Object.keys(HOSTED_BY), ...Object.keys(NO_ELEMENT)].map(Number)) {
      expect(valueTypeInfo(id), `id ${id}`).toBeDefined();
      expect(fieldDef(id), `id ${id} has an element and a reason it has none`).toBeUndefined();
    }
  });

  it("wires temperature with a degree sign and a minus, and the verified and inferred number fields", () => {
    const temperature = fieldDef(VALUE_TYPE.temperature)!;
    expect(temperature.number).toMatchObject({ sign: "degree", min: -99 });
    expect(temperature.slot).toBe(WIDGET_DATA_TYPE.weather);
    for (const id of [VALUE_TYPE.temperatureMax, VALUE_TYPE.temperatureMin, VALUE_TYPE.altitude, VALUE_TYPE.power]) expect(fieldDef(id)?.number).toBeDefined();
    for (const id of [VALUE_TYPE.heartRateRatio, VALUE_TYPE.powerRatio, VALUE_TYPE.stepsRatio, VALUE_TYPE.altitudeRatio]) expect(fieldDef(id)?.ratio).toBeDefined();
    // Evidence is never stored in the registry: it is the codec's.
    for (const f of FIELDS) expect("evidence" in f).toBe(false);
  });

  it("reads preview values from the simulated state, negative where the field allows it", () => {
    const sim = { ...defaultSim(), values: { [VALUE_TYPE.temperature]: -12, [VALUE_TYPE.heartRate]: 300, [VALUE_TYPE.steps]: 5000 }, stepGoal: 10000 };
    expect(fieldValue(VALUE_TYPE.temperature, sim)).toBe(-12);
    expect(fieldValue(VALUE_TYPE.heartRate, sim)).toBe(255);
    expect(fieldFraction(VALUE_TYPE.stepsRatio, sim)).toBeCloseTo(0.5);
    expect(fieldFraction(VALUE_TYPE.heartRateRatio, sim)).toBe(1);
  });

  it("reserves room for the minus and the degree sign in a temperature layout", () => {
    const temp = layoutWidget(newWidget(VALUE_TYPE.temperature, { showIcon: false }));
    const steps = layoutWidget(newWidget(VALUE_TYPE.steps, { showIcon: false }));
    const digits = temp.parts.find((p) => p.kind === "digits")!;
    expect(digits.kind === "digits" && digits.sign).toBe("degree");
    expect(digits.kind === "digits" && digits.minus).toBe(true);
    expect(digits.x).toBeGreaterThan(0);
    expect(temp.w).toBeGreaterThan(digits.kind === "digits" ? digits.count * digits.set.cellW : 0);
    expect(steps.parts).toHaveLength(1);
  });
});

describe("legacy projects", () => {
  const legacyElements = [
    { id: "bg", type: "background", name: "Background", visible: true, locked: false, x: 0, y: 0, fill: { kind: "solid", color: "#000000" } },
    { id: "w1", type: "widget", name: "Steps", visible: true, locked: false, x: 10, y: 10, source: "steps", font: { family: "Outfit", weight: 500 }, size: 30, color: "#fff", outline: null, showIcon: true, iconColor: "#5FD3EE", layout: "side", tracking: 1 },
    { id: "w2", type: "widget", name: "Heart", visible: true, locked: false, x: 10, y: 60, source: "heartRate", font: { family: "Outfit", weight: 500 }, size: 30, color: "#fff", outline: null, showIcon: true, iconColor: "#FF8FA4", layout: "side", tracking: 1 },
    { id: "w3", type: "widget", name: "Battery", visible: true, locked: false, x: 10, y: 110, source: "battery", font: { family: "Outfit", weight: 500 }, size: 30, color: "#fff", outline: null, showIcon: true, iconColor: "#6EE7A0", layout: "side", tracking: 1 },
    { id: "w4", type: "widget", name: "Calories", visible: true, locked: false, x: 10, y: 160, source: "calories", font: { family: "Outfit", weight: 500 }, size: 30, color: "#fff", outline: null, showIcon: true, iconColor: "#F5B35A", layout: "side", tracking: 1 },
    { id: "r1", type: "ring", name: "Steps ring", visible: true, locked: false, x: 12, y: 36, source: "steps", size: 300, thickness: 12, startAngle: 0, sweep: 360, color: "#5FD3EE", trackColor: "#24505E", roundCap: true },
    { id: "r2", type: "ring", name: "Battery ring", visible: true, locked: false, x: 12, y: 36, source: "battery", size: 200, thickness: 12, startAngle: 0, sweep: 360, color: "#6EE7A0", trackColor: "#24505E", roundCap: true },
  ];
  const legacy = { version: PROJECT_VERSION, name: "Old face", author: "", elements: legacyElements };

  it("maps source names to codec ids when a project file is imported", async () => {
    const file = JSON.stringify({ format: "joyofit-studio-project", project: legacy, assets: {} });
    const project = await parseProjectFile(file);
    const byId = Object.fromEntries(project.elements.map((e) => [e.id, e]));
    expect((byId.w1 as { valueType: number }).valueType).toBe(VALUE_TYPE.steps);
    expect((byId.w2 as { valueType: number }).valueType).toBe(VALUE_TYPE.heartRate);
    expect((byId.w3 as { valueType: number }).valueType).toBe(VALUE_TYPE.power);
    expect((byId.w4 as { valueType: number }).valueType).toBe(LEGACY_CALORIES_ID);
    expect((byId.r1 as { valueType: number }).valueType).toBe(VALUE_TYPE.stepsRatio);
    expect((byId.r2 as { valueType: number }).valueType).toBe(VALUE_TYPE.powerRatio);
    expect(project.elements.every((e) => !("source" in e))).toBe(true);
  });

  it("maps them the same way when the autosave is restored", () => {
    const store = { getItem: (key: string) => (key === STORAGE_KEY ? JSON.stringify(legacy) : null) };
    const project = readSaved(store)!;
    expect(project).not.toBeNull();
    expect(project.elements.filter((e) => e.type === "widget").map((e) => (e as { valueType: number }).valueType)).toEqual([0, 2, 9, LEGACY_CALORIES_ID]);
    expect(project.elements.filter((e) => e.type === "ring").map((e) => (e as { valueType: number }).valueType)).toEqual([161, 163]);
  });

  it("keeps the old calories widget as a preview-only layer, as before", async () => {
    const project = restoreProject(legacy);
    const calories = project.elements.find((e) => e.id === "w4") as Element;
    expect(elementSupport(calories).level).toBe("preview-only");
    expect(levelOfId(LEGACY_CALORIES_ID)).toBe("preview-only");
    // It still draws: a layout exists for it.
    expect(layoutWidget(calories as ReturnType<typeof newWidget>).parts.length).toBeGreaterThan(0);
  });

  it("migrated and new projects round-trip as they are", async () => {
    const migrated = restoreProject(legacy);
    const again = await parseProjectFile(await serializeProject(migrated));
    expect(again).toEqual(migrated);
    const fresh = { ...migrated, elements: [newWidget(VALUE_TYPE.temperature), newRing(VALUE_TYPE.heartRateRatio), newIconSet(VALUE_TYPE.powerEnum)] };
    expect(restoreProject(JSON.parse(JSON.stringify(fresh)))).toEqual(fresh);
  });
});

describe("damaged projects", () => {
  const widget = { id: "w", type: "widget", x: 0, y: 0, valueType: VALUE_TYPE.steps };

  it("rejects elements the renderer could not draw, in a file and in the autosave", () => {
    const damaged = [
      { ...widget, valueType: 999 },
      { ...widget, valueType: VALUE_TYPE.stepsRatio },
      { ...widget, type: "ring", valueType: VALUE_TYPE.steps },
      { ...widget, type: "iconset", valueType: VALUE_TYPE.steps },
      { ...widget, type: "nope" },
      { ...widget, x: "1" },
      "text",
    ];
    for (const element of damaged) {
      const project = { version: PROJECT_VERSION, name: "x", author: "", elements: [element] };
      expect(() => restoreProject(project)).toThrow(ProjectFileError);
      expect(readSaved({ getItem: () => JSON.stringify(project) })).toBeNull();
    }
  });

  it("ignores an autosave that is not JSON or has the wrong version", () => {
    expect(readSaved({ getItem: () => "{not json" })).toBeNull();
    expect(readSaved({ getItem: () => JSON.stringify({ version: 9, elements: [] }) })).toBeNull();
    expect(readSaved({ getItem: () => null })).toBeNull();
  });

  it("tells a saved project that did not restore from having none, so its images are not swept", () => {
    const bad = JSON.stringify({ version: PROJECT_VERSION, name: "x", author: "", elements: [{ id: "w", type: "widget", x: 0, y: 0, valueType: 999 }] });
    expect(readSavedState({ getItem: () => bad }).kind).toBe("rejected");
    expect(readSavedState({ getItem: () => "{not json" }).kind).toBe("rejected");
    expect(readSavedState({ getItem: () => null }).kind).toBe("none");
    expect(readSavedState({ getItem: () => JSON.stringify(emptyProject()) }).kind).toBe("restored");
  });

  it("covers every codec id with a field, a reason, or an unknown-evidence mark", () => {
    for (const info of VALUE_TYPES) {
      const covered = fieldDef(info.id) || HOSTED_BY[info.id] || NO_ELEMENT[info.id] || info.evidence === "unknown";
      expect(covered, `id ${info.id} (${info.name}) has no field, no reason and is not marked unknown`).toBeTruthy();
    }
  });
});
