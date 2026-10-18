import { useFocusEffect, useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Details } from '@/components/Details';
import { Button } from '@/components/Button';
import { HiddenTabHeader } from '@/components/HiddenTabHeader';
import { Metric } from '@/components/Metric';
import { Divider, Screen, Section } from '@/components/Screen';
import { EmptyState, Notice } from '@/components/States';
import { listHrvReadingsSince, type HrvReadingRow } from '@/db/queries';
import { isCancelled, useHrvProgress } from '@/features/hrv/useHrvProgress';
import { errorMessage, formatClock } from '@/format';
import { fmtDate, fmtInt, useTranslation } from '@/i18n';
import { useWatch } from '@/state/WatchProvider';
import { radius, spacing, useColors } from '@/theme';
import { HuaweiWear, type HrvReading } from '@/wear';

/** Length of the measurement; the countdown starts here until the first tick arrives. */
const MEASURE_SECONDS = 60;
/** How far back the list of earlier readings looks, and how many it shows. */
const HISTORY_DAYS = 30;
const HISTORY_ROWS = 10;

/** A one-minute HRV measurement from the watch's beat-to-beat intervals, and the earlier ones. */
export function MeasureHrvScreen() {
  const { t } = useTranslation('health');
  const db = useSQLiteContext();
  const colors = useColors();
  const router = useRouter();
  const { linkState } = useWatch();
  const { progress, reset } = useHrvProgress();
  const [measuring, setMeasuring] = useState(false);
  const [result, setResult] = useState<HrvReading | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<HrvReadingRow[] | null>(null);

  const loadHistory = useCallback(async () => {
    const since = Math.floor(Date.now() / 1000) - HISTORY_DAYS * 86_400;
    try {
      const rows = await listHrvReadingsSince(db, since);
      setHistory(rows.filter((r) => r.source === 'spot').reverse().slice(0, HISTORY_ROWS));
    } catch (e) {
      setError(errorMessage(e));
    }
  }, [db]);

  useFocusEffect(
    useCallback(() => {
      void loadHistory();
    }, [loadHistory]),
  );

  const connected = linkState === 'connected';

  const start = async () => {
    setError(null);
    setResult(null);
    reset();
    setMeasuring(true);
    try {
      setResult(await HuaweiWear.measureHrv());
      await loadHistory();
    } catch (e) {
      if (!isCancelled(e)) setError(errorMessage(e));
    } finally {
      setMeasuring(false);
    }
  };

  const cancel = () => {
    HuaweiWear.cancelHrvMeasurement().catch((e: unknown) => setError(errorMessage(e)));
  };

  const secondsLeft = progress?.secondsLeft ?? MEASURE_SECONDS;
  const elapsed = Math.min(1, Math.max(0, (MEASURE_SECONDS - secondsLeft) / MEASURE_SECONDS));

  return (
    <Screen>
      <HiddenTabHeader title={t('hrvMeasure.title')} />

      {!connected && !measuring ? (
        <Notice action={{ label: t('hrvMeasure.openWatch'), onPress: () => router.push('/watch') }}>{t('hrvMeasure.connectNotice')}</Notice>
      ) : null}

      <Section title={t('hrvMeasure.sectionOneMinute')} icon="pulse" tint="heart">
        {measuring ? (
          <View accessibilityLiveRegion="polite" style={styles.block}>
            <Metric value={String(secondsLeft)} unit={t('hrvMeasure.secondsLeft')} size="lg" color={colors.heartText} />
            <View
              accessibilityRole="progressbar"
              accessibilityValue={{ min: 0, max: MEASURE_SECONDS, now: Math.round(elapsed * MEASURE_SECONDS) }}
              style={[styles.track, { backgroundColor: colors.muted }]}>
              <View style={[styles.fill, { width: `${elapsed * 100}%`, backgroundColor: colors.heart }]} />
            </View>
            <AppText variant="caption" muted>
              {progress && progress.beats > 0
                ? t('hrvMeasure.beatsReceived', { count: progress.beats })
                : t('hrvMeasure.findingPulse')}
            </AppText>
            <Button label={t('hrvMeasure.cancel')} variant="ghost" onPress={cancel} />
          </View>
        ) : (
          <View style={styles.block}>
            <AppText variant="body">{t('hrvMeasure.prompt')}</AppText>
            <Details title={t('hrvMeasure.howTitle')}>{t('hrvMeasure.howBody')}</Details>
            <Button label={result ? t('hrvMeasure.measureAgain') : t('hrvMeasure.start')} variant="primary" icon="pulse" disabled={!connected} onPress={() => void start()} />
          </View>
        )}
        {error ? <Notice tone="danger">{error}</Notice> : null}
      </Section>

      {result && !measuring ? (
        <Section title={t('hrvMeasure.result')} icon="analytics" tint="heart">
          <View style={styles.resultRow}>
            <Metric value={String(Math.round(result.rmssd))} unit={t('hrvMeasure.rmssdUnit')} size="lg" color={colors.heartText} />
            <Metric value={fmtInt(result.heartRate)} unit="bpm" size="md" />
          </View>
          <View style={styles.resultRow}>
            <Stat label="SDNN" value={`${Math.round(result.sdnn)} ms`} />
            <Stat label={t('hrvMeasure.beatInterval')} value={`${Math.round(result.meanRr)} ms`} />
            <Stat label={t('hrvMeasure.beats')} value={fmtInt(result.beats)} />
          </View>
          <Details title={t('hrvMeasure.caveatTitle')}>{t('hrvMeasure.caveat')}</Details>
        </Section>
      ) : null}

      <Section title={t('hrvMeasure.earlier')} icon="time" tint="heart">
        {history === null ? null : history.length === 0 ? (
          <EmptyState icon="pulse" title={t('hrvMeasure.emptyTitle')} description={t('hrvMeasure.emptyDescription')} />
        ) : (
          history.map((row, i) => (
            <View key={`${row.start}-${row.source}`}>
              {i > 0 ? <Divider /> : null}
              <View style={styles.historyRow}>
                <View style={styles.historyText}>
                  <AppText variant="bodyStrong">{fmtDate(row.end, 'weekday')}</AppText>
                  <AppText variant="caption" muted>
                    {t('hrvMeasure.historyLine', { time: formatClock(row.start), count: row.beats })}
                  </AppText>
                </View>
                <Metric value={String(Math.round(row.rmssd))} unit="ms" size="sm" />
              </View>
            </View>
          ))
        )}
      </Section>
    </Screen>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.stat}>
      <AppText variant="caption" muted>
        {label}
      </AppText>
      <AppText variant="bodyStrong">{value}</AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  stat: { flex: 1 },
  block: { gap: spacing.sm },
  track: { height: 8, borderRadius: radius.pill, overflow: 'hidden' },
  fill: { height: 8, borderRadius: radius.pill },
  resultRow: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' },
  historyRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.xs },
  historyText: { flex: 1 },
});
