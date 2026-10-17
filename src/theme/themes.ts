/**
 * JoyoFit themes. Pure data, no React Native imports, so the contrast test can run under bun.
 *
 * A theme is a palette pair (light and dark), radii and a type scale for the big numerals.
 * Components never read a theme directly: they go through `useTheme()` / `useColors()` in `./index`.
 *
 * - Classic: the original look. Warm paper canvas, ink-teal primary, Plus Jakarta Sans, large radii.
 *   Light and dark follow the phone. Same family as JoyoRogo design v2: one primary plus data colors
 *   that only tell metrics apart, each with a soft tint (chip and tile backgrounds) and a darker
 *   `*Text` shade that passes AA on that tint. Sleep stays indigo, the same as JoyoRogo's "tidur".
 *   The watch hero is an ink "screen" panel in both palettes, so the live numbers read like a watch face.
 * - Sport: Nike Run Club / Strava feel. Always dark, near-black canvas, one volt accent, tight radii,
 *   square-ish controls, heavier weights and bigger tabular numerals.
 * - Ocean: cool blue-grey canvas and a blue primary. Light and dark follow the phone.
 *
 * Contrast (enforced in `themes.test.ts` for every palette of every theme): every `*Text` on its
 * `*Soft` and on `card` is >= 4.5; base data colors on `card` are >= 3 (non-text 3:1); `mutedForeground`
 * is >= 4.5 on background, card and muted; hero text is >= 4.5 on `hero`.
 */

export type Tint = 'steps' | 'heart' | 'sleep' | 'workouts' | 'link';

export interface Colors {
  background: string;
  card: string;
  foreground: string;
  muted: string;
  mutedForeground: string;
  hairline: string;
  primary: string;
  primaryForeground: string;
  destructive: string;
  destructiveSoft: string;
  warning: string;
  switchOff: string;
  steps: string;
  stepsSoft: string;
  stepsText: string;
  heart: string;
  heartSoft: string;
  heartText: string;
  sleep: string;
  sleepSoft: string;
  sleepText: string;
  workouts: string;
  workoutsSoft: string;
  workoutsText: string;
  link: string;
  linkSoft: string;
  linkText: string;
  stageDeep: string;
  stageRem: string;
  stageLight: string;
  stageAwake: string;
  hero: string;
  heroForeground: string;
  heroMuted: string;
  heroTrack: string;
  heroDivider: string;
  heroSteps: string;
  heroHeart: string;
  heroLink: string;
  heroWarn: string;
  /** Route line and highlight on the hero panel and the share card. */
  heroAccent: string;
}

export type Scheme = 'light' | 'dark';

export interface Radii {
  /** Cards, sheets, dialogs. */
  card: number;
  /** Stat tiles, route and photo frames. */
  tile: number;
  input: number;
  /** Buttons, chips and the segmented control. Pill-shaped (999) or squarer. */
  control: number;
}

/** One size of a big number: the number itself and the small unit that follows it. */
export interface NumeralStyle {
  size: number;
  line: number;
  tracking: number;
  unit: number;
}

export interface FontFamilies {
  regular: string;
  medium: string;
  bold: string;
  heavy: string;
}

export interface Typography {
  /** Which loaded Plus Jakarta Sans weight each role uses. Android has no weight axis, so each weight is a family. */
  fonts: FontFamilies;
  /** The metric numeral scale: Today hero, tile figures, section figures, inline figures. */
  numeral: { hero: NumeralStyle; lg: NumeralStyle; md: NumeralStyle; sm: NumeralStyle };
  /** Page titles. */
  title: { size: number; line: number; tracking: number };
}

export type ThemeId = 'classic' | 'sport' | 'ocean';

export interface Theme {
  id: ThemeId;
  name: string;
  /** One line under the name in the picker. */
  tagline: string;
  /** `system` follows the phone's light/dark setting; the others pin it. */
  appearance: 'system' | Scheme;
  palettes: { light: Colors; dark: Colors };
  radius: Radii;
  type: Typography;
}

