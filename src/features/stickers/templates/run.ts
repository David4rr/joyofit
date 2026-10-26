import { all, any, footer, has, is, lacks, not, sportGlyph, tl } from './blocks';
import { kit, template } from './dsl';
import type { Cond, Dim, Expr, Kit, LayerJson } from './dsl';
import { GLASS, INK, PAPER, VOLT } from './palette';
import type { Palette } from './palette';
import { runEditorial, runGlass, runPhoto } from './photoTemplates';
type Canvas = 'story' | 'square';

/** The three cards below the hero are the same data, in a different layout per style. */
interface Cell {
  bind: string;
  value: string;
  label: Expr;
  unit?: Expr;
  when?: Cond;
}

const CELL = {
  time: { bind: 'run.movingSec', value: '{run.movingSec|dur}', label: tl('label.time'), when: has('run.distanceM') },
  pace: { bind: 'run.paceSecKm', value: '{run.paceSecKm|pace}', label: tl('label.pace'), unit: tl('unit.perKm') },
  fastPace: { bind: 'run.paceFastestSec', value: '{run.paceFastestSec|pace}', label: tl('label.bestPace'), unit: tl('unit.perKm') },
  pace100: { bind: 'run.pace100Sec', value: '{run.pace100Sec|pace}', label: tl('label.pace'), unit: tl('unit.per100m') },
  speed: { bind: 'run.speedKmh', value: '{run.speedKmh|num:1}', label: tl('label.speed'), unit: tl('unit.kmh') },
  maxSpeed: { bind: 'run.maxSpeedKmh', value: '{run.maxSpeedKmh|num:1}', label: tl('label.maxSpeed'), unit: tl('unit.kmh') },
  hr: { bind: 'run.hrAvg', value: '{run.hrAvg|int}', label: tl('label.hr'), unit: tl('unit.bpm') },
  minHr: { bind: 'run.minHr', value: '{run.minHr|int}', label: tl('label.minHr'), unit: tl('unit.bpm') },
  hrMax: { bind: 'run.hrMax', value: '{run.hrMax|int}', label: tl('label.maxHr'), unit: tl('unit.bpm'), when: has('run._custom') },
  kcal: { bind: 'run.kcal', value: '{run.kcal|int}', label: tl('label.kcal'), when: any(lacks('run.hrAvg'), has('run._custom')) },
  elev: { bind: 'run.elevGainM', value: '{run.elevGainM|int}', label: tl('label.elevation'), unit: tl('unit.m') },
  elevLoss: { bind: 'run.elevLossM', value: '{run.elevLossM|int}', label: tl('label.elevLoss'), unit: tl('unit.m') },
  cadence: { bind: 'run.cadence', value: '{run.cadence|int}', label: tl('label.cadence'), unit: tl('unit.rpm'), when: has('run._custom') },
  steps: { bind: 'run.steps', value: '{run.steps|int}', label: tl('label.steps') },
  stepLength: { bind: 'run.stepLengthCm', value: '{run.stepLengthCm|int}', label: tl('label.stepLength'), unit: tl('unit.cm') },
  vo2max: { bind: 'run.vo2max', value: '{run.vo2max|int}', label: tl('label.vo2max'), unit: tl('unit.mlKgMin') },
  aerobic: { bind: 'run.aerobicEffect', value: '{run.aerobicEffect|num:1}', label: tl('label.aerobicEffect') },
  anaerobic: { bind: 'run.anaerobicEffect', value: '{run.anaerobicEffect|num:1}', label: tl('label.anaerobicEffect') },
  recovery: { bind: 'run.recoveryHours', value: '{run.recoveryHours|int}', label: tl('label.recoveryHours'), unit: tl('unit.hours') },
  workoutLoad: { bind: 'run.workoutLoad', value: '{run.workoutLoad|int}', label: tl('label.trainingLoad') },
} satisfies Record<string, Cell>;

