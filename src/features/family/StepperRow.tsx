import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { PressableScale } from '@/components/PressableScale';
import { HIT, spacing, useColors } from '@/theme';

interface StepperRowProps {
  label: string;
  /** The current value, worded: `12 jam`, `11.00`. */
  value: string;
  onLess: () => void;
  onMore: () => void;
  canLess?: boolean;
  canMore?: boolean;
  disabled?: boolean;
}

function StepButton({ icon, label, onPress, disabled }: { icon: 'remove' | 'add'; label: string; onPress: () => void; disabled: boolean }) {
  const colors = useColors();
  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={[styles.button, { backgroundColor: colors.muted }]}>
      <Ionicons name={icon} size={20} color={colors.foreground} />
    </PressableScale>
  );
}

/** A label with its value between a minus and a plus: for a number that moves in small steps. */
export function StepperRow({ label, value, onLess, onMore, canLess = true, canMore = true, disabled }: StepperRowProps) {
  const { t } = useTranslation('family');
  return (
    <View style={styles.row}>
      <AppText variant="body" style={styles.label} muted={disabled}>
        {label}
      </AppText>
      <StepButton icon="remove" label={t('rules.less', { label })} onPress={onLess} disabled={!!disabled || !canLess} />
      <AppText variant="bodyStrong" style={styles.value} accessibilityLiveRegion="polite">
        {value}
      </AppText>
      <StepButton icon="add" label={t('rules.more', { label })} onPress={onMore} disabled={!!disabled || !canMore} />
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: HIT },
  label: { flex: 1 },
  value: { minWidth: 64, textAlign: 'center', fontVariant: ['tabular-nums'] },
  button: { width: HIT, height: HIT, borderRadius: HIT / 2, alignItems: 'center', justifyContent: 'center' },
});
