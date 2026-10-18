import { Children, cloneElement, isValidElement, type ReactElement, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { spacing } from '@/theme';

/** Buttons side by side, sharing the width equally; saves a full-width row per extra action. */
export function ButtonRow({ children }: { children: ReactNode }) {
  return (
    <View style={styles.row}>
      {Children.map(children, (child) =>
        isValidElement(child) ? cloneElement(child as ReactElement<{ style?: unknown }>, { style: styles.cell }) : child,
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: spacing.sm },
  cell: { flex: 1, paddingHorizontal: spacing.md },
});
