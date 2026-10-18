import { Ionicons } from '@expo/vector-icons';
import { Animated, type ColorValue } from 'react-native';

import type { IconName } from '@/components/IconChip';
import { useBump } from '@/components/motion';

interface TabIconProps {
  /** Glyph for the current tab and for the others. */
  on: IconName;
  off: IconName;
  focused: boolean;
  color: ColorValue;
  size: number;
}

/** Tab bar icon: filled when the tab is current, with a small pop (about 250 ms) when it becomes current. */
export function TabIcon({ on, off, focused, color, size }: TabIconProps) {
  const scale = useBump(focused, focused);
  return (
    <Animated.View style={{ transform: [{ scale }] }}>
      <Ionicons name={focused ? on : off} size={size} color={color} />
    </Animated.View>
  );
}
