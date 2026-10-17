import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { spacing } from '@/theme';

/** Two-column grid for short label/value pairs, so a status block takes half the height of a KeyValue list. */
export function PairGrid({ children }: { children: ReactNode }) {
  return <View style={styles.grid}>{children}</View>;
}

interface PairProps {
  label: string;
  value: string | null;
  /** Takes the full row, for values too long for half the width. */
  wide?: boolean;
}

/** Caption label over a value; a missing value renders as an em dash. */
export function Pair({ label, value, wide }: PairProps) {
  return (
    <View style={wide ? styles.wide : styles.half}>
      <AppText variant="caption" muted>
        {label}
      </AppText>
      <AppText variant="label" selectable>
        {value ?? '\u2014'}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', rowGap: spacing.sm, columnGap: spacing.md },
  half: { width: '47%' },
  wide: { width: '100%' },
});
