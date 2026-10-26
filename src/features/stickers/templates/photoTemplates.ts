import { all, has, is, lacks, not, sportGlyph, tl } from './blocks';
import { kit, template } from './dsl';
import type { Cond, Dim, Expr, Kit, LayerJson } from './dsl';
import { GLASS } from './palette';

type Canvas = 'story' | 'square';

const PHOTO_FALLBACK = {
  kind: 'gradient' as const,
  angle: 180,
  stops: [
    { at: 0, color: '#161d26' },
    { at: 0.5, color: '#0d131a' },
    { at: 1, color: '#05070a' },
  ],
};

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
  pace100: { bind: 'run.pace100Sec', value: '{run.pace100Sec|pace}', label: tl('label.pace'), unit: tl('unit.per100m') },
  speed: { bind: 'run.speedKmh', value: '{run.speedKmh|num:1}', label: tl('label.speed'), unit: tl('unit.kmh') },
  hr: { bind: 'run.hrAvg', value: '{run.hrAvg|int}', label: tl('label.hr'), unit: tl('unit.bpm') },
  kcal: { bind: 'run.kcal', value: '{run.kcal|int}', label: tl('label.kcal'), when: lacks('run.hrAvg') },
  elev: { bind: 'run.elevGainM', value: '{run.elevGainM|int}', label: tl('label.elevation'), unit: tl('unit.m') },
  steps: { bind: 'run.steps', value: '{run.steps|int}', label: tl('label.steps') },
  jumps: { bind: 'run.jumps', value: '{run.jumps|int}', label: tl('label.jumps') },
  jumpRate: { bind: 'run.jumpRate', value: '{run.jumpRate|int}', label: tl('label.jumpRate'), unit: tl('unit.perMin') },
  longestStreak: { bind: 'run.longestStreak', value: '{run.longestStreak|int}', label: tl('label.longestStreak') },
  interruptions: { bind: 'run.interruptions', value: '{run.interruptions|int}', label: tl('label.interruptions') },
  cadence: { bind: 'run.cadence', value: '{run.cadence|int}', label: tl('label.cadence'), unit: tl('unit.rpm') },
  power: { bind: 'run.power', value: '{run.power|int}', label: tl('label.power'), unit: tl('unit.watt') },
  maxSpeed: { bind: 'run.maxSpeedKmh', value: '{run.maxSpeedKmh|num:1}', label: tl('label.maxSpeed'), unit: tl('unit.kmh') },
  fastPace: { bind: 'run.paceFastestSec', value: '{run.paceFastestSec|pace}', label: tl('label.bestPace'), unit: tl('unit.perKm') },
  elevLoss: { bind: 'run.elevLossM', value: '{run.elevLossM|int}', label: tl('label.elevLoss'), unit: tl('unit.m') },
  stepLength: { bind: 'run.stepLengthCm', value: '{run.stepLengthCm|int}', label: tl('label.stepLength'), unit: tl('unit.cm') },
  minHr: { bind: 'run.minHr', value: '{run.minHr|int}', label: tl('label.minHr'), unit: tl('unit.bpm') },
  hrMax: { bind: 'run.hrMax', value: '{run.hrMax|int}', label: tl('label.maxHr'), unit: tl('unit.bpm') },
  swimStyle: { bind: 'run.swimStyle', value: '{run.swimStyle}', label: tl('label.swimStyle') },
  strokeRate: { bind: 'run.strokeRate', value: '{run.strokeRate|int}', label: tl('label.strokeRate'), unit: tl('unit.perMin') },
  laps: { bind: 'run.laps', value: '{run.laps|int}', label: tl('label.laps') },
  swolf: { bind: 'run.swolf', value: '{run.swolf|int}', label: tl('label.swolf') },
  strokes: { bind: 'run.strokes', value: '{run.strokes|int}', label: tl('label.strokes') },
  pool: { bind: 'run.poolM', value: '{run.poolM|int}', label: tl('label.pool'), unit: tl('unit.m') },
  volume: { bind: 'run.volumeKg', value: '{run.volumeKg|int}', label: tl('label.volume'), unit: tl('unit.kg') },
  sets: { bind: 'run.sets', value: '{run.sets|int}', label: tl('label.sets') },
  reps: { bind: 'run.reps', value: '{run.reps|int}', label: tl('label.reps') },
  exercises: { bind: 'run.exercises', value: '{run.exercises|int}', label: tl('label.exercises') },
  aerobic: { bind: 'run.aerobicEffect', value: '{run.aerobicEffect|num:1}', label: tl('label.aerobicEffect') },
  anaerobic: { bind: 'run.anaerobicEffect', value: '{run.anaerobicEffect|num:1}', label: tl('label.anaerobicEffect') },
  vo2max: { bind: 'run.vo2max', value: '{run.vo2max|int}', label: tl('label.vo2max'), unit: tl('unit.mlKgMin') },
  recovery: { bind: 'run.recoveryHours', value: '{run.recoveryHours|int}', label: tl('label.recoveryHours'), unit: tl('unit.hours') },
  workoutLoad: { bind: 'run.workoutLoad', value: '{run.workoutLoad|int}', label: tl('label.trainingLoad') },
} satisfies Record<string, Cell>;

