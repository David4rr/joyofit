import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { radius, spacing, useColors } from '@/theme';

interface StepProgressProps {
  /** 1-based position of the step on screen. */
  index: number;
  total: number;
}

/** "Step 3 of 10" over a bar that fills as the guide goes on. */
export function StepProgress({ index, total }: StepProgressProps) {
  const colors = useColors();
  return (
    <View style={styles.wrap}>
      <AppText variant="label" muted>
        Step {index} of {total}
      </AppText>
      <View
        accessibilityRole="progressbar"
        accessibilityLabel="Setup progress"
        accessibilityValue={{ min: 1, max: total, now: index }}
        style={[styles.track, { backgroundColor: colors.muted }]}>
        <View style={[styles.fill, { backgroundColor: colors.primary, width: `${(index / total) * 100}%` }]} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.sm },
  track: { height: 6, borderRadius: radius.pill, overflow: 'hidden' },
  fill: { height: 6, borderRadius: radius.pill },
});
