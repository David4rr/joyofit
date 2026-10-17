import { StyleSheet, View } from 'react-native';

import type { FamilyWatchingItem } from '@/cloud/family';
import { AppText } from '@/components/AppText';
import { IconChip } from '@/components/IconChip';
import { PressableScale } from '@/components/PressableScale';
import { Card } from '@/components/Screen';
import { ChipBadge } from '@/features/family/ChipBadge';
import { dataAtText, isLive, pauseText, restingHrText, sleepText, stepsText } from '@/features/family/format';
import { useNow } from '@/hooks/useNow';
import { spacing } from '@/theme';

interface PersonCardProps {
  item: FamilyWatchingItem;
  onPress: () => void;
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.stat}>
      <AppText variant="bodyStrong" numberOfLines={1} adjustsFontSizeToFit>
        {value}
      </AppText>
      <AppText variant="caption" muted>
        {label}
      </AppText>
    </View>
  );
}

/** One watched person on the dashboard: the chip, when the data is from, and today's numbers they agreed to share. */
export function PersonCard({ item, onPress }: PersonCardProps) {
  const nowMs = useNow(60_000);
  const live = isLive(item);
  const paused = pauseText(item.pausedUntil, nowMs);
  const note =
    item.status === 'pending'
      ? `Menunggu ${item.otherName} menyetujui.`
      : item.frozen
        ? 'Di atas batas akun gratis, jadi tidak diperbarui. Satu orang yang dipantau tetap aktif.'
        : paused;

  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel={`${item.label}, ${item.otherName}`}
      onPress={onPress}
      scaleTo={0.985}>
      <Card>
        <View style={styles.head}>
          <IconChip icon="person" tint="link" />
          <View style={styles.name}>
            <AppText variant="heading" numberOfLines={1}>
              {item.label}
            </AppText>
            <AppText variant="caption" muted numberOfLines={1}>
              {item.otherName}
            </AppText>
          </View>
          {live && !paused ? <ChipBadge chip={item.chip} /> : null}
        </View>
        {note ? (
          <AppText variant="caption" muted>
            {note}
          </AppText>
        ) : null}
        {live && !paused ? (
          <>
            <AppText variant="caption" muted>
              {dataAtText(item.dataAt, nowMs)}
            </AppText>
            {item.today ? (
              <View style={styles.stats}>
                {item.scopes.steps ? <Stat label="Langkah" value={stepsText(item.today.steps)} /> : null}
                {item.scopes.restingHr ? <Stat label="Detak istirahat" value={restingHrText(item.today.restingHr, item.baselineHr)} /> : null}
                {item.scopes.sleep ? <Stat label="Tidur semalam" value={sleepText(item.today.sleepMin)} /> : null}
              </View>
            ) : null}
          </>
        ) : null}
      </Card>
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  name: { flex: 1 },
  stats: { flexDirection: 'row', gap: spacing.md, paddingTop: spacing.xs },
  stat: { flex: 1, gap: 0 },
});
