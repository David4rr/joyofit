import { CATEGORY_DRAW_TYPES, VALUE_TYPES, type DataCategory, type ValueTypeInfo } from "@joyofit/hwt";
import { levelOfId, type SupportLevel } from "@/export/support";
import { newIconSet, newRing, newWidget } from "@/model/defaults";
import { HOSTED_BY, NO_ELEMENT, fieldDef, slotName } from "@/model/fields";
import type { Element } from "@/model/types";
import { canDrawIconSet } from "@/render/iconsets";

/**
 * What the field browser offers for each codec value id. Evidence comes from `levelOfId`, the function the export gate uses, so
 * the badge in the browser and what the export writes cannot disagree: an action is enabled only when the element it makes
 * has that same level, and an unknown id has no enabled action.
 */
export type FieldActionKind = "number" | "ring" | "iconset";

export type ActionState = { enabled: true } | { enabled: false; reason: string };

export interface FieldAction {
  kind: FieldActionKind;
  label: string;
  state: ActionState;
}

export interface FieldRow {
  info: ValueTypeInfo;
  level: SupportLevel;
  /** Badge text: verified, unconfirmed or unknown (preview only). */
  badge: string;
  /** Layer types the Huawei docs allow for this data category, as short names. */
  drawTypes: string[];
  /** Studio's own name for the field (the codec calls id 9 "Power", Studio "Battery"), when it has one. */
  label: string | null;
  /** Container `data_type` the export would use, when Studio knows it. */
  slot: string | null;
  action: FieldAction;
}

const KIND_OF: Record<DataCategory, FieldActionKind> = { raw: "number", text: "number", ratio: "ring", enum: "iconset" };
const LABEL: Record<FieldActionKind, string> = { number: "Add as number", ring: "Add as ring (ratio)", iconset: "Add as icon set (enum)" };
/** The layer type each action writes through `FaceBuilder`. */
const NEEDS: Record<FieldActionKind, string> = { number: "DRAW_TYPE_COMBINED_RES", ring: "DRAW_TYPE_ARC_RES", iconset: "DRAW_TYPE_SELECTED_RES" };

const BADGE: Record<SupportLevel, string> = { verified: "Verified", experimental: "Unconfirmed", "preview-only": "Unknown, preview only" };

export function fieldAction(info: ValueTypeInfo): FieldAction {
  const kind = KIND_OF[info.category];
  const no = (reason: string): FieldAction => ({ kind, label: LABEL[kind], state: { enabled: false, reason } });

  if (levelOfId(info.id) === "preview-only") return no("Unknown id: the codec does not know what it shows, so it cannot be written.");
  const elsewhere = HOSTED_BY[info.id] ?? NO_ELEMENT[info.id];
  if (elsewhere) return no(elsewhere);
  if (!CATEGORY_DRAW_TYPES[info.category].includes(NEEDS[kind])) {
    return no("FaceBuilder has no method for this layer type (it writes digits, images, hands and arcs).");
  }
  const def = fieldDef(info.id);
  const spec = kind === "number" ? def?.number : kind === "ring" ? def?.ratio : def?.iconSet;
  if (!def || !spec) return no(kind === "iconset" ? "Needs an image set: Studio has no images for this value." : "Studio has no element for this value yet.");
  if (kind === "iconset" && !canDrawIconSet(info.id)) return no("Needs an image set: Studio cannot draw its images.");
  if (def.slot === undefined) return no("No container data_type is known for this value.");
  return { kind, label: LABEL[kind], state: { enabled: true } };
}

const shortDrawType = (t: string) => t.replace("DRAW_TYPE_", "").toLowerCase().replaceAll("_", " ");

export function fieldRows(): FieldRow[] {
  return VALUE_TYPES.map((info) => {
    const level = levelOfId(info.id);
    const def = fieldDef(info.id);
    const slot = def?.slot;
    return {
      info,
      label: def && def.label !== info.name ? def.label : null,
      level,
      badge: BADGE[level],
      drawTypes: CATEGORY_DRAW_TYPES[info.category].map(shortDrawType),
      slot: slot === undefined ? null : slotName(slot),
      action: fieldAction(info),
    };
  });
}

/** Rows whose codec name, Studio name, id, category or badge contain every word of `query`. */
export function filterRows(rows: FieldRow[], query: string): FieldRow[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return rows;
  return rows.filter((r) => {
    const hay = `${r.info.name} ${r.label ?? ""} ${r.info.id} ${r.info.category} ${r.badge}`.toLowerCase();
    return words.every((w) => hay.includes(w));
  });
}

/** The element an enabled action adds. */
export function makeFieldElement(id: number, kind: FieldActionKind): Element {
  if (kind === "number") return newWidget(id);
  if (kind === "ring") return newRing(id, { size: 168, thickness: 12, x: 120, y: 156 });
  return newIconSet(id);
}
