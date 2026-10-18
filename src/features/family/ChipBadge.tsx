import { StyleSheet, View } from 'react-native';

import type { FamilyChip } from '@/cloud/family';
import { AppText } from '@/components/AppText';
import { chipLabel } from '@/features/family/format';
import { useLocale } from '@/i18n';
import { spacing, tintColors, useColors } from '@/theme';

/** Good (green), needs a check (amber), not synced (grey). The word is the signal; the color only backs it up. */
export function ChipBadge({ chip }: { chip: FamilyChip }) {
  useLocale();
  const colors = useColors();
  const scheme =
    chip === 'ok'
      ? { bg: tintColors(colors, 'link').soft, fg: tintColors(colors, 'link').text }
      : chip === 'check'
        ? { bg: tintColors(colors, 'workouts').soft, fg: tintColors(colors, 'workouts').text }
        : { bg: colors.muted, fg: colors.mutedForeground };
  return (
    <View style={[styles.pill, { backgroundColor: scheme.bg }]}>
      <AppText variant="label" color={scheme.fg}>
        {chipLabel(chip)}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: { paddingHorizontal: spacing.md, paddingVertical: spacing.xs + 1, borderRadius: 999, alignSelf: 'flex-start' },
});
