import { useTranslation } from 'react-i18next';
import { Animated, StyleSheet, View } from 'react-native';

import { useToggleMix } from '@/components/motion';
import { PressableScale } from '@/components/PressableScale';
import { dayInitials, dayName } from '@/features/alarms/alarmUtils';
import { fontSize, HIT, useTheme } from '@/theme';
import { ALARM_DAYS } from '@/wear';

interface DayChipsProps {
  /** Bitmask of `ALARM_DAYS`. */
  value: number;
  onChange: (value: number) => void;
}

/** Seven round weekday toggles; each sits in a 48 dp tall hit row. */
export function DayChips({ value, onChange }: DayChipsProps) {
  // Names come from the active language; subscribing re-renders them on a switch.
  useTranslation('watch');
  return (
    <View style={styles.row}>
      {ALARM_DAYS.map((day) => {
        const selected = (value & day.bit) !== 0;
        return (
          <DayChip key={day.bit} label={dayName(day.bit)} initials={dayInitials(day.bit)} selected={selected} onPress={() => onChange(selected ? value & ~day.bit : value | day.bit)} />
        );
      })}
    </View>
  );
}

function DayChip({ label, initials, selected, onPress }: { label: string; initials: string; selected: boolean; onPress: () => void }) {
  const { colors, fonts } = useTheme();
  const mix = useToggleMix(selected);
  return (
    <PressableScale accessibilityRole="checkbox" accessibilityLabel={label} accessibilityState={{ checked: selected }} onPress={onPress} style={styles.hit}>
      <Animated.View style={[styles.chip, { backgroundColor: mix.interpolate({ inputRange: [0, 1], outputRange: [colors.muted, colors.primary] }) }]}>
        <Animated.Text
          style={{
            fontFamily: fonts.medium,
            fontSize: fontSize.sm,
            lineHeight: 18,
            color: mix.interpolate({ inputRange: [0, 1], outputRange: [colors.foreground, colors.primaryForeground] }),
          }}>
          {initials}
        </Animated.Text>
      </Animated.View>
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row' },
  hit: { flex: 1, minHeight: HIT, alignItems: 'center', justifyContent: 'center' },
  chip: {
    width: '100%',
    maxWidth: 40,
    aspectRatio: 1,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
