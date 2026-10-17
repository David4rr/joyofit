import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { IconChip, type IconName } from '@/components/IconChip';
import { spacing, type Tint } from '@/theme';

interface StepIntroProps {
  icon: IconName;
  tint?: Tint | 'neutral';
  title: string;
  /** Optional label next to the title, e.g. "Optional". */
  badge?: string;
  children: ReactNode;
}

/** The heading block every step starts with: icon, title and what this step is for. */
export function StepIntro({ icon, tint, title, badge, children }: StepIntroProps) {
  return (
    <View style={styles.wrap}>
      <IconChip icon={icon} tint={tint} size="lg" />
      <AppText variant="title" accessibilityRole="header">
        {title}
      </AppText>
      {badge ? (
        <AppText variant="label" muted>
          {badge}
        </AppText>
      ) : null}
      <AppText variant="body" muted>
        {children}
      </AppText>
    </View>
  );
}

/** A short list of facts or steps, one line of text each, numbered or bulleted by the caller's label. */
export function Bullet({ label, children }: { label: string; children: ReactNode }) {
  return (
    <View style={styles.bullet}>
      <AppText variant="label" style={styles.bulletLabel}>
        {label}
      </AppText>
      <AppText variant="caption" style={styles.bulletText}>
        {children}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.sm },
  bullet: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  bulletLabel: { width: 18, textAlign: 'center' },
  bulletText: { flex: 1 },
});
