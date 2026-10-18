import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { spacing, tintColors, useTheme, type Tint } from '@/theme';

/** A small read-only label and value on a soft fill: a workout figure or a member's score. */
export function StatPill({ label, value, tint }: { label: string; value: string; tint?: Tint }) {
  const { colors, radius } = useTheme();
  const scheme = tint ? tintColors(colors, tint) : null;
  return (
    <View
      accessible
      accessibilityLabel={`${label}: ${value}`}
      style={[styles.pill, { backgroundColor: scheme?.soft ?? colors.muted, borderRadius: radius.control }]}>
      <AppText variant="caption" color={scheme?.text} muted={!scheme}>
        {label}
      </AppText>
      <AppText variant="label" color={scheme?.text}>
        {value}
      </AppText>
    </View>
  );
}

/** Pills in a wrapping row. */
export function PillRow({ children }: { children: ReactNode }) {
  return <View style={styles.row}>{children}</View>;
}

const styles = StyleSheet.create({
  pill: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs + 2, paddingHorizontal: spacing.md, paddingVertical: 6 },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
});
