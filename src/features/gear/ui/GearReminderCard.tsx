import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { IconChip } from '@/components/IconChip';
import { fmtInt } from '@/i18n';
import { spacing, useTheme } from '@/theme';
import { gearWhat } from '../format';
import { gearReminder, type Gear } from '../model';

interface Props {
  gear: Gear;
  /** Lifetime distance, starting distance included. */
  distanceM: number;
  onDismiss: () => void;
}

/** "Sepatu kamu sudah 650 km, ..." with a "Nanti saja" button. Renders nothing when the gear has no reminder now. */
export function GearReminderCard({ gear, distanceM, onDismiss }: Props) {
  const { t } = useTranslation('gear');
  const { colors, radius } = useTheme();
  const reminder = gearReminder(gear, distanceM);
  if (!reminder) return null;
  const text = t(reminder.level === 2 ? 'reminder.reached' : 'reminder.near', {
    what: gearWhat(gear),
    km: fmtInt(reminder.km),
    limit: fmtInt(reminder.retireKm),
  });
  return (
    <View style={[styles.box, { backgroundColor: colors.muted, borderRadius: radius.input }]} accessibilityRole="alert">
      <View style={styles.row}>
        <IconChip icon={reminder.level === 2 ? 'alert-circle' : 'warning'} tint="heart" size="sm" />
        <AppText variant="caption" style={styles.text}>
          {text}
        </AppText>
      </View>
      <Button label={t('reminder.dismiss')} variant="ghost" onPress={onDismiss} />
    </View>
  );
}

const styles = StyleSheet.create({
  box: { padding: spacing.md, gap: spacing.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  text: { flex: 1 },
});