const ALL_PHOTO_CELLS: Cell[] = Object.values(CELL);

const cellWhen = (c: Cell): Cond => (c.when ? all(has(c.bind), c.when) : has(c.bind));

function photoStatRow(
  k: Kit,
  size: number,
  labelSize: number,
  unitSize: number,
  shadow = true,
): LayerJson[] {
  return ALL_PHOTO_CELLS.map((c) =>
    k.stat({ w: 'fill', h: 'auto' }, c.value, {
      unit: c.unit,
      label: c.label,
      size,
      labelSize,
      unitSize,
      color: '$fg',
      labelColor: '$fgSoft',
      weight: 800,
      shadow,
      minSize: 28,
      when: cellWhen(c),
    }),
  );
}

function photoHero(
  k: Kit,
  w: Dim,
  size: number,
  unitSize: number,
  timeSize: number,
  shadow = true,
): LayerJson {
  const common = { size, unitSize, weight: 900, color: '$fg', shadow, minSize: 64 };
  return k.group(
    { w, h: 'auto' },
    [
      k.stat({ w: 'fill' }, '{run.distanceM|km}', { ...common, unit: tl('unit.km'), when: all(has('run.distanceM'), not(is('run.category', 'swim'))) }),
      k.stat({ w: 'fill' }, '{run.distanceM|int}', { ...common, unit: tl('unit.m'), when: all(has('run.distanceM'), is('run.category', 'swim')) }),
      k.stat({ w: 'fill' }, '{run.volumeKg|int}', { ...common, unit: tl('unit.kg'), label: tl('label.volume'), when: all(has('run.volumeKg'), lacks('run.distanceM')) }),
      k.stat({ w: 'fill' }, '{run.jumps|int}', { ...common, label: tl('label.jumps'), when: all(has('run.jumps'), lacks('run.distanceM')) }),
      k.stat({ w: 'fill' }, '{run.steps|int}', { ...common, label: tl('label.steps'), when: all(has('run.steps'), lacks('run.distanceM'), lacks('run.volumeKg'), lacks('run.jumps')) }),
      k.stat({ w: 'fill' }, '{run.movingSec|dur}', { ...common, size: timeSize, label: tl('label.time'), when: all(lacks('run.distanceM'), lacks('run.volumeKg'), lacks('run.jumps'), lacks('run.steps')) }),
    ],
    { dir: 'column' },
  );
}

const bleed = (k: Kit, x: number, y: number, w: number, h: number, child: LayerJson): LayerJson =>
  k.group({ x, y, w, h }, [child], { dir: 'column' });

function buildPhoto(
  id: string,
  name: string,
  titleKey: string,
  style: string,
  canvas: Canvas,
  layers: LayerJson[],
) {
  return template({
    id: `run.${id}.${canvas}`,
    name,
    titleKey: `stickers:tpl.run.${titleKey}`,
    kind: 'run',
    style,
    aspect: canvas,
    dark: GLASS.dark,
    light: GLASS.light,
    background: { kind: 'photo', bind: 'photo', fit: 'cover', fallback: PHOTO_FALLBACK },
    layers,
    constraints: { maxLayers: 80 },
    meta: { tags: ['photo', style], needsPhoto: true },
  });
}