/** Up to four secondary metrics across running layouts. */
const CELLS3: Cell[] = [
  CELL.time,
  CELL.pace,
  CELL.fastPace,
  CELL.pace100,
  CELL.speed,
  CELL.maxSpeed,
  CELL.hr,
  CELL.minHr,
  CELL.hrMax,
  CELL.kcal,
  CELL.elevLoss,
  CELL.stepLength,
  CELL.cadence,
  CELL.steps,
  CELL.vo2max,
  CELL.aerobic,
  CELL.anaerobic,
  CELL.recovery,
  CELL.workoutLoad,
];

const CELLS4: Cell[] = [
  ...CELLS3,
  CELL.elev,
];

const cellWhen = (cell: Cell): Cond => (cell.when ? all(has(cell.bind), cell.when) : has(cell.bind));

interface StatLook {
  size: number;
  labelSize: number;
  unitSize: number;
  color?: string;
  labelColor?: string;
  weight?: number;
  align?: 'left' | 'center' | 'right';
  labelPos?: 'above' | 'below' | 'none';
  gap?: number;
  shadow?: boolean;
  w?: Dim;
}

function cellStat(k: Kit, cell: Cell, look: StatLook): LayerJson {
  return k.stat({ w: look.w ?? 'fill', h: 'auto' }, cell.value, {
    unit: cell.unit,
    label: cell.label,
    size: look.size,
    labelSize: look.labelSize,
    unitSize: look.unitSize,
    color: look.color,
    labelColor: look.labelColor,
    weight: look.weight,
    align: look.align,
    labelPos: look.labelPos ?? 'above',
    gap: look.gap,
    shadow: look.shadow,
    minSize: 40,
    when: cellWhen(cell),
  });
}

const cellRow = (k: Kit, cells: Cell[], look: StatLook) => cells.map((cell) => cellStat(k, cell, look));

/** A thin horizontal rule: a line shape `h` tall, drawn in the middle of its box. */
const rule = (k: Kit, w: Dim, o: { color?: string; width?: number; when?: Cond } = {}) =>
  k.shape({ w, h: o.width ?? 2 }, 'line', { stroke: { color: o.color ?? '$line', width: o.width ?? 2 } }, { when: o.when });

/** The sport glyph in a box of its own (absolute children inside a plain group, so it sits fine in a stack). */
const glyphBox = (k: Kit, size: number, color: string, o: { when?: Cond } = {}) => k.group({ w: size, h: size }, sportGlyph(k, 0, 0, size, color), o);

/** Brand lockup left, link right, as one stack row: it lives inside a card's column instead of at an absolute y. */
const footerRow = (k: Kit, w: Dim, h = 48, linkSize = 28) =>
  k.group({ w, h: 'auto' }, [k.brand({ w: 'auto', h }, 'lockup', { size: h }), k.brand({ w: 'auto', h: 'auto' }, 'link', { size: linkSize })], {
    dir: 'row',
    justify: 'between',
    align: 'center',
  });

/** An empty box that takes the leftover height (or width in a row) so the content around it is pushed apart. */
const spacer = (k: Kit, when?: Cond) => k.shape({ w: 1, h: 'fill' }, 'rect', {}, { when });

interface HeroLook {
  size: number;
  unitSize: number;
  timeSize?: number;
  color: string;
  weight?: number;
  shadow?: boolean;
  align?: 'left' | 'center' | 'right';
  unit?: boolean;
  label?: boolean;
  labelSize?: number;
  labelColor?: string;
  minSize?: number;
  gap?: number;
}

