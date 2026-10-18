import { Ionicons } from '@expo/vector-icons';
import { ActivityIndicator, StyleSheet } from 'react-native';

import type { IconName } from '@/components/IconChip';
import { PressableScale } from '@/components/PressableScale';
import { HIT, useTheme } from '@/theme';

interface MapButtonProps {
  icon: IconName;
  /** What a screen reader says; the glyph has no text. */
  label: string;
  onPress: () => void;
  disabled?: boolean;
  loading?: boolean;
  danger?: boolean;
  /** `floating` sits on the map (card color and a hairline), `sheet` sits on a card (muted fill). */
  surface?: 'floating' | 'sheet';
}

/** A round 48 dp icon button for the map controls. */
export function MapButton({ icon, label, onPress, disabled, loading, danger, surface = 'sheet' }: MapButtonProps) {
  const { colors } = useTheme();
  const inactive = disabled || loading;
  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!inactive, busy: !!loading }}
      disabled={inactive}
      onPress={onPress}
      style={[
        styles.button,
        surface === 'floating'
          ? { backgroundColor: colors.card, borderColor: colors.hairline, borderWidth: StyleSheet.hairlineWidth }
          : { backgroundColor: colors.muted },
      ]}>
      {loading ? (
        <ActivityIndicator size="small" color={colors.foreground} />
      ) : (
        <Ionicons name={icon} size={22} color={danger ? colors.destructive : colors.foreground} />
      )}
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  button: { width: HIT, height: HIT, borderRadius: HIT / 2, alignItems: 'center', justifyContent: 'center' },
});