/** 1. Clean Corner (Strava style): unobtrusive, 85% photo clear, stats in bottom corner. */
export function runPhoto(canvas: Canvas) {
  const k = kit('rpc');
  const story = canvas === 'story';
  const W = 936;
  const H = story ? 1920 : 1080;
  const y0 = story ? 1300 : 680;

  // Gentle bottom wash
  const ease = bleed(
    k,
    0,
    y0,
    1080,
    H - y0,
    k.shape({ w: 1080, h: H - y0 }, 'rect', {
      fill: {
        gradient: {
          angle: 180,
          stops: [
            { at: 0, color: '$bg/0' },
            { at: 0.5, color: '$bg/45' },
            { at: 1, color: '$bg/72' },
          ],
        },
      },
    }),
  );

  const topBadge = k.group(
    { w: W, h: 'auto' },
    [
      k.brand({ w: 'auto', h: 36 }, 'lockup', { size: 36 }),
      k.route(
        { w: 200, h: 140 },
        { color: '$fg', color2: '$accent', strokeWidth: 10, halo: true, markers: true, padding: 18 },
        { when: has('run.route') },
      ),
    ],
    { dir: 'row', justify: 'between', align: 'center' },
  );

  const header = k.group(
    { w: W, h: 'auto' },
    [
      k.text({ w: 'fill' }, '{run.sport}', { size: 28, weight: 800, upper: true, ls: 2, color: '$fg', shadow: true, minSize: 20 }),
      k.text({ w: 'auto' }, '{run.startedAt|date:medium}', { size: 24, weight: 600, color: '$fgSoft', shadow: true }),
    ],
    { dir: 'row', gap: 14, align: 'center', justify: 'between' },
  );

  const hero = photoHero(k, W, story ? 180 : 130, story ? 48 : 36, story ? 120 : 90, true);
  const stats = k.group(
    { w: W, h: 'auto' },
    photoStatRow(k, story ? 46 : 38, 22, 24, true),
    { dir: 'row', gap: 24, align: 'start' },
  );

  const root = k.group(
    { x: 72, y: story ? 250 : 72, w: W, h: story ? 1330 : 936 },
    [topBadge, k.shape({ w: 1, h: 'fill' }, 'rect'), header, hero, stats],
    { dir: 'column', gap: story ? 28 : 20, align: 'start' },
  );

  return buildPhoto('photo', `Run, photo corner, ${canvas}`, 'photo', 'photo', canvas, [ease, root]);
}

