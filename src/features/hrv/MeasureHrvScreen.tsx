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
import { useWatch } from '@/state/WatchProvider';
import { radius, spacing, useColors } from '@/theme';
import { HuaweiWear, type HrvReading } from '@/wear';

/** Length of the measurement; the countdown starts here until the first tick arrives. */
const MEASURE_SECONDS = 60;
/** How far back the list of earlier readings looks, and how many it shows. */
const HISTORY_DAYS = 30;
const HISTORY_ROWS = 10;

const DAY_FORMAT: Intl.DateTimeFormatOptions = { weekday: 'short', day: 'numeric', month: 'short' };

/** A one-minute HRV measurement from the watch's beat-to-beat intervals, and the earlier ones. */
export function MeasureHrvScreen() {
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
      <HiddenTabHeader title="Measure HRV" />

      {!connected && !measuring ? (
        <Notice action={{ label: 'Open Watch', onPress: () => router.push('/watch') }}>Connect the watch to measure.</Notice>
      ) : null}

      <Section title="One-minute measurement" icon="pulse" tint="heart">
        {measuring ? (
          <View accessibilityLiveRegion="polite" style={styles.block}>
            <Metric value={String(secondsLeft)} unit="s left" size="lg" color={colors.heartText} />
            <View
              accessibilityRole="progressbar"
              accessibilityValue={{ min: 0, max: MEASURE_SECONDS, now: Math.round(elapsed * MEASURE_SECONDS) }}
              style={[styles.track, { backgroundColor: colors.muted }]}>
              <View style={[styles.fill, { width: `${elapsed * 100}%`, backgroundColor: colors.heart }]} />
            </View>
            <AppText variant="caption" muted>
              {progress && progress.beats > 0
                ? `${progress.beats} beats received. Keep still.`
                : 'Finding your pulse. Keep still.'}
            </AppText>
            <Button label="Cancel" variant="ghost" onPress={cancel} />
          </View>
        ) : (
          <View style={styles.block}>
            <AppText variant="body">Sit down, rest your arm, watch snug.</AppText>
            <Details title="How to measure">
              Wear the watch snug, about a finger above the wrist bone. Stay still and quiet for the whole minute; moving or talking spoils the reading. Live heart rate pauses meanwhile.
            </Details>
            <Button label={result ? 'Measure again' : 'Start measuring'} variant="primary" icon="pulse" disabled={!connected} onPress={() => void start()} />
          </View>
        )}
        {error ? <Notice tone="danger">{error}</Notice> : null}
      </Section>

      {result && !measuring ? (
        <Section title="Result" icon="analytics" tint="heart">
          <View style={styles.resultRow}>
            <Metric value={String(Math.round(result.rmssd))} unit="ms RMSSD" size="lg" color={colors.heartText} />
            <Metric value={String(result.heartRate)} unit="bpm" size="md" />
          </View>
          <View style={styles.resultRow}>
            <Stat label="SDNN" value={`${Math.round(result.sdnn)} ms`} />
            <Stat label="Beat interval" value={`${Math.round(result.meanRr)} ms`} />
            <Stat label="Beats" value={String(result.beats)} />
          </View>
          <Details>
            A single minute is a rough reading: posture, breathing and the time of day move it. Measure under the same conditions to compare.
          </Details>
        </Section>
      ) : null}

      <Section title="Earlier measurements" icon="time" tint="heart">
        {history === null ? null : history.length === 0 ? (
          <EmptyState icon="pulse" title="No measurements yet" description="One-minute readings are listed here." />
        ) : (
          history.map((row, i) => (
            <View key={`${row.start}-${row.source}`}>
              {i > 0 ? <Divider /> : null}
              <View style={styles.historyRow}>
                <View style={styles.historyText}>
                  <AppText variant="bodyStrong">{new Date(row.end * 1000).toLocaleDateString(undefined, DAY_FORMAT)}</AppText>
                  <AppText variant="caption" muted>
                    {formatClock(row.start)}, {row.beats} beats
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