/** Loaded in the root layout; see `PlusJakartaSans_*` there. */
const PLUS_JAKARTA = {
  w500: 'PlusJakartaSans_500Medium',
  w600: 'PlusJakartaSans_600SemiBold',
  w700: 'PlusJakartaSans_700Bold',
  w800: 'PlusJakartaSans_800ExtraBold',
} as const;

const classicLight: Colors = {
  background: '#F9F6F1',
  card: '#FFFFFF',
  foreground: '#1D1A15',
  muted: '#F0ECE5',
  mutedForeground: '#66635C',
  hairline: 'rgba(29,26,21,0.10)',
  primary: '#0A6580',
  primaryForeground: '#FFFFFF',
  destructive: '#B42318',
  destructiveSoft: '#FDE7E4',
  warning: '#B45309',
  switchOff: '#D6D0C6',
  steps: '#0A6580',
  stepsSoft: '#DCF0F6',
  stepsText: '#07506A',
  heart: '#D12F4D',
  heartSoft: '#FFE4E9',
  heartText: '#A31E39',
  sleep: '#5C69BC',
  sleepSoft: '#E8EDFF',
  sleepText: '#424B8E',
  workouts: '#C2700A',
  workoutsSoft: '#FFEFD6',
  workoutsText: '#8A4E00',
  link: '#177A45',
  linkSoft: '#DFF5E6',
  linkText: '#0F6236',
  stageDeep: '#3F4A9A',
  stageRem: '#8A6BD4',
  stageLight: '#A9B3EA',
  stageAwake: '#E2A03A',
  hero: '#0F2F3A',
  heroForeground: '#F2F7F8',
  heroMuted: '#A9C2C9',
  heroTrack: '#24505E',
  heroDivider: 'rgba(242,247,248,0.14)',
  heroSteps: '#5FD3EE',
  heroHeart: '#FF8FA4',
  heroLink: '#6EE7A0',
  heroWarn: '#F5B35A',
  heroAccent: '#F5B35A',
};

const classicDark: Colors = {
  background: '#0D1112',
  card: '#171D1F',
  foreground: '#EEF1F0',
  muted: '#242C2F',
  mutedForeground: '#9BA6A8',
  hairline: 'rgba(238,241,240,0.10)',
  primary: '#58C4DE',
  primaryForeground: '#04222B',
  destructive: '#FF8A80',
  destructiveSoft: '#41201E',
  warning: '#F0A23C',
  switchOff: '#3A4346',
  steps: '#58C4DE',
  stepsSoft: '#12323C',
  stepsText: '#58C4DE',
  heart: '#FF7B93',
  heartSoft: '#42202B',
  heartText: '#FF8FA4',
  sleep: '#8F9BE3',
  sleepSoft: '#262C4A',
  sleepText: '#9AA5E8',
  workouts: '#F0A23C',
  workoutsSoft: '#41300F',
  workoutsText: '#F0A23C',
  link: '#5FD08D',
  linkSoft: '#123324',
  linkText: '#5FD08D',
  stageDeep: '#4B57B5',
  stageRem: '#C09CF5',
  stageLight: '#8F9BE3',
  stageAwake: '#F0A23C',
  hero: '#10303B',
  heroForeground: '#F2F7F8',
  heroMuted: '#A9C2C9',
  heroTrack: '#24505E',
  heroDivider: 'rgba(242,247,248,0.14)',
  heroSteps: '#5FD3EE',
  heroHeart: '#FF8FA4',
  heroLink: '#6EE7A0',
  heroWarn: '#F5B35A',
  heroAccent: '#F5B35A',
};

