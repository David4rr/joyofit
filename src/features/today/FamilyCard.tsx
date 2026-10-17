import { useRouter } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { IconChip } from '@/components/IconChip';
import { NavRow } from '@/components/NavRow';
import { PressableScale } from '@/components/PressableScale';
import { Card } from '@/components/Screen';
import { ChipBadge } from '@/features/family/ChipBadge';
import { useFamily } from '@/features/family/FamilyProvider';
import { familyCardLine, worstChip } from '@/features/family/format';
import { spacing } from '@/theme';

/**
 * Family monitoring on Today. With people watched it is a compact card: the worst chip among them and who has it, and a tap
 * opens the dashboard. Otherwise a signed-in account gets one quiet line to start. Nothing at all while signed out or before the links are read.
 */
export function FamilyCard() {
  const router = useRouter();
  const { available, loading, error, watching, limits } = useFamily();
  if (!available || loading || (error !== null && limits === null)) return null;

  if (watching.length === 0) {
    return (
      <Card>
        <NavRow icon="people" tint="link" title="Pantau kabar keluarga" onPress={() => router.push('/family')} />
      </Card>
    );
  }

  const worst = worstChip(watching);
  return (
    <PressableScale accessibilityRole="button" accessibilityLabel="Keluarga" onPress={() => router.push('/family')} scaleTo={0.985}>
      <Card style={styles.card}>
        <IconChip icon="people" tint="link" />
        <View style={styles.text}>
          <AppText variant="bodyStrong">Keluarga</AppText>
          <AppText variant="caption" muted numberOfLines={1}>
            {familyCardLine(watching)}
          </AppText>
        </View>
        {worst ? <ChipBadge chip={worst} /> : null}
      </Card>
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  card: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  text: { flex: 1 },
});
