import { FACE_EDIT_MODES, type FaceCustomization, type FaceStyleChoice } from '@/wear';

/** The edit modes in the order the editor shows them; `key` is the label under `watch:faceEdit.modes`. */
export const FACE_MODE_ROWS = [
  { mode: FACE_EDIT_MODES.style, key: 'style' },
  { mode: FACE_EDIT_MODES.background, key: 'background' },
  { mode: FACE_EDIT_MODES.typeface, key: 'typeface' },
  { mode: FACE_EDIT_MODES.hand, key: 'hands' },
  { mode: FACE_EDIT_MODES.symbol, key: 'symbol' },
  { mode: FACE_EDIT_MODES.time, key: 'time' },
  { mode: FACE_EDIT_MODES.scale, key: 'scale' },
  { mode: FACE_EDIT_MODES.dual, key: 'dual' },
] as const;

/** The highest index a one-byte TLV value can carry (`FaceCustomWire.MAX_INDEX`). */
export const MAX_OPTION_INDEX = 255;

/** Pickers start with this many options and grow with "More"; the watch does not report how many a face has. */
export const INITIAL_OPTIONS = 6;

export function styleIndex(config: FaceCustomization, mode: number): number | null {
  return config.styles.find((s) => s.mode === mode)?.index ?? null;
}

export function withStyle(config: FaceCustomization, mode: number, index: number): FaceCustomization {
  const styles: FaceStyleChoice[] = config.styles.map((s) => (s.mode === mode ? { mode, index } : s));
  return { ...config, styles };
}

export function withWidget(config: FaceCustomization, slot: number, option: number): FaceCustomization {
  const widgets = config.widgets.slice();
  widgets[slot] = option;
  return { ...config, widgets };
}

export function sameConfig(a: FaceCustomization, b: FaceCustomization): boolean {
  if (a.marketId !== b.marketId) return false;
  if (a.colourIndex !== b.colourIndex) return false;
  if ((a.customColour ?? '') !== (b.customColour ?? '')) return false;
  if (a.widgets.length !== b.widgets.length || a.widgets.some((w, i) => w !== b.widgets[i])) return false;
  if (a.styles.length !== b.styles.length) return false;
  return a.styles.every((s) => styleIndex(b, s.mode) === s.index);
}

/** True when the watch reported at least one thing the editor can change. */
export function isEditable(config: FaceCustomization): boolean {
  return config.styles.length > 0 || config.colourIndex !== null || config.widgets.length > 0;
}

/** How many choices a picker shows: at least [INITIAL_OPTIONS], always including the selected one and one more. */
export function visibleOptions(selected: number | null, extra: number): number {
  return Math.min(MAX_OPTION_INDEX + 1, Math.max(INITIAL_OPTIONS, (selected ?? 0) + 2) + extra);
}