/** Volt on near-black. The volt is the only brand color; data colors are hot and saturated so they pop on black. */
const sportDark: Colors = {
  background: '#0B0B0C',
  card: '#17171A',
  foreground: '#FFFFFF',
  muted: '#242428',
  mutedForeground: '#A3A3AD',
  hairline: 'rgba(255,255,255,0.12)',
  primary: '#D4FF3A',
  primaryForeground: '#0B0B0C',
  destructive: '#FF6B78',
  destructiveSoft: '#3A1519',
  warning: '#FFA040',
  switchOff: '#3A3A41',
  steps: '#D4FF3A',
  stepsSoft: '#252C0B',
  stepsText: '#D4FF3A',
  heart: '#FF4D6A',
  heartSoft: '#3A141E',
  heartText: '#FF8196',
  sleep: '#8F86FF',
  sleepSoft: '#211E48',
  sleepText: '#B3ACFF',
  workouts: '#FF8A1F',
  workoutsSoft: '#3A2008',
  workoutsText: '#FFA550',
  link: '#2EE59D',
  linkSoft: '#0B3324',
  linkText: '#52F0B2',
  stageDeep: '#5B4FE0',
  stageRem: '#C4A8FF',
  stageLight: '#8F86FF',
  stageAwake: '#FF8A1F',
  hero: '#1E2308',
  heroForeground: '#FFFFFF',
  heroMuted: '#B8BFA0',
  heroTrack: '#3A4413',
  heroDivider: 'rgba(255,255,255,0.14)',
  heroSteps: '#D4FF3A',
  heroHeart: '#FF7D92',
  heroLink: '#4DF0A8',
  heroWarn: '#FFA040',
  heroAccent: '#D4FF3A',
};

const oceanLight: Colors = {
  background: '#EFF5FA',
  card: '#FFFFFF',
  foreground: '#0E1B2A',
  muted: '#E3ECF4',
  mutedForeground: '#546579',
  hairline: 'rgba(14,27,42,0.10)',
  primary: '#0B63CE',
  primaryForeground: '#FFFFFF',
  destructive: '#B42318',
  destructiveSoft: '#FDE7E4',
  warning: '#B45309',
  switchOff: '#C9D5E1',
  steps: '#0B63CE',
  stepsSoft: '#DDEBFB',
  stepsText: '#084C9E',
  heart: '#D6304B',
  heartSoft: '#FFE5E9',
  heartText: '#A31F39',
  sleep: '#6757D9',
  sleepSoft: '#ECE9FF',
  sleepText: '#4A3DB0',
  workouts: '#C2700A',
  workoutsSoft: '#FFEFD9',
  workoutsText: '#8A4E00',
  link: '#0C7F60',
  linkSoft: '#DCF4EB',
  linkText: '#086049',
  stageDeep: '#4B3FB8',
  stageRem: '#9A7BE6',
  stageLight: '#B6ACF2',
  stageAwake: '#E2A03A',
  hero: '#0B2A4A',
  heroForeground: '#F2F8FF',
  heroMuted: '#A9C4DE',
  heroTrack: '#1F4A73',
  heroDivider: 'rgba(242,248,255,0.14)',
  heroSteps: '#6CC4FF',
  heroHeart: '#FF9BAC',
  heroLink: '#6EE7B7',
  heroWarn: '#FFC266',
  heroAccent: '#6CC4FF',
};

