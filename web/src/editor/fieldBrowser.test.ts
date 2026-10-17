import { VALUE_TYPES, describeLayout, getLayout, readHwt, type NamedObject } from "@joyofit/hwt";
import { describe, expect, it } from "vitest";
import { buildHwt } from "@/export/build";
import { elementSupport, levelOfId } from "@/export/support";
import { emptyProject } from "@/model/defaults";
import { fieldDef } from "@/model/fields";
import { defaultSim } from "@/render/values";
import { fieldAction, fieldRows, filterRows, makeFieldElement } from "./fieldBrowser";

const sim = defaultSim();

function list(value: unknown): NamedObject[] {
  return Array.isArray(value) ? (value as NamedObject[]) : [];
}

/** Value ids and container slots of the written layers: `{ valueType, dataType }` per layer. */
function written(bytes: Uint8Array): Array<{ valueType: unknown; dataType: unknown }> {
  const named = describeLayout(getLayout(readHwt(bytes).watchface!));
  const out: Array<{ valueType: unknown; dataType: unknown }> = [];
  for (const element of list(named.element)) {
    for (const container of list(element.container)) {
      for (const layer of list(container.layer)) {
        const key = Object.keys(layer).find((k) => k !== "index" && k !== "draw_type")!;
        out.push({ valueType: (layer[key] as NamedObject).value_type, dataType: container.data_type });
      }
    }
  }
  return out;
}

describe("field browser", () => {
  const rows = fieldRows();

  it("lists every codec id once", () => {
    expect(rows.map((r) => r.info.id)).toEqual(VALUE_TYPES.map((v) => v.id));
  });

  it("shows the evidence the export gate uses", () => {
    for (const row of rows) {
      expect(row.level).toBe(levelOfId(row.info.id));
      const evidence = row.info.evidence;
      expect(row.badge).toBe(evidence === "verified" ? "Verified" : evidence === "inferred" ? "Unconfirmed" : "Unknown, preview only");
    }
  });

  it("never enables an action for an unknown id, and always says why an action is off", () => {
    for (const row of rows) {
      const { state } = row.action;
      if (row.level === "preview-only") expect(state.enabled).toBe(false);
      if (!state.enabled) {
        expect(state.reason.length).toBeGreaterThan(10);
        expect(state.reason).not.toContain("\n");
      }
    }
  });

  it("enables an action exactly when the element it makes has the codec's level and the export writes it", async () => {
    for (const row of rows) {
      const { state, kind } = row.action;
      if (!state.enabled) continue;
      const el = makeFieldElement(row.info.id, kind);
      // The browser, the element's support level and the export gate read the same evidence.
      expect(elementSupport(el).level, `id ${row.info.id}`).toBe(levelOfId(row.info.id));
      expect(row.level).not.toBe("preview-only");

      const project = { ...emptyProject("Field"), elements: [...emptyProject().elements.slice(0, 1), el] };
      const strict = await buildHwt(project, sim, { includeExperimental: false });
      const loose = await buildHwt(project, sim, { includeExperimental: true });
      const inStrict = written(strict.bytes).some((l) => l.valueType === row.info.id);
      const inLoose = written(loose.bytes);
      expect(inStrict, `id ${row.info.id} strict`).toBe(row.level === "verified");
      const layer = inLoose.find((l) => l.valueType === row.info.id);
      expect(layer, `id ${row.info.id} loose`).toBeDefined();
      expect(layer!.dataType).toBe(fieldDef(row.info.id)!.slot);
      expect(loose.elements.find((e) => e.id === el.id)!.exported).toBe(true);
      expect(strict.elements.find((e) => e.id === el.id)!.exported).toBe(row.level === "verified");
    }
  });

  it("offers exactly the fields the codec can write, by kind", () => {
    const on = (kind: string) => rows.filter((r) => r.action.state.enabled && r.action.kind === kind).map((r) => r.info.id).sort((a, b) => a - b);
    expect(on("number")).toEqual([0, 2, 4, 8, 9, 20, 21]);
    expect(on("ring")).toEqual([157, 161, 163, 170]);
    expect(on("iconset")).toEqual([54]);
  });

  it("says why the rest cannot be added", () => {
    const reason = (id: number) => {
      const state = fieldAction(VALUE_TYPES.find((v) => v.id === id)!).state;
      return state.enabled ? "" : state.reason;
    };
    expect(reason(248)).toMatch(/needs an image set/i);
    expect(reason(12)).toMatch(/Time element/);
    expect(reason(150)).toMatch(/hand/i);
    expect(reason(167)).toMatch(/gauge hand/);
    expect(reason(53)).toMatch(/Unknown id/);
    expect(reason(1)).toMatch(/Unknown id/);
    expect(reason(231)).toMatch(/Unknown id/);
  });

  it("shows the container slot and draw types of what it knows", () => {
    const steps = rows.find((r) => r.info.id === 0)!;
    expect(steps.slot).toBe("10 (steps)");
    expect(steps.drawTypes).toContain("combined res");
    expect(rows.find((r) => r.info.id === 12)!.slot).toBeNull();
    expect(rows.find((r) => r.info.id === 161)!.drawTypes).toContain("arc res");
  });

  it("filters by name, id and category", () => {
    expect(filterRows(rows, "temperature").map((r) => r.info.id)).toEqual(expect.arrayContaining([4, 20, 21, 167]));
    expect(filterRows(rows, "248").map((r) => r.info.id)).toContain(248);
    expect(filterRows(rows, "ratio verified").every((r) => r.info.category === "ratio" && r.level === "verified")).toBe(true);
    expect(filterRows(rows, "   ")).toHaveLength(rows.length);
    expect(filterRows(rows, "zzzz-no-such-field")).toHaveLength(0);
  });
});
