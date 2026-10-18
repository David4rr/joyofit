import { Animated, StyleSheet, type AccessibilityRole } from 'react-native';

import { useToggleMix } from '@/components/motion';
import { PressableScale } from '@/components/PressableScale';
import { fontSize, useTheme } from '@/theme';

interface ChipProps {
  label: string;
  selected: boolean;
  onPress: () => void;
  role?: AccessibilityRole;
}

/** Pill filter. 40 dp tall plus 4 dp of slop above and below makes the 48 dp target. Fill and label change color over 160 ms. */
export function Chip({ label, selected, onPress, role = 'button' }: ChipProps) {
  const { colors, fonts, radius } = useTheme();
  const mix = useToggleMix(selected);
  return (
    <PressableScale
      accessibilityRole={role}
      accessibilityLabel={label}
      accessibilityState={role === 'checkbox' ? { checked: selected } : { selected }}
      hitSlop={{ top: 4, bottom: 4 }}
      onPress={onPress}
      scaleTo={0.96}
      style={[styles.chip, { borderRadius: radius.control }]}>
      <Animated.View
        pointerEvents="none"
        style={[StyleSheet.absoluteFill, { backgroundColor: mix.interpolate({ inputRange: [0, 1], outputRange: [colors.muted, colors.foreground] }) }]}
      />
      <Animated.Text
        style={[styles.label, { color: mix.interpolate({ inputRange: [0, 1], outputRange: [colors.foreground, colors.background] }), fontFamily: fonts.medium }]}>
        {label}
      </Animated.Text>
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  chip: {
    minHeight: 40,
    paddingHorizontal: 16,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  label: { fontSize: fontSize.sm },
});