/** The distance as the hero (metres for a swim); with no distance (a sparse workout) the moving time takes its place. */
function hero(k: Kit, w: Dim, look: HeroLook): LayerJson {
  const common = { size: look.size, unitSize: look.unitSize, weight: look.weight ?? 800, color: look.color, shadow: look.shadow, align: look.align, minSize: look.minSize ?? 120, gap: look.gap };
  const distance = (value: string, unit: string, when: Cond) =>
    k.stat({ w: 'fill' }, value, {
      ...common,
      unit: look.unit === false ? undefined : tl(unit),
      label: look.label ? tl('label.distance') : undefined,
      labelSize: look.labelSize,
      labelColor: look.labelColor,
      labelPos: look.label ? 'above' : 'none',
      when,
    });
  return k.group(
    { w, h: 'auto' },
    [
      distance('{run.distanceM|km}', 'unit.km', all(has('run.distanceM'), not(is('run.category', 'swim')))),
      distance('{run.distanceM|int}', 'unit.m', all(has('run.distanceM'), is('run.category', 'swim'))),
      k.stat({ w: 'fill' }, '{run.movingSec|dur}', {
        ...common,
        size: look.timeSize ?? look.size * 0.7,
        label: look.label ? tl('label.time') : undefined,
        labelSize: look.labelSize,
        labelColor: look.labelColor,
        labelPos: look.label ? 'above' : 'none',
        when: lacks('run.distanceM'),
      }),
    ],
    { dir: 'column' },
  );
}

/** A full-bleed layer (scrim, wash) wrapped in a stack group: absolute layers outside the safe area would trip the lint. */
const bleed = (k: Kit, x: number, y: number, w: number, h: number, child: LayerJson): LayerJson => k.group({ x, y, w, h }, [child], { dir: 'column' });

const sportText = (k: Kit, o: { size: number; color: string; weight?: number; ls?: number; upper?: boolean; minSize?: number; shadow?: boolean }) =>
  k.text({ w: 'fill' }, '{run.sport}', { size: o.size, weight: o.weight ?? 800, upper: o.upper ?? true, ls: o.ls ?? 3, color: o.color, minSize: o.minSize ?? 26, shadow: o.shadow });

const dateText = (k: Kit, o: { size: number; color: string; weight?: number; upper?: boolean; ls?: number; shadow?: boolean }) =>
  k.text({ w: 'auto' }, '{run.startedAt|date:medium}', { size: o.size, weight: o.weight ?? 600, color: o.color, align: 'right', upper: o.upper, ls: o.ls, shadow: o.shadow });

/** Sport glyph disc, sport name, date: the header of the bold and photo cards. */
function headerRow(k: Kit, o: { disc: number; glyph: number; size: number; dateSize: number; color: string; muted: string; discFill: string; shadow?: boolean; gap?: number }): LayerJson {
  const off = (o.disc - o.glyph) / 2;
  return k.group(
    { w: 'fill', h: o.disc },
    [
      k.group({ w: o.disc, h: o.disc }, [k.shape({ x: 0, y: 0, w: o.disc, h: o.disc }, 'ellipse', { fill: o.discFill }), ...sportGlyph(k, off, off, o.glyph, o.color)]),
      sportText(k, { size: o.size, color: o.color, shadow: o.shadow, minSize: 30 }),
      dateText(k, { size: o.dateSize, color: o.muted, shadow: o.shadow }),
    ],
    { dir: 'row', gap: o.gap ?? 24, align: 'center' },
  );
}

interface Spec {
  id: string;
  name: string;
  titleKey: string;
  style: string;
  canvas: Canvas;
  palette: Palette;
  background: unknown;
  layers: LayerJson[];
  tags: string[];
  photo?: boolean;
}

function build(spec: Spec) {
  return template({
    id: `run.${spec.id}.${spec.canvas}`,
    name: spec.name,
    titleKey: `stickers:tpl.run.${spec.titleKey}`,
    kind: 'run',
    style: spec.style,
    aspect: spec.canvas,
    background: spec.background,
    dark: spec.palette.dark,
    light: spec.palette.light,
    layers: spec.layers,
    // The sport glyph is one layer per family and kind (most of them hidden): the poster draws it twice.
    constraints: { maxLayers: 140 },
    meta: { tags: spec.tags, ...(spec.photo ? { needsPhoto: true } : {}) },
  });
}

// ---------------------------------------------------------------------------------------------------------------- bold