const oceanDark: Colors = {
  background: '#08121D',
  card: '#102030',
  foreground: '#E8F1FA',
  muted: '#1A2D42',
  mutedForeground: '#8FA7BE',
  hairline: 'rgba(232,241,250,0.10)',
  primary: '#5AB0FF',
  primaryForeground: '#04192E',
  destructive: '#FF8A80',
  destructiveSoft: '#41201E',
  warning: '#F0A23C',
  switchOff: '#33475C',
  steps: '#5AB0FF',
  stepsSoft: '#112F4C',
  stepsText: '#7CC2FF',
  heart: '#FF7B93',
  heartSoft: '#42202B',
  heartText: '#FF8FA4',
  sleep: '#9A8DFF',
  sleepSoft: '#262551',
  sleepText: '#AFA5FF',
  workouts: '#F0A23C',
  workoutsSoft: '#41300F',
  workoutsText: '#F0A23C',
  link: '#4FD6A8',
  linkSoft: '#0F3329',
  linkText: '#4FD6A8',
  stageDeep: '#5A4FD0',
  stageRem: '#BBA2F7',
  stageLight: '#9A8DFF',
  stageAwake: '#F0A23C',
  hero: '#0F2D4A',
  heroForeground: '#F2F8FF',
  heroMuted: '#A9C4DE',
  heroTrack: '#1F4A73',
  heroDivider: 'rgba(242,248,255,0.14)',
  heroSteps: '#6CC4FF',
  heroHeart: '#FF9BAC',
  heroLink: '#6EE7B7',
  heroWarn: '#FFC266',
  heroAccent: '#6CC4FF',
};

const classicType: Typography = {
  fonts: { regular: PLUS_JAKARTA.w500, medium: PLUS_JAKARTA.w600, bold: PLUS_JAKARTA.w700, heavy: PLUS_JAKARTA.w800 },
  numeral: {
    hero: { size: 56, line: 60, tracking: -1.5, unit: 15 },
    lg: { size: 32, line: 38, tracking: -0.5, unit: 14 },
    md: { size: 24, line: 30, tracking: -0.3, unit: 13 },
    sm: { size: 18, line: 24, tracking: 0, unit: 12 },
  },
  title: { size: 28, line: 34, tracking: -0.5 },
};

/** Every role one weight heavier (the app only bundles 500 to 800), and numerals about 12% bigger with tighter tracking. */
const sportType: Typography = {
  fonts: { regular: PLUS_JAKARTA.w600, medium: PLUS_JAKARTA.w700, bold: PLUS_JAKARTA.w800, heavy: PLUS_JAKARTA.w800 },
  numeral: {
    hero: { size: 64, line: 66, tracking: -3, unit: 16 },
    lg: { size: 36, line: 40, tracking: -1.2, unit: 14 },
    md: { size: 26, line: 30, tracking: -0.8, unit: 13 },
    sm: { size: 19, line: 24, tracking: -0.3, unit: 12 },
  },
  title: { size: 30, line: 34, tracking: -1 },
};

export const THEMES: readonly Theme[] = [
  {
    id: 'classic',
    name: 'Classic',
    tagline: 'Warm paper and ink teal. Follows the phone.',
    appearance: 'system',
    palettes: { light: classicLight, dark: classicDark },
    radius: { card: 24, tile: 18, input: 14, control: 999 },
    type: classicType,
  },
  {
    id: 'sport',
    name: 'Sport',
    tagline: 'Black and volt, bold numbers. Always dark.',
    appearance: 'dark',
    palettes: { light: sportDark, dark: sportDark },
    radius: { card: 12, tile: 10, input: 8, control: 8 },
    type: sportType,
  },
  {
    id: 'ocean',
    name: 'Ocean',
    tagline: 'Clean blue and white. Follows the phone.',
    appearance: 'system',
    palettes: { light: oceanLight, dark: oceanDark },
    radius: { card: 20, tile: 16, input: 12, control: 999 },
    type: classicType,
  },
];

export const DEFAULT_THEME_ID: ThemeId = 'classic';

export function getTheme(id: ThemeId): Theme {
  return THEMES.find((theme) => theme.id === id) ?? THEMES[0];
}

/** A stored value back to a theme id; anything unknown (an old or removed theme) is the default. */
export function parseThemeId(value: string | null | undefined): ThemeId {
  return THEMES.find((theme) => theme.id === value)?.id ?? DEFAULT_THEME_ID;
}

/** The light/dark the theme is drawn in, given what the phone reports. */
export function resolveScheme(theme: Theme, system: Scheme): Scheme {
  return theme.appearance === 'system' ? system : theme.appearance;
}
