import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Details } from '@/components/Details';
import { PressableScale } from '@/components/PressableScale';
import { Section } from '@/components/Screen';
import { resolveScheme, spacing, THEMES, useTheme, type Scheme, type Theme } from '@/theme';

const DATA_TINTS = ['steps', 'heart', 'sleep', 'workouts', 'link'] as const;

/** A miniature screen in the theme's own colors: canvas, card with a title, the five data colors, the primary button. */
function ThemeSwatch({ theme, systemScheme }: { theme: Theme; systemScheme: Scheme }) {
  const p = theme.palettes[resolveScheme(theme, systemScheme)];
  const control = theme.radius.control >= 999 ? 5 : 2;
  return (
    <View
      accessible={false}
      importantForAccessibility="no-hide-descendants"
      style={[
        styles.swatch,
        { backgroundColor: p.background, borderColor: p.hairline, borderRadius: Math.min(theme.radius.card, 16) },
      ]}>
      <View style={[styles.swatchCard, { backgroundColor: p.card, borderRadius: Math.min(theme.radius.tile, 10) }]}>
        <View style={[styles.swatchTitle, { backgroundColor: p.foreground }]} />
        <View style={[styles.swatchLine, { backgroundColor: p.mutedForeground }]} />
        <View style={styles.swatchDots}>
          {DATA_TINTS.map((tint) => (
            <View key={tint} style={[styles.swatchDot, { backgroundColor: p[tint] }]} />
          ))}
        </View>
      </View>
      <View style={[styles.swatchButton, { backgroundColor: p.primary, borderRadius: control }]} />
    </View>
  );
}

/** Theme picker: one row per theme with a preview swatch. The choice applies at once and is remembered. */
export function AppearanceSection() {
  const { t } = useTranslation(['settings', 'common']);
  const { theme: active, systemScheme, colors, setThemeId } = useTheme();
  return (
    <Section title={t('appearance.title')} icon="color-palette">
      <View style={styles.list} accessibilityRole="radiogroup">
        {THEMES.map((theme) => {
          const selected = theme.id === active.id;
          return (
            <PressableScale
              key={theme.id}
              accessibilityRole="radio"
              accessibilityLabel={`${t(`common:theme.${theme.id}.name`)}. ${t(`common:theme.${theme.id}.tagline`)}`}
              accessibilityState={{ selected }}
              scaleTo={0.985}
              onPress={() => setThemeId(theme.id)}
              style={[
                styles.row,
                {
                  backgroundColor: colors.muted,
                  borderColor: selected ? colors.primary : 'transparent',
                  borderRadius: active.radius.tile,
                },
              ]}>
              <ThemeSwatch theme={theme} systemScheme={systemScheme} />
              <View style={styles.text}>
                <AppText variant="bodyStrong">{t(`common:theme.${theme.id}.name`)}</AppText>
                <AppText variant="caption" muted>
                  {t(`common:theme.${theme.id}.tagline`)}
                </AppText>
              </View>
              <Ionicons
                name={selected ? 'checkmark-circle' : 'ellipse-outline'}
                size={24}
                color={selected ? colors.primary : colors.mutedForeground}
              />
            </PressableScale>
          );
        })}
      </View>
      <Details title={t('appearance.aboutTitle')}>{t('appearance.details')}</Details>
    </Section>
  );
}

const styles = StyleSheet.create({
  list: { gap: spacing.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.sm + 2, borderWidth: 2, minHeight: 84 },
  text: { flex: 1, gap: 2 },
  swatch: { width: 84, height: 64, padding: 6, gap: 4, borderWidth: StyleSheet.hairlineWidth },
  swatchCard: { flex: 1, padding: 5, gap: 3 },
  swatchTitle: { height: 6, width: '55%', borderRadius: 3 },
  swatchLine: { height: 4, width: '80%', borderRadius: 2, opacity: 0.7 },
  swatchDots: { flexDirection: 'row', gap: 3, marginTop: 'auto' },
  swatchDot: { width: 8, height: 8, borderRadius: 4 },
  swatchButton: { height: 8 },
});