/** `run.bold.*`: volt on black (volt card by day). The distance is the poster; the route sits under it. */
function runBold(canvas: Canvas) {
  const k = kit('rb');
  const story = canvas === 'story';
  const W = 936;
  const header = headerRow(k, { disc: story ? 96 : 80, glyph: story ? 48 : 40, size: story ? 44 : 38, dateSize: story ? 34 : 30, color: '$fg', muted: '$fgMuted', discFill: '$surfaceStrong' });
  const heroLayer = hero(k, W, { size: story ? 430 : 330, unitSize: story ? 96 : 76, timeSize: story ? 300 : 240, color: '$accent' });
  const route = (box: { w: Dim; h: Dim }, when?: Cond) => k.route(box, { color: '$fg', color2: '$accent', strokeWidth: story ? 16 : 14, halo: true, markers: true, padding: 40 }, { when: when ?? has('run.route') });

  let root: LayerJson;
  if (story) {
    const stats = k.group({ w: 'fill', h: 'auto' }, cellRow(k, CELLS3, { size: 70, labelSize: 26, unitSize: 30, color: '$fg', labelColor: '$fgMuted' }), { dir: 'row', gap: 28, align: 'start' });
    // Without a route the two spacers split the free height, so the hero sits in the middle instead of under the header.
    root = k.group(
      { x: 72, y: 250, w: W, h: 1190 },
      [header, spacer(k, lacks('run.route')), heroLayer, route({ w: W, h: 'fill' }), spacer(k, lacks('run.route')), stats],
      { dir: 'column', gap: 36, align: 'stretch', justify: 'between' },
    );
    return build({
      id: 'bold',
      name: 'Run, bold, story',
      titleKey: 'bold',
      style: 'bold',
      canvas,
      palette: VOLT,
      background: { kind: 'color', color: '$bg' },
      layers: [root, ...footer(k, 72, 1510, W)],
      tags: ['numbers'],
    });
  }

  // Square: hero across the top, then the route on the left with the numbers stacked beside it; no route, the numbers run as a row.
  const column = k.group(
    { w: 300, h: 'fill' },
    cellRow(k, CELLS4, { size: 60, labelSize: 26, unitSize: 28, color: '$fg', labelColor: '$fgMuted', w: 'fill' }),
    { dir: 'column', gap: 24, justify: 'center', when: has('run.route') },
  );
  const lower = k.group({ w: W, h: 'fill' }, [route({ w: 'fill', h: 'fill' }), column], { dir: 'row', gap: 36, align: 'stretch', when: has('run.route') });
  const strip = k.group({ w: W, h: 'auto' }, cellRow(k, CELLS3, { size: 64, labelSize: 26, unitSize: 28, color: '$fg', labelColor: '$fgMuted' }), { dir: 'row', gap: 28, align: 'start', when: lacks('run.route') });
  root = k.group(
    { x: 72, y: 72, w: W, h: 936 },
    [header, spacer(k, lacks('run.route')), heroLayer, lower, spacer(k, lacks('run.route')), strip, footerRow(k, W)],
    { dir: 'column', gap: 36, align: 'start', justify: 'between' },
  );
  return build({
    id: 'bold',
    name: 'Run, bold, square',
    titleKey: 'bold',
    style: 'bold',
    canvas,
    palette: VOLT,
    background: { kind: 'color', color: '$bg' },
    layers: [root],
    tags: ['numbers'],
  });
}

// -------------------------------------------------------------------------------------------------------------- poster

