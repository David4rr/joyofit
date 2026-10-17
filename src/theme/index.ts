import { Platform } from 'react-native';

import type { Colors, Tint } from './themes';

export { ThemeProvider, useTheme, useColors } from './ThemeProvider';
export { DEFAULT_THEME_ID, resolveScheme, THEMES } from './themes';
export type { Colors, Scheme, Theme, ThemeId, Tint } from './themes';

/** Base (icons, chart fills), soft (chip and tile background) and text (AA on soft) of one data color. */
export function tintColors(colors: Colors, tint: Tint): { base: string; soft: string; text: string } {
  return {
    base: colors[tint],
    soft: colors[`${tint}Soft`],
    text: colors[`${tint}Text`],
  };
}

/**
 * Colors drawn over photos and exported images (share card, sticker backdrop). The same in every
 * theme on purpose: they sit on arbitrary pictures, not on a themed surface.
 */
export const overlay = {
  scrim: 'rgba(0,0,0,0.5)',
  /** Gradient stops over a photo; opacity is set per stop. */
  scrimInk: '#000000',
  halo: 'rgba(0,0,0,0.35)',
  chip: 'rgba(0,0,0,0.38)',
  textShadow: 'rgba(0,0,0,0.5)',
  ink: '#FFFFFF',
  inkSoft: 'rgba(242,247,248,0.86)',
  checkerDark: '#1A1D1B',
  checkerLight: '#2A2F2C',
} as const;

/** Page padding 20, related cards 12 apart, sections 28 apart, card padding 20. */
export const spacing = { xs: 4, sm: 8, md: 12, lg: 20, xl: 28, xxl: 40 } as const;

/** Radii that no theme changes: bars, tracks and dots are always round. Card, tile, input and control radii come from `useTheme().radius`. */
export const radius = { pill: 999 } as const;

export const fontSize = {
  xs: 12,
  sm: 13,
  base: 15,
  md: 16,
  lg: 18,
  xl: 20,
  '2xl': 24,
} as const;

export const monoFont = Platform.select({ android: 'monospace', default: 'Courier' });

/** Smallest touch target, in dp. */
export const HIT = 48;
