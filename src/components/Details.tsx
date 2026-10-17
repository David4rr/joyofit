import { Ionicons } from '@expo/vector-icons';
import { useState, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { PressableScale } from '@/components/PressableScale';
import { spacing, useColors } from '@/theme';

interface DetailsProps {
  /** Collapsed label; "Details" unless the content needs a clearer name, e.g. "How is this calculated?". */
  title?: string;
  /** Plain strings render as muted captions; pass elements for anything richer. */
  children: ReactNode;
}

function isPlainText(node: ReactNode): boolean {
  const parts = Array.isArray(node) ? node : [node];
  return parts.every((p) => typeof p === 'string' || typeof p === 'number');
}

/** Collapsed-by-default disclosure for explanations, disclaimers and "how it works" text, so the data stays on one screen. */
export function Details({ title = 'Details', children }: DetailsProps) {
  const colors = useColors();
  const [open, setOpen] = useState(false);
  return (
    <View style={styles.wrap}>
      <PressableScale
        accessibilityRole="button"
        accessibilityLabel={title}
        accessibilityState={{ expanded: open }}
        hitSlop={8}
        scaleTo={0.99}
        onPress={() => setOpen((v) => !v)}
        style={styles.header}>
        <AppText variant="caption" muted>
          {title}
        </AppText>
        <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={14} color={colors.mutedForeground} />
      </PressableScale>
      {open ? <View style={styles.body}>{isPlainText(children) ? (
            <AppText variant="caption" muted>
              {children}
            </AppText>
          ) : (
            children
          )}</View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.xs },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, minHeight: 24, alignSelf: 'flex-start' },
  body: { gap: spacing.xs },
});
