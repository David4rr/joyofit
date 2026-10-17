import { StyleSheet, Text, type AccessibilityRole } from 'react-native';

import { PressableScale } from '@/components/PressableScale';
import { fontSize, useTheme } from '@/theme';

interface ChipProps {
  label: string;
  selected: boolean;
  onPress: () => void;
  role?: AccessibilityRole;
}

/** Pill filter. 40 dp tall plus 4 dp of slop above and below makes the 48 dp target. */
export function Chip({ label, selected, onPress, role = 'button' }: ChipProps) {
  const { colors, fonts, radius } = useTheme();
  return (
    <PressableScale
      accessibilityRole={role}
      accessibilityLabel={label}
      accessibilityState={role === 'checkbox' ? { checked: selected } : { selected }}
      hitSlop={{ top: 4, bottom: 4 }}
      onPress={onPress}
      scaleTo={0.96}
      style={[styles.chip, { backgroundColor: selected ? colors.foreground : colors.muted, borderRadius: radius.control }]}>
      <Text style={[styles.label, { color: selected ? colors.background : colors.foreground, fontFamily: fonts.medium }]}>
        {label}
      </Text>
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  chip: {
    minHeight: 40,
    paddingHorizontal: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: { fontSize: fontSize.sm },
});
