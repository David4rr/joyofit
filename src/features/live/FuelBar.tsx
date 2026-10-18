import { StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { AppText } from '@/components/AppText';
import { Metric } from '@/components/Metric';
import { fmtInt } from '@/i18n';
import { formatGrams } from '@/features/live/liveWorkout';
import { spacing, useColors } from '@/theme';

/** One big gram figure: `Fat 12.4 g`. */
export function BurnFigure({ label, grams, color }: { label: string; grams: number; color: string }) {
  const { t } = useTranslation('sharing');
  return (
    <View style={styles.figure} accessible accessibilityLabel={t('live.burned.figureA11y', { label, value: formatGrams(grams) })}>
      <AppText variant="label" color={color}>
        {label}
      </AppText>
      <Metric value={formatGrams(grams)} unit="g" size="md" color={color} unitColor={color} />
    </View>
  );
}

/** The fat and carbohydrate shares of the energy, as a bar and a sentence. */
export function FuelBar({ fatShare }: { fatShare: number | null }) {
  const colors = useColors();
  const { t } = useTranslation('sharing');
  if (fatShare === null) return null;
  const fatPct = Math.round(fatShare * 100);
  return (
    <View style={styles.fuel}>
      <View style={[styles.track, { backgroundColor: colors.stepsSoft }]}>
        <View style={[styles.fat, { width: `${fatPct}%`, backgroundColor: colors.workouts }]} />
      </View>
      <AppText variant="caption" muted>
        {t('live.burned.fuel', { fat: fmtInt(fatPct), carbs: fmtInt(100 - fatPct) })}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  figure: { flex: 1, gap: 2 },
  fuel: { gap: spacing.xs },
  track: { height: 10, borderRadius: 5, overflow: 'hidden' },
  fat: { height: '100%' },
});
