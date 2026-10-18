import { fmtNumber, t } from '@/i18n';
import type {
  CourseIntensityKind,
  CourseStepKind,
  CourseTargetKind,
  RunningCourse,
  RunningCourseBlock,
  RunningCourseStep,
} from '@/wear';

/**
 * The editor's working copy. Every number is kept as the text the user typed so an empty or half-typed field is
 * never lost or turned into NaN; `buildCourse` parses and validates it into the `RunningCourse` contract.
 */
export interface StepDraft {
  id: string;
  kind: CourseStepKind;
  target: CourseTargetKind;
  minutes: string;
  seconds: string;
  distance: string;
  distanceUnit: 'm' | 'km';
  intensity: CourseIntensityKind;
  /** Pace bounds, min:sec per km: the faster one is `low`. */
  paceFastMin: string;
  paceFastSec: string;
  paceSlowMin: string;
  paceSlowSec: string;
  /** Heart rate (% of max) or cadence (spm) bounds. */
  rangeLow: string;
  rangeHigh: string;
}

export interface BlockDraft {
  id: string;
  repeat: number;
  steps: StepDraft[];
}

export interface CourseDraft {
  name: string;
  blocks: BlockDraft[];
}

export const EMPTY_DRAFT: CourseDraft = { name: '', blocks: [] };

// Limits mirror RunningCourseStep in HuaweiWearP2p.types.ts and CourseProtobuf.validate on the native side.
export const MAX_NAME_BYTES = 64;
export const MAX_ACTIONS = 100;
export const REPEAT_MIN = 1;
export const REPEAT_MAX = 99;
const TIME_MAX_S = 86_400;
const DISTANCE_MAX_M = 100_000;
const PACE_MIN_S = 60;
const PACE_MAX_S = 900;
const HR_MIN = 20;
const HR_MAX = 100;
const CADENCE_MIN = 100;
const CADENCE_MAX = 300;

const STEP_KIND_VALUES = ['warmup', 'run', 'walk', 'rest', 'cooldown'] as const satisfies readonly CourseStepKind[];
const TARGET_KIND_VALUES = ['time', 'distance', 'none'] as const satisfies readonly CourseTargetKind[];
const INTENSITY_KIND_VALUES = ['none', 'pace', 'hrPercent', 'cadence'] as const satisfies readonly CourseIntensityKind[];
const DISTANCE_UNIT_VALUES = ['m', 'km'] as const;

/** Picker options with their labels in the active language. Call during render, never at module level. */
export const stepKinds = () => STEP_KIND_VALUES.map((value) => ({ value, label: t(`watch:courses.stepKinds.${value}`) }));
export const targetKinds = () => TARGET_KIND_VALUES.map((value) => ({ value, label: t(`watch:courses.targetKinds.${value}`) }));
export const intensityKinds = () =>
  INTENSITY_KIND_VALUES.map((value) => ({ value, label: t(`watch:courses.intensityKinds.${value}`) }));
export const distanceUnits = () => DISTANCE_UNIT_VALUES.map((value) => ({ value, label: t(`watch:courses.distanceUnits.${value}`) }));

