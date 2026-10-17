import { Ionicons } from '@expo/vector-icons';
import { useEventListener } from 'expo';
import { useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { FadeIn, PopIn } from '@/components/motion';
import { Card } from '@/components/Screen';
import { LoadingState, Notice } from '@/components/States';
import { isLinkUp } from '@/features/device/linkState';
import { Bullet, StepIntro } from '@/features/onboarding/StepIntro';
import { Pair, PairGrid } from '@/features/settings/PairGrid';
import { formatCount, formatDistance } from '@/format';
import { useWatch } from '@/state/WatchProvider';
import { spacing, useColors } from '@/theme';
import { HuaweiWear, type SyncSummary } from '@/wear';

/**
 * The first history pull. It starts by itself once the link is up (the same `sync` the Today tab uses), shows that it is running, and
 * lists what came in. The native sync reports no percentage, so this says what it is doing instead of drawing a bar it cannot fill.
 */
export function SyncStep() {
  const watch = useWatch();
  const [summary, setSummary] = useState<SyncSummary | null>(null);
  const started = useRef(false);
  const linked = isLinkUp(watch.linkState);
  const syncing = watch.linkState === 'syncing';

  useEventListener(HuaweiWear, 'onSyncComplete', setSummary);

  // Wait for the device info too: a sync asked before `device` is set does nothing and would not be asked again.
  const { device, linkState, sync } = watch;
  useEffect(() => {
    if (started.current || !device || linkState !== 'connected') return;
    started.current = true;
    void sync();
  }, [device, linkState, sync]);

  return (
    <>
      <StepIntro icon="sync" tint="steps" title="Read your history from the watch">
        JoyoFit now pulls what the watch has stored: steps, heart rate, sleep and workouts. It is saved on this phone.
      </StepIntro>
      {!linked ? (
        <Notice tone="danger" icon="bluetooth">
          The watch is not connected. Go back to connect it, or choose Later and sync from the Watch tab any time.
        </Notice>
      ) : null}
      {syncing ? (
        <Card>
          <LoadingState label="Reading from the watch..." />
          <AppText variant="caption" muted>
            The first sync collects everything the watch still holds, so it can take a few minutes. Keep the watch close and awake.
          </AppText>
        </Card>
      ) : null}
      {watch.error ? (
        <Notice tone="danger" action={linked ? { label: 'Try again', onPress: () => void watch.sync() } : undefined}>
          {watch.error}
        </Notice>
      ) : null}
      {!syncing && summary ? <Result summary={summary} /> : null}
      {linked && !syncing && !summary && !watch.error ? (
        <Button label="Sync now" variant="primary" icon="sync" onPress={() => void watch.sync()} />
      ) : null}
    </>
  );
}

function Result({ summary }: { summary: SyncSummary }) {
  const colors = useColors();
  const { totals } = summary;
  return (
    <FadeIn style={styles.result}>
      <Card>
        <View style={styles.resultHead}>
          <PopIn>
            <Ionicons name="checkmark-circle" size={20} color={colors.link} />
          </PopIn>
          <AppText variant="heading">What came in</AppText>
        </View>
        <PairGrid>
          <Pair label="Activity samples" value={formatCount(summary.samples)} />
          <Pair label="Sleep segments" value={formatCount(summary.sleep)} />
          <Pair label="Workouts" value={formatCount(summary.workouts)} />
          <Pair label="Steps today" value={formatCount(totals.steps)} />
          <Pair label="Calories today" value={`${formatCount(totals.calories)} kcal`} />
          <Pair label="Distance today" value={formatDistance(totals.distance)} />
        </PairGrid>
      </Card>
      <View style={styles.notes}>
        <Bullet label={'\u2022'}>Steps, heart rate and sleep appear on Today. Workouts are in the Workouts tab.</Bullet>
        <Bullet label={'\u2022'}>
          A watch only keeps a limited stretch of history. Older days are not on it; the Huawei Health import from the first step is
          how they come back.
        </Bullet>
        <Bullet label={'\u2022'}>Zeros are normal on a brand new or freshly reset watch. Wear it and sync again later.</Bullet>
      </View>
    </FadeIn>
  );
}

const styles = StyleSheet.create({
  notes: { gap: spacing.sm },
  result: { gap: spacing.lg },
  resultHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
});
