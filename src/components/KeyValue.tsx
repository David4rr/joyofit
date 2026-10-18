import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import type { IconName } from '@/components/IconChip';
import { spacing, useTheme } from '@/theme';

interface KeyValueProps {
  label: string;
  value: string | null;
  icon?: IconName;
}

/** Label/value row; a missing value renders as an em dash instead of being hidden. */
export function KeyValue({ label, value, icon }: KeyValueProps) {
  const { colors, fonts } = useTheme();
  return (
    <View style={styles.row}>
      {icon ? <Ionicons name={icon} size={18} color={colors.mutedForeground} /> : null}
      <AppText variant="caption" muted style={styles.label}>
        {label}
      </AppText>
      <AppText variant="caption" selectable style={[styles.value, { fontFamily: fonts.medium }]}>
        {value ?? '\u2014'}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: 26 },
  label: { flexShrink: 0 },
  value: {
    flex: 1,
    textAlign: 'right',
    fontVariant: ['tabular-nums'],
  },
});
