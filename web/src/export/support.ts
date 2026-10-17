import { VALUE_TYPE, valueTypeInfo } from "@joyofit/hwt";
import { getAsset } from "@/model/assets";
import { fieldDef } from "@/model/fields";
import type { Element, HandKind } from "@/model/types";

/**
 * What the exporter can write for an element, from how well the codec knows the value ids it needs
 * (`packages/hwt` VALUE_TYPES, each marked verified / inferred / unknown from the Fit 4 Pro sample faces).
 *
 * - `verified`: written. The sample faces use exactly this construction and their previews confirm the meaning.
 * - `experimental`: written only when "include unconfirmed elements" is on. The id comes from the samples'
 *   structure, not from a preview that shows it: a strong hypothesis until a watch confirms it.
 * - `preview-only`: never written. The editor shows it, the export leaves it out and says so.
 */
export type SupportLevel = "verified" | "experimental" | "preview-only";

export interface Support {
  level: SupportLevel;
  /** Why the element is experimental or preview only. */
  note: string;
  /** Parts of an exported element that stay preview only (for example the AM/PM marker). */
  dropped: string[];
  /** Parts that make an element experimental (for example the seconds digits). */
  experimental: string[];
}

/** Value ids the exporter writes. Kept here so the support rules and the layout builder cannot drift apart. */
export const HAND_VALUE: Record<HandKind, number> = {
  hour: VALUE_TYPE.hourRatio,
  minute: VALUE_TYPE.minuteRatio,
  second: VALUE_TYPE.secondRatio,
};

const ORDER: SupportLevel[] = ["verified", "experimental", "preview-only"];

export function levelOfId(id: number): SupportLevel {
  const evidence = valueTypeInfo(id)?.evidence;
  return evidence === "verified" ? "verified" : evidence === "inferred" ? "experimental" : "preview-only";
}

function worst(levels: SupportLevel[]): SupportLevel {
  return levels.reduce((a, b) => (ORDER.indexOf(b) > ORDER.indexOf(a) ? b : a), "verified");
}

const verified: Support = { level: "verified", note: "", dropped: [], experimental: [] };

const capitalise = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

function fromIds(ids: number[], what: string): Support {
  const level = worst(ids.map(levelOfId));
  if (level === "verified") return verified;
  const names = ids.map((id) => `${valueTypeInfo(id)?.name ?? "?"} (${id})`).join(", ");
  return {
    ...verified,
    level,
    note:
      level === "experimental"
        ? `${capitalise(what)} uses ids inferred from the sample faces, not confirmed by a preview or a watch: ${names}.`
        : `No value id is known for ${what}.`,
    experimental: level === "experimental" ? [what] : [],
  };
}

const previewOnly = (note: string): Support => ({ ...verified, level: "preview-only", note });

/** What stays preview only about a number that can be negative: `FaceBuilder.digits` has one `res_sign` image and no minus. */
export const MINUS_DROPPED = "minus sign for values below zero (the codec has no field for it)";

/** An uploaded image that is set but not decoded (browser storage unavailable, or the file would not decode). */
const NOT_LOADED = "The image is set but did not load (browser storage blocked or the file is damaged). Upload it again.";

export function elementSupport(el: Element): Support {
  switch (el.type) {
    case "background":
      if (el.fill.kind !== "image") return verified;
      if (!el.fill.assetId) return previewOnly("No photo chosen.");
      return getAsset(el.fill.assetId) ? verified : previewOnly(NOT_LOADED);
    case "image":
      if (!el.assetId) return previewOnly("No image chosen.");
      return getAsset(el.assetId) ? verified : previewOnly(NOT_LOADED);
    case "time": {
      const base = fromIds([VALUE_TYPE.hour, VALUE_TYPE.minute], "the hour and minute digits");
      const seconds = el.showSeconds ? fromIds([VALUE_TYPE.secondHigh, VALUE_TYPE.secondLow], "the seconds digits") : verified;
      const dropped = el.ampm ? ["AM/PM marker (no known id)"] : [];
      const level = worst([base.level, seconds.level]);
      return { level, note: [base.note, seconds.note].filter(Boolean).join(" "), dropped, experimental: [...base.experimental, ...seconds.experimental] };
    }
    case "date": {
      const ids: number[] = [];
      if (el.parts.includes("weekday")) ids.push(VALUE_TYPE.week);
      if (el.parts.includes("day")) ids.push(VALUE_TYPE.date);
      if (el.parts.includes("month")) ids.push(VALUE_TYPE.month);
      return fromIds(ids, "the date");
    }
    case "hand":
      if (el.shape === "custom") {
        if (!el.assetId) return previewOnly("No hand PNG chosen.");
        if (!getAsset(el.assetId)) return previewOnly(NOT_LOADED);
      }
      return fromIds([HAND_VALUE[el.hand]], `the ${el.hand} hand`);
    case "widget": {
      const def = fieldDef(el.valueType);
      if (!def?.number) return previewOnly(`Value id ${el.valueType} is not a number field Studio can draw.`);
      const ids = fromIds([def.id], `the ${def.label.toLowerCase()} number`);
      if (ids.level === "preview-only") return ids;
      if (def.slot === undefined) return previewOnly(`No container slot is known for ${def.label.toLowerCase()}.`);
      const dropped = def.number.min < 0 ? [MINUS_DROPPED] : [];
      return { ...ids, dropped };
    }
    case "ring": {
      const def = fieldDef(el.valueType);
      if (!def?.ratio) return previewOnly(`Value id ${el.valueType} is not a ratio Studio can draw as a ring.`);
      const ids = fromIds([def.id], "the progress arc");
      if (ids.level === "preview-only") return ids;
      return def.slot === undefined ? previewOnly(`No container slot is known for ${def.label.toLowerCase()}.`) : ids;
    }
    case "iconset": {
      const def = fieldDef(el.valueType);
      if (!def?.iconSet) return previewOnly(`Value id ${el.valueType} has no image set Studio can draw.`);
      const ids = fromIds([def.id], "the icon set");
      if (ids.level === "preview-only") return ids;
      return def.slot === undefined ? previewOnly(`No container slot is known for ${def.label.toLowerCase()}.`) : ids;
    }
  }
}

export function isExportable(el: Element, includeExperimental: boolean): boolean {
  const s = elementSupport(el);
  if (s.level === "preview-only") return false;
  return s.level === "verified" || includeExperimental;
}

/**
 * Layers a photo face can carry: pictures that never change. A photo face is only a background image; the watch draws its own
 * clock and data over it, so Time, Date, Hand, Data and Ring layers cannot be part of it.
 */
export function isStaticElement(el: Element): boolean {
  return el.type === "background" || el.type === "image";
}
