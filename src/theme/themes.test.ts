import { describe, expect, test } from 'bun:test';

import { DEFAULT_THEME_ID, getTheme, parseThemeId, resolveScheme, THEMES, type Colors, type Tint } from './themes';

/** WCAG relative luminance of a `#RRGGBB` color. */
function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const channel = parseInt(hex.slice(i, i + 2), 16) / 255;
    return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const TINTS: readonly Tint[] = ['steps', 'heart', 'sleep', 'workouts', 'link'];

const palettes = THEMES.flatMap((theme) =>
  (['light', 'dark'] as const).map((scheme) => ({ label: `${theme.id} ${scheme}`, colors: theme.palettes[scheme] })),
);

describe.each(palettes)('contrast: $label', ({ colors }) => {
  test('every *Text passes AA on its soft tint and on card', () => {
    for (const tint of TINTS) {
      expect(contrast(colors[`${tint}Text`], colors[`${tint}Soft`])).toBeGreaterThanOrEqual(4.5);
      expect(contrast(colors[`${tint}Text`], colors.card)).toBeGreaterThanOrEqual(4.5);
    }
  });

  test('base data colors are visible on card and on their soft tint', () => {
    for (const tint of TINTS) {
      expect(contrast(colors[tint], colors.card)).toBeGreaterThanOrEqual(3);
      expect(contrast(colors[tint], colors[`${tint}Soft`])).toBeGreaterThanOrEqual(3);
    }
  });

  test('body and muted text', () => {
    for (const surface of [colors.background, colors.card, colors.muted]) {
      expect(contrast(colors.foreground, surface)).toBeGreaterThanOrEqual(7);
      expect(contrast(colors.mutedForeground, surface)).toBeGreaterThanOrEqual(4.5);
    }
    expect(contrast(colors.primaryForeground, colors.primary)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(colors.destructive, colors.card)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(colors.destructive, colors.destructiveSoft)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(colors.primary, colors.card)).toBeGreaterThanOrEqual(3);
  });

  test('hero panel text and accents', () => {
    expect(contrast(colors.heroForeground, colors.hero)).toBeGreaterThanOrEqual(7);
    for (const key of ['heroMuted', 'heroSteps', 'heroHeart', 'heroLink', 'heroWarn', 'heroAccent'] as const) {
      expect(contrast(colors[key], colors.hero)).toBeGreaterThanOrEqual(4.5);
    }
    expect(contrast(colors.heroTrack, colors.hero)).toBeGreaterThanOrEqual(1.3);
  });

  test('sleep stage bars are visible on card', () => {
    for (const stage of [colors.stageDeep, colors.stageRem, colors.stageLight, colors.stageAwake]) {
      expect(contrast(stage, colors.card)).toBeGreaterThanOrEqual(1.5);
    }
  });

  test('switch off track is visible on card', () => {
    expect(contrast(colors.switchOff, colors.card)).toBeGreaterThanOrEqual(1.4);
  });
});

describe('themes', () => {
  test('ids are unique and every theme defines every token in both palettes', () => {
    expect(new Set(THEMES.map((t) => t.id)).size).toBe(THEMES.length);
    const keys = Object.keys(getTheme(DEFAULT_THEME_ID).palettes.light).sort();
    for (const theme of THEMES) {
      for (const scheme of ['light', 'dark'] as const) {
        const colors: Colors = theme.palettes[scheme];
        expect(Object.keys(colors).sort()).toEqual(keys);
      }
    }
  });

  test('classic is the default and unknown stored ids fall back to it', () => {
    expect(DEFAULT_THEME_ID).toBe('classic');
    expect(parseThemeId('sport')).toBe('sport');
    expect(parseThemeId('neon')).toBe('classic');
    expect(parseThemeId(null)).toBe('classic');
  });

  test('pinned themes ignore the phone scheme, system themes follow it', () => {
    expect(resolveScheme(getTheme('sport'), 'light')).toBe('dark');
    expect(resolveScheme(getTheme('classic'), 'light')).toBe('light');
    expect(resolveScheme(getTheme('classic'), 'dark')).toBe('dark');
    expect(resolveScheme(getTheme('ocean'), 'dark')).toBe('dark');
  });

  test('sport is tighter and heavier than classic', () => {
    const classic = getTheme('classic');
    const sport = getTheme('sport');
    expect(sport.radius.card).toBeLessThan(classic.radius.card);
    expect(sport.type.numeral.hero.size).toBeGreaterThan(classic.type.numeral.hero.size);
    expect(sport.type.fonts.regular).not.toBe(classic.type.fonts.regular);
  });
});
