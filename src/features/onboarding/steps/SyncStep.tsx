import { Ionicons } from '@expo/vector-icons';
import { useEventListener } from 'expo';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { FadeIn, PopIn } from '@/components/motion';
import { Card } from '@/components/Screen';
import { LoadingState, Notice } from '@/components/States';
import { isLinkUp } from '@/features/device/linkState';
import { Bullet, StepIntro } from '@/features/onboarding/StepIntro';
import { Pair, PairGrid } from '@/features/settings/PairGrid';
import { fmtDistance, fmtInt } from '@/i18n';
import { useWatch } from '@/state/WatchProvider';
import { spacing, useColors } from '@/theme';
import { HuaweiWear, type SyncSummary } from '@/wear';

/**
 * The first history pull. It starts by itself once the link is up (the same `sync` the Today tab uses), shows that it is running, and
 * lists what came in. The native sync reports no percentage, so this says what it is doing instead of drawing a bar it cannot fill.
 */
export function SyncStep() {
  const { t } = useTranslation(['onboarding', 'common']);
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
      <StepIntro icon="sync" tint="steps" title={t('sync.title')}>
        {t('sync.intro')}
      </StepIntro>
      {!linked ? (
        <Notice tone="danger" icon="bluetooth">
          {t('sync.notConnected')}
        </Notice>
      ) : null}
      {syncing ? (
        <Card>
          <LoadingState label={t('sync.reading')} />
          <AppText variant="caption" muted>
            {t('sync.readingHint')}
          </AppText>
        </Card>
      ) : null}
      {watch.error ? (
        <Notice tone="danger" action={linked ? { label: t('common:actions.retry'), onPress: () => void watch.sync() } : undefined}>
          {watch.error}
        </Notice>
      ) : null}
      {!syncing && summary ? <Result summary={summary} /> : null}
      {linked && !syncing && !summary && !watch.error ? (
        <Button label={t('sync.syncNow')} variant="primary" icon="sync" onPress={() => void watch.sync()} />
      ) : null}
    </>
  );
}

function Result({ summary }: { summary: SyncSummary }) {
  const { t } = useTranslation('onboarding');
  const colors = useColors();
  const { totals } = summary;
  return (
    <FadeIn style={styles.result}>
      <Card>
        <View style={styles.resultHead}>
          <PopIn>
            <Ionicons name="checkmark-circle" size={20} color={colors.link} />
          </PopIn>
          <AppText variant="heading">{t('sync.resultTitle')}</AppText>
        </View>
        <PairGrid>
          <Pair label={t('sync.samples')} value={fmtInt(summary.samples)} />
          <Pair label={t('sync.sleep')} value={fmtInt(summary.sleep)} />
          <Pair label={t('sync.workouts')} value={fmtInt(summary.workouts)} />
          <Pair label={t('sync.stepsToday')} value={fmtInt(totals.steps)} />
          <Pair label={t('sync.caloriesToday')} value={`${fmtInt(totals.calories)} kcal`} />
          <Pair label={t('sync.distanceToday')} value={fmtDistance(totals.distance)} />
        </PairGrid>
      </Card>
      <View style={styles.notes}>
        <Bullet label={'\u2022'}>{t('sync.note1')}</Bullet>
        <Bullet label={'\u2022'}>
          {t('sync.note2')}
        </Bullet>
        <Bullet label={'\u2022'}>{t('sync.note3')}</Bullet>
      </View>
    </FadeIn>
  );
}

const styles = StyleSheet.create({
  notes: { gap: spacing.sm },
  result: { gap: spacing.lg },
  resultHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
});