/** `run.poster.*`: editorial. A caption line, hairlines, the distance as wide as the canvas, the route as art, small-caps metadata. */
function runPoster(canvas: Canvas) {
  const k = kit('rp');
  const story = canvas === 'story';
  const W = 936;

  const top = k.group(
    { w: W, h: 'auto' },
    [
      glyphBox(k, story ? 44 : 40, '$accent'),
      sportText(k, { size: story ? 30 : 28, color: '$fg', weight: 700, ls: 6, minSize: 24 }),
      dateText(k, { size: story ? 28 : 26, color: '$fgMuted', weight: 600, upper: true, ls: 4 }),
    ],
    { dir: 'row', gap: 20, align: 'center' },
  );

  const caption = (key: string, when: Cond, unit?: string) =>
    k.group(
      { w: W, h: 'auto' },
      [
        k.text({ w: 'fill' }, tl(key), { size: 26, weight: 700, upper: true, ls: 6, color: '$fgMuted' }),
        ...(unit ? [k.text({ w: 'auto' }, tl(unit), { size: 34, weight: 800, upper: true, ls: 6, color: '$accent', align: 'right' })] : []),
      ],
      { dir: 'row', align: 'center', when },
    );
  const captions = [
    caption('label.distance', all(has('run.distanceM'), not(is('run.category', 'swim'))), 'unit.km'),
    caption('label.distance', all(has('run.distanceM'), is('run.category', 'swim')), 'unit.m'),
    caption('label.time', lacks('run.distanceM')),
  ];

  // 1032 wide: the numerals run closer to the canvas edge than the 72 px text margin.
  const heroLayer = hero(k, 1032, { size: story ? 700 : 470, unitSize: 1, unit: false, timeSize: story ? 460 : 330, color: '$fg', minSize: 120 });

  const metaCell = (cell: Cell, size: number) =>
    k.group(
      { w: 'fill', h: 'auto' },
      [
        k.text({ w: 'fill' }, cell.label, { size: 24, weight: 700, upper: true, ls: 3, color: '$fgMuted' }),
        cellStat(k, cell, { size, labelSize: 24, unitSize: 26, color: '$fg', weight: 700, labelPos: 'none' }),
      ],
      { dir: 'column', gap: 14, when: cellWhen(cell) },
    );

  const art = (w: Dim, padding: number) =>
    k.route({ w, h: 'fill' }, { color: '$accent', color2: '$accent2', strokeWidth: story ? 26 : 18, halo: true, markers: true, padding }, { when: has('run.route') });
  const glyphArt = (w: Dim) => k.group({ w, h: 'fill' }, [glyphBox(k, story ? 320 : 240, '$accent')], { dir: 'column', align: 'center', justify: 'center', when: lacks('run.route') });

  if (story) {
    const meta = k.group({ w: W, h: 'auto' }, CELLS4.map((cell) => metaCell(cell, 56)), { dir: 'row', gap: 24, align: 'start' });
    const root = k.group(
      { x: 72, y: 250, w: W, h: 1330 },
      [top, rule(k, W), ...captions, heroLayer, art(1080, 92), glyphArt(W), rule(k, W), meta, footerRow(k, W)],
      { dir: 'column', gap: 30, align: 'center' },
    );
    return build({ id: 'poster', name: 'Run, poster, story', titleKey: 'poster', style: 'poster', canvas, palette: PAPER, background: { kind: 'color', color: '$bg' }, layers: [root], tags: ['editorial'] });
  }

  // Square: the route runs wide on the right, the metadata hangs off a narrow column on the left.
  const column = k.group({ w: 270, h: 'fill' }, CELLS3.map((cell) => metaCell(cell, 52)), { dir: 'column', gap: 22, align: 'stretch' });
  const lower = k.group({ w: W, h: 'fill' }, [column, art('fill', 10), glyphArt('fill')], { dir: 'row', gap: 24, align: 'stretch' });
  const root = k.group(
    { x: 72, y: 60, w: W, h: 960 },
    [top, rule(k, W), ...captions, heroLayer, lower, footerRow(k, W, 44)],
    { dir: 'column', gap: 18, align: 'center' },
  );
  return build({ id: 'poster', name: 'Run, poster, square', titleKey: 'poster', style: 'poster', canvas, palette: PAPER, background: { kind: 'color', color: '$bg' }, layers: [root], tags: ['editorial'] });
}

// ------------------------------------------------------------------------------------------------------------- minimal