/** 2. Modern Pill (Apple Fitness / WHOOP style): floating frosted glass capsule. */
export function runGlass(canvas: Canvas) {
  const k = kit('rpg');
  const story = canvas === 'story';
  const W = 936;
  const PAD = story ? 36 : 28;
  const inner = W - PAD * 2;

  const header = k.group(
    { w: inner, h: 'auto' },
    [
      k.group({ w: 32, h: 32 }, sportGlyph(k, 0, 0, 32, '$fg')),
      k.text({ w: 'fill' }, '{run.sport}', { size: 28, weight: 800, upper: true, ls: 2, color: '$fg', minSize: 20 }),
      k.text({ w: 'auto' }, '{run.startedAt|date:medium}', { size: 24, weight: 600, color: '$fgSoft' }),
    ],
    { dir: 'row', gap: 14, align: 'center', justify: 'between' },
  );

  const heroRow = k.group(
    { w: inner, h: 'auto' },
    [
      photoHero(k, 'fill', story ? 140 : 100, story ? 38 : 28, story ? 96 : 72, false),
      k.route(
        { w: 200, h: 120 },
        { color: '$fg', color2: '$accent', strokeWidth: 10, halo: true, markers: true, padding: 16 },
        { when: has('run.route') },
      ),
    ],
    { dir: 'row', gap: 16, align: 'center' },
  );

  const rule = k.shape({ w: inner, h: 2 }, 'line', { stroke: { color: '$line', width: 2 } });
  const stats = k.group(
    { w: inner, h: 'auto' },
    photoStatRow(k, story ? 44 : 36, 20, 22, false),
    { dir: 'row', gap: 20, align: 'start' },
  );

  const footer = k.group(
    { w: inner, h: 'auto' },
    [k.brand({ w: 'auto', h: 30 }, 'lockup', { size: 30 })],
    { dir: 'row', justify: 'end', align: 'center' },
  );

  const panel = k.group(
    { w: W, h: 'auto' },
    [header, heroRow, rule, stats, footer],
    {
      dir: 'column',
      gap: story ? 24 : 18,
      align: 'start',
      padding: PAD,
      fill: { gradient: { angle: 180, stops: [{ at: 0, color: '$bg/62' }, { at: 1, color: '$bg/82' }] } },
      radius: story ? 38 : 30,
      glass: true,
    },
  );

  const root = k.group(
    { x: 72, y: story ? 250 : 72, w: W, h: story ? 1330 : 936 },
    [panel],
    { dir: 'column', justify: 'end', align: 'start' },
  );

  return buildPhoto('glass', `Run, photo pill, ${canvas}`, 'glass', 'glass', canvas, [root]);
}

/** 3. Editorial Magazine: sleek top banner + bottom ruler spread. */
export function runEditorial(canvas: Canvas) {
  const k = kit('rpe');
  const story = canvas === 'story';
  const W = 936;
  const H = story ? 1920 : 1080;

  const topWash = bleed(
    k,
    0,
    0,
    1080,
    story ? 400 : 260,
    k.shape({ w: 1080, h: story ? 400 : 260 }, 'rect', {
      fill: { gradient: { angle: 180, stops: [{ at: 0, color: '$bg/65' }, { at: 1, color: '$bg/0' }] } },
    }),
  );

  const botWash = bleed(
    k,
    0,
    story ? 1380 : 700,
    1080,
    H - (story ? 1380 : 700),
    k.shape({ w: 1080, h: H - (story ? 1380 : 700) }, 'rect', {
      fill: { gradient: { angle: 180, stops: [{ at: 0, color: '$bg/0' }, { at: 1, color: '$bg/72' }] } },
    }),
  );

  const topHeader = k.group(
    { w: W, h: 'auto' },
    [
      k.text({ w: 'fill' }, '{run.sport}', { size: story ? 48 : 38, weight: 900, upper: true, ls: 6, color: '$fg', shadow: true }),
      k.text({ w: 'fill' }, '{run.startedAt|date:medium}', { size: story ? 26 : 22, weight: 600, upper: true, ls: 3, color: '$fgSoft', shadow: true }),
    ],
    { dir: 'column', gap: 10, align: 'start' },
  );

  const hero = photoHero(k, W, story ? 160 : 120, story ? 44 : 32, story ? 110 : 80, true);
  const ruler = k.shape({ w: W, h: 2 }, 'line', { stroke: { color: '$line', width: 2 } });
  const stats = k.group(
    { w: W, h: 'auto' },
    photoStatRow(k, story ? 46 : 38, 22, 24, true),
    { dir: 'row', gap: 24, align: 'start' },
  );

  const footer = k.group(
    { w: W, h: 'auto' },
    [k.brand({ w: 'auto', h: 32 }, 'lockup', { size: 32 })],
    { dir: 'row', justify: 'between', align: 'center' },
  );

  const root = k.group(
    { x: 72, y: story ? 250 : 72, w: W, h: story ? 1330 : 936 },
    [topHeader, k.shape({ w: 1, h: 'fill' }, 'rect'), hero, ruler, stats, footer],
    { dir: 'column', gap: story ? 24 : 18, align: 'start' },
  );

  return buildPhoto('editorial', `Run, photo editorial, ${canvas}`, 'editorial', 'editorial', canvas, [
    topWash,
    botWash,
    root,
  ]);
}
