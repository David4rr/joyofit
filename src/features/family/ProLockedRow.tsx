import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { PressableScale } from '@/components/PressableScale';
import { HIT, spacing, tintColors, useColors } from '@/theme';

interface ProLockedRowProps {
  label: string;
  hint?: string;
  /** Opens the Pro offer. */
  onPress: () => void;
}

/** A setting a free account cannot change: the label, a Pro badge, and a tap that explains. It shows no switch, because the rule is not running. */
export function ProLockedRow({ label, hint, onPress }: ProLockedRowProps) {
  const colors = useColors();
  const badge = tintColors(colors, 'workouts');
  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel={`${label}. Untuk Pro`}
      onPress={onPress}
      scaleTo={0.985}
      style={styles.row}>
      <View style={styles.text}>
        <AppText variant="bodyStrong" muted>
          {label}
        </AppText>
        {hint ? (
          <AppText variant="caption" muted>
            {hint}
          </AppText>
        ) : null}
      </View>
      <View style={[styles.badge, { backgroundColor: badge.soft }]}>
        <Ionicons name="lock-closed" size={12} color={badge.text} />
        <AppText variant="label" color={badge.text}>
          Pro
        </AppText>
      </View>
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, minHeight: HIT },
  text: { flex: 1, gap: 1 },
  badge: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, paddingHorizontal: spacing.md, paddingVertical: spacing.xs + 1, borderRadius: 999 },
});