/** `run.minimal.*`: restrained. Medium-weight numbers, hairlines, a small route, a lot of air. */
function runMinimal(canvas: Canvas) {
  const k = kit('rm');
  const story = canvas === 'story';
  const W = 936;

  const header = k.group(
    { w: 'fill', h: 'auto' },
    [
      glyphBox(k, 40, '$fgMuted'),
      sportText(k, { size: 32, color: '$fg', weight: 600, upper: false, ls: 0, minSize: 26 }),
      dateText(k, { size: 30, color: '$fgMuted', weight: 500 }),
    ],
    { dir: 'row', gap: 20, align: 'center' },
  );

  const heroLayer = hero(k, W, { size: story ? 290 : 230, unitSize: story ? 64 : 52, timeSize: story ? 220 : 180, color: '$fg', weight: 500, label: true, labelSize: 30, labelColor: '$fgMuted', gap: 24 });

  const route = (box: { w: Dim; h: Dim }) => k.route(box, { color: '$accent', strokeWidth: 8, halo: false, markers: true, padding: 20 }, { when: has('run.route') });
  const gear = k.text({ w: W }, '{run.gear}', { size: 26, weight: 500, color: '$fgMuted', fit: 'ellipsis' });

  if (story) {
    const row = (cell: Cell) =>
      k.group(
        { w: W, h: 'auto' },
        [
          rule(k, W),
          k.group(
            { w: W, h: 'auto' },
            [
              k.text({ w: 'auto' }, cell.label, { size: 32, weight: 500, color: '$fgMuted' }),
              k.stat({ w: 'auto', h: 'auto' }, cell.value, { unit: cell.unit, size: 56, unitSize: 28, weight: 600, color: '$fg', labelPos: 'none', align: 'right', minSize: 36 }),
            ],
            { dir: 'row', justify: 'between', align: 'end' },
          ),
        ],
        { dir: 'column', gap: 24, when: cellWhen(cell) },
      );
    const table = k.group({ w: W, h: 'auto' }, CELLS4.map(row), { dir: 'column', gap: 24 });
    const root = k.group(
      { x: 72, y: 250, w: W, h: 1330 },
      [header, rule(k, W), spacer(k), heroLayer, table, gear, spacer(k), route({ w: 440, h: 330 }), footerRow(k, W)],
      { dir: 'column', gap: 36, align: 'start' },
    );
    return build({ id: 'minimal', name: 'Run, minimal, story', titleKey: 'minimal', style: 'minimal', canvas, palette: INK, background: { kind: 'color', color: '$bg' }, layers: [root], tags: ['minimal'] });
  }

  const topRow = k.group(
    { w: W, h: 'auto' },
    [header, route({ w: 260, h: 190 })],
    { dir: 'row', gap: 24, align: 'start' },
  );
  const table = k.group({ w: W, h: 'auto' }, [rule(k, W), k.group({ w: W, h: 'auto' }, cellRow(k, CELLS3, { size: 52, labelSize: 28, unitSize: 26, weight: 600, color: '$fg', labelColor: '$fgMuted', gap: 12 }), { dir: 'row', gap: 28, align: 'start' })], { dir: 'column', gap: 28 });
  const root = k.group({ x: 72, y: 72, w: W, h: 936 }, [topRow, spacer(k), heroLayer, table, spacer(k), footerRow(k, W, 44)], { dir: 'column', gap: 36, align: 'start' });
  return build({ id: 'minimal', name: 'Run, minimal, square', titleKey: 'minimal', style: 'minimal', canvas, palette: INK, background: { kind: 'color', color: '$bg' }, layers: [root], tags: ['minimal'] });
}

// ----------------------------------------------------------------------------------------------------------------- photo

// Photo styles (photo corner, pill, editorial) are in ./photoTemplates.ts

export const RUN_TEMPLATES = [
  runBold('story'),
  runBold('square'),
  runPoster('story'),
  runPoster('square'),
  runMinimal('story'),
  runMinimal('square'),
  runPhoto('story'),
  runPhoto('square'),
  runGlass('story'),
  runGlass('square'),
  runEditorial('story'),
  runEditorial('square'),
];