let counter = 0;
export function newId(): string {
  counter += 1;
  return `${Date.now().toString(36)}${counter.toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

// --- construction ---------------------------------------------------------------------------------------------

interface StepSpec {
  kind: CourseStepKind;
  seconds?: number;
  metres?: number;
  /** Pace bounds in seconds per km, faster first. */
  pace?: readonly [number, number];
}

function splitMinSec(totalSeconds: number): { min: string; sec: string } {
  return { min: String(Math.floor(totalSeconds / 60)), sec: String(totalSeconds % 60) };
}

export function makeStep(spec: StepSpec): StepDraft {
  const time = splitMinSec(spec.seconds ?? 0);
  const fast = splitMinSec(spec.pace?.[0] ?? 300);
  const slow = splitMinSec(spec.pace?.[1] ?? 330);
  return {
    id: newId(),
    kind: spec.kind,
    target: spec.metres !== undefined ? 'distance' : 'time',
    minutes: time.min,
    seconds: time.sec,
    distance: spec.metres !== undefined ? String(spec.metres) : '',
    distanceUnit: 'm',
    intensity: spec.pace ? 'pace' : 'none',
    paceFastMin: fast.min,
    paceFastSec: fast.sec,
    paceSlowMin: slow.min,
    paceSlowSec: slow.sec,
    rangeLow: '',
    rangeHigh: '',
  };
}

export function newStep(): StepDraft {
  return makeStep({ kind: 'run', seconds: 300 });
}

export function newBlock(steps: StepDraft[], repeat = 1): BlockDraft {
  return { id: newId(), repeat, steps };
}

/** Run 400 m at 5:00 to 5:30 per km, rest 60 s, six times. */
export function newIntervalGroup(): BlockDraft {
  return newBlock(
    [makeStep({ kind: 'run', metres: 400, pace: [300, 330] }), makeStep({ kind: 'rest', seconds: 60 })],
    6,
  );
}

export interface Preset {
  id: 'easy' | 'intervals';
  name: string;
  build: () => CourseDraft;
}

/** The starter courses, named in the active language. */
export const presets = (): readonly Preset[] => [
  {
    id: 'easy',
    name: t('watch:courses.presets.easy'),
    build: () => ({
      name: t('watch:courses.presets.easy'),
      blocks: [
        newBlock([makeStep({ kind: 'warmup', seconds: 300 })]),
        newBlock([makeStep({ kind: 'run', seconds: 1200 })]),
        newBlock([makeStep({ kind: 'cooldown', seconds: 300 })]),
      ],
    }),
  },
  {
    id: 'intervals',
    name: t('watch:courses.presets.intervals'),
    build: () => ({
      name: t('watch:courses.presets.intervals'),
      blocks: [
        newBlock([makeStep({ kind: 'warmup', seconds: 600 })]),
        newBlock(
          [makeStep({ kind: 'run', metres: 400, pace: [300, 330] }), makeStep({ kind: 'rest', seconds: 90 })],
          6,
        ),
        newBlock([makeStep({ kind: 'cooldown', seconds: 300 })]),
      ],
    }),
  },
];

// --- parsing --------------------------------------------------------------------------------------------------

/** Digits only, or null for text that is not a whole number. Empty text is null too; callers decide what that means. */
function parseWhole(text: string): number | null {
  const trimmed = text.trim();
  if (!/^\d{1,9}$/.test(trimmed)) return null;
  return Number(trimmed);
}

/** Empty text counts as zero so "5" minutes with an empty seconds box is 5:00. Anything else that is not a number is null. */
function parseWholeOrZero(text: string): number | null {
  return text.trim() === '' ? 0 : parseWhole(text);
}

function parseDecimal(text: string): number | null {
  const trimmed = text.trim().replace(',', '.');
  if (!/^(\d+\.?\d*|\.\d+)$/.test(trimmed)) return null;
  const value = Number(trimmed);
  return Number.isFinite(value) ? value : null;
}

/** Keeps digits (and one decimal point when `decimal`), so no field can hold text that parses to NaN. */
export function sanitizeNumber(text: string, decimal = false): string {
  if (!decimal) return text.replace(/\D/g, '');
  const cleaned = text.replace(',', '.').replace(/[^\d.]/g, '');
  const dot = cleaned.indexOf('.');
  return dot < 0 ? cleaned : cleaned.slice(0, dot + 1) + cleaned.slice(dot + 1).replace(/\./g, '');
}

function timeSeconds(step: StepDraft): number | null {
  const m = parseWholeOrZero(step.minutes);
  const s = parseWholeOrZero(step.seconds);
  return m === null || s === null || s > 59 ? null : m * 60 + s;
}

function distanceMetres(step: StepDraft): number | null {
  if (step.distanceUnit === 'm') return parseWhole(step.distance);
  const km = parseDecimal(step.distance);
  return km === null ? null : Math.round(km * 1000);
}

function paceSeconds(min: string, sec: string): number | null {
  const m = parseWholeOrZero(min);
  const s = parseWholeOrZero(sec);
  return m === null || s === null || s > 59 ? null : m * 60 + s;
}

/** UTF-8 length of the name; the watch file stores the bytes. */
function utf8Length(text: string): number {
  let bytes = 0;
  for (const char of text) {
    const cp = char.codePointAt(0) ?? 0;
    bytes += cp < 0x80 ? 1 : cp < 0x800 ? 2 : cp < 0x10000 ? 3 : 4;
  }
  return bytes;
}

// --- labels ---------------------------------------------------------------------------------------------------

/** A repeated or multi-step block; a plain block is a single step run once. */
function isGroup(block: BlockDraft): boolean {
  return !(block.repeat === 1 && block.steps.length === 1);
}

/** "Step 2" for a plain step, "Group 2" for a repeated or multi-step block. */
export function blockLabel(draft: CourseDraft, blockIndex: number): string {
  const n = blockIndex + 1;
  return isGroup(draft.blocks[blockIndex]) ? t('watch:courses.group', { n }) : t('watch:courses.step', { n });
}

export function formatPace(secondsPerKm: number): string {
  const m = Math.floor(secondsPerKm / 60);
  const s = secondsPerKm % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function formatSeconds(total: number): string {
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const parts: string[] = [];
  if (h > 0) parts.push(t('watch:courses.unit.h', { n: h }));
  if (m > 0) parts.push(t('watch:courses.unit.min', { n: m }));
  if (s > 0 || parts.length === 0) parts.push(t('watch:courses.unit.s', { n: s }));
  return parts.join(' ');
}

export function formatMetres(metres: number): string {
  return metres < 1000
    ? t('common:units.m', { value: fmtNumber(metres) })
    : t('common:units.km', { value: fmtNumber(metres / 1000, 3) });
}

// --- validation and conversion -------------------------------------------------------------------------------

function buildStep(step: StepDraft): { step: RunningCourseStep } | { error: string } {
  let targetValue = 0;
  if (step.target === 'time') {
    const s = timeSeconds(step);
    if (s === null) return { error: t('watch:courses.errors.timeFormat') };
    if (s < 1 || s > TIME_MAX_S) return { error: t('watch:courses.errors.timeRange') };
    targetValue = s;
  } else if (step.target === 'distance') {
    const m = distanceMetres(step);
    if (m === null) return { error: t('watch:courses.errors.distanceFormat') };
    if (m < 1 || m > DISTANCE_MAX_M) return { error: t('watch:courses.errors.distanceRange') };
    targetValue = m;
  }

  let low = 0;
  let high = 0;
  if (step.intensity === 'pace') {
    const fast = paceSeconds(step.paceFastMin, step.paceFastSec);
    const slow = paceSeconds(step.paceSlowMin, step.paceSlowSec);
    if (fast === null || slow === null) return { error: t('watch:courses.errors.paceFormat') };
    if (fast < PACE_MIN_S || fast > PACE_MAX_S || slow < PACE_MIN_S || slow > PACE_MAX_S) {
      return { error: t('watch:courses.errors.paceRange') };
    }
    if (fast > slow) return { error: t('watch:courses.errors.paceOrder') };
    low = fast;
    high = slow;
  } else if (step.intensity === 'hrPercent' || step.intensity === 'cadence') {
    const hr = step.intensity === 'hrPercent';
    const min = hr ? HR_MIN : CADENCE_MIN;
    const max = hr ? HR_MAX : CADENCE_MAX;
    const a = parseWhole(step.rangeLow);
    const b = parseWhole(step.rangeHigh);
    if (a === null || b === null) return { error: t(hr ? 'watch:courses.errors.hrBoth' : 'watch:courses.errors.cadenceBoth') };
    if (a < min || a > max || b < min || b > max) {
      return { error: t(hr ? 'watch:courses.errors.hrRange' : 'watch:courses.errors.cadenceRange') };
    }
    if (a > b) return { error: t(hr ? 'watch:courses.errors.hrOrder' : 'watch:courses.errors.cadenceOrder') };
    low = a;
    high = b;
  }

  return {
    step: { kind: step.kind, target: step.target, targetValue, intensity: step.intensity, low, high },
  };
}

export type BuildResult = { course: RunningCourse; error: null } | { course: null; error: string };

/** Parses the draft into the contract. `error` is the first problem, worded for the user and naming where it is. */
export function buildCourse(draft: CourseDraft): BuildResult {
  const fail = (error: string): BuildResult => ({ course: null, error });
  const name = draft.name.trim();
  if (name === '') return fail(t('watch:courses.errors.name'));
  if (utf8Length(name) > MAX_NAME_BYTES) return fail(t('watch:courses.errors.nameLong', { max: MAX_NAME_BYTES }));
  if (draft.blocks.length === 0) return fail(t('watch:courses.errors.noSteps'));
  const actions = draft.blocks.reduce((sum, b) => sum + b.steps.length, 0);
  if (actions > MAX_ACTIONS) return fail(t('watch:courses.errors.tooMany', { max: MAX_ACTIONS }));

  const blocks: RunningCourseBlock[] = [];
  for (let b = 0; b < draft.blocks.length; b += 1) {
    const block = draft.blocks[b];
    const label = blockLabel(draft, b);
    if (block.steps.length === 0) return fail(t('watch:courses.errors.emptyGroup', { label }));
    if (!Number.isInteger(block.repeat) || block.repeat < REPEAT_MIN || block.repeat > REPEAT_MAX) {
      return fail(t('watch:courses.errors.repeatRange', { label }));
    }
    const steps: RunningCourseStep[] = [];
    for (let s = 0; s < block.steps.length; s += 1) {
      const built = buildStep(block.steps[s]);
      if ('error' in built) {
        const where = isGroup(block) ? t('watch:courses.errors.inGroup', { label, n: s + 1 }) : label;
        return fail(t('watch:courses.errors.at', { where, error: built.error }));
      }
      steps.push(built.step);
    }
    blocks.push({ repeat: block.repeat, steps });
  }
  return { course: { name, blocks }, error: null };
}

export interface CourseSummary {
  /** Steps counting every repeat. */
  steps: number;
  /** Total of the shared target, or 'mixed' when steps differ, 'open' when none has a target. */
  total: { kind: 'time' | 'distance'; value: number } | { kind: 'mixed' } | { kind: 'open' } | null;
}

/** Live total of the draft. Fields that do not parse count as zero, so it never throws while the user types. */
export function summarize(draft: CourseDraft): CourseSummary {
  let steps = 0;
  let time = 0;
  let distance = 0;
  const kinds = new Set<CourseTargetKind>();
  for (const block of draft.blocks) {
    for (const step of block.steps) {
      steps += block.repeat;
      kinds.add(step.target);
      if (step.target === 'time') time += block.repeat * (timeSeconds(step) ?? 0);
      if (step.target === 'distance') distance += block.repeat * (distanceMetres(step) ?? 0);
    }
  }
  if (steps === 0) return { steps, total: null };
  if (kinds.size === 1) {
    const only = [...kinds][0];
    if (only === 'time') return { steps, total: { kind: 'time', value: time } };
    if (only === 'distance') return { steps, total: { kind: 'distance', value: distance } };
    return { steps, total: { kind: 'open' } };
  }
  return { steps, total: { kind: 'mixed' } };
}

// --- persistence ----------------------------------------------------------------------------------------------

const asText = (value: unknown, fallback = ''): string => (typeof value === 'string' ? value : fallback);

function oneOf<T extends string>(value: unknown, options: readonly T[], fallback: T): T {
  return options.includes(value as T) ? (value as T) : fallback;
}

function reviveStep(raw: unknown): StepDraft | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  const base = newStep();
  return {
    id: newId(),
    kind: oneOf(r.kind, STEP_KIND_VALUES, base.kind),
    target: oneOf(r.target, TARGET_KIND_VALUES, base.target),
    minutes: sanitizeNumber(asText(r.minutes, base.minutes)),
    seconds: sanitizeNumber(asText(r.seconds, base.seconds)),
    distance: sanitizeNumber(asText(r.distance), true),
    distanceUnit: oneOf(r.distanceUnit, DISTANCE_UNIT_VALUES, 'm'),
    intensity: oneOf(r.intensity, INTENSITY_KIND_VALUES, 'none'),
    paceFastMin: sanitizeNumber(asText(r.paceFastMin, base.paceFastMin)),
    paceFastSec: sanitizeNumber(asText(r.paceFastSec, base.paceFastSec)),
    paceSlowMin: sanitizeNumber(asText(r.paceSlowMin, base.paceSlowMin)),
    paceSlowSec: sanitizeNumber(asText(r.paceSlowSec, base.paceSlowSec)),
    rangeLow: sanitizeNumber(asText(r.rangeLow)),
    rangeHigh: sanitizeNumber(asText(r.rangeHigh)),
  };
}

/** Rebuilds a draft from stored JSON, dropping anything that is not the right shape; null when nothing usable is left. */
export function reviveDraft(raw: unknown): CourseDraft | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as { name?: unknown; blocks?: unknown };
  const blocks: BlockDraft[] = [];
  if (Array.isArray(r.blocks)) {
    for (const rawBlock of r.blocks) {
      if (typeof rawBlock !== 'object' || rawBlock === null) continue;
      const b = rawBlock as { repeat?: unknown; steps?: unknown };
      const steps = Array.isArray(b.steps)
        ? b.steps.map(reviveStep).filter((s): s is StepDraft => s !== null)
        : [];
      if (steps.length === 0) continue;
      const repeat =
        typeof b.repeat === 'number' && Number.isInteger(b.repeat)
          ? Math.min(REPEAT_MAX, Math.max(REPEAT_MIN, b.repeat))
          : 1;
      blocks.push({ id: newId(), repeat, steps });
    }
  }
  return { name: asText(r.name), blocks };
}
