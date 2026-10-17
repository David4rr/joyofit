import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Details } from '@/components/Details';
import { KeyValue } from '@/components/KeyValue';
import { Metric } from '@/components/Metric';
import { EmptyState } from '@/components/States';
import { formatClock, formatDuration } from '@/format';
import type { SleepScoreRow } from '@/db/queries';
import { NoStagesNotice } from '@/features/sleep/NoStagesNotice';
import { SleepScoreRing } from '@/features/sleep/SleepScoreRing';
import { STAGE_LABELS, stageColor } from '@/features/sleep/stageStyle';
import type { SleepSummary } from '@/features/today/stats';
import { radius, spacing, useColors } from '@/theme';

export function SleepSummaryView({ summary, score }: { summary: SleepSummary | null; score: SleepScoreRow | null }) {
  const colors = useColors();
  if (!summary) {
    return (
      <EmptyState
        icon="moon"
        title="No sleep stored"
        description="Nothing in the last 36 hours. Sync after waking."
      />
    );
  }

  const hasStages = summary.byStage.length > 0;
  const awakeSeconds = summary.byStage.find((entry) => entry.stage === 'awake')?.seconds ?? 0;
  const headlineSeconds = hasStages ? summary.totalSeconds - awakeSeconds : summary.totalSeconds;
  const minutes = Math.round(headlineSeconds / 60);

  return (
    <View style={styles.wrap}>
      <View style={styles.headlineRow}>
        <View style={styles.headlineText}>
          <View accessible accessibilityLabel={`Slept ${formatDuration(headlineSeconds)}`} style={styles.headline}>
            {minutes >= 60 ? <Metric value={String(Math.floor(minutes / 60))} unit="h" size="lg" color={colors.sleepText} unitColor={colors.mutedForeground} /> : null}
            <Metric value={String(minutes % 60).padStart(minutes >= 60 ? 2 : 1, '0')} unit="min" size="lg" color={colors.sleepText} unitColor={colors.mutedForeground} />
          </View>
          <AppText variant="caption" muted>
            {formatClock(summary.start)} to {formatClock(summary.end)}
            {hasStages ? ', awake excluded' : ', no stages'}
          </AppText>
        </View>
        {score ? <SleepScoreRing score={score} /> : null}
      </View>
      {hasStages ? (
        <>
          <View accessible={false} importantForAccessibility="no-hide-descendants" style={styles.stageBar}>
            {summary.byStage.map((entry) => (
              <View key={entry.stage} style={{ flex: entry.seconds, backgroundColor: stageColor(entry.stage, colors) }} />
            ))}
          </View>
          <View style={styles.legend}>
            {summary.byStage.map((entry) => (
              <View key={entry.stage} style={styles.legendRow}>
                <View style={[styles.swatch, { backgroundColor: stageColor(entry.stage, colors) }]} />
                <AppText variant="caption" numberOfLines={1} style={styles.legendLabel}>
                  {STAGE_LABELS[entry.stage]}
                </AppText>
                <AppText variant="label" style={styles.tabular}>
                  {formatDuration(entry.seconds)} <AppText variant="caption" muted>{Math.round((entry.seconds / summary.totalSeconds) * 100)}%</AppText>
                </AppText>
              </View>
            ))}
          </View>
          <Details>Stages come from the watch&apos;s sleep data. Spans without a stage count only in the total.</Details>
        </>
      ) : (
        <>
          <NoStagesNotice />
          {summary.byType.map((entry) => (
            <KeyValue
              key={entry.type}
              label={`Type ${entry.type}`}
              value={`${entry.count} ${entry.count === 1 ? 'segment' : 'segments'}, ${formatDuration(entry.seconds)}`}
            />
          ))}
          <Details>Types are the raw state bytes from the watch. Their meanings are not decoded.</Details>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.sm },
  headlineRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  headlineText: { flex: 1, gap: 2 },
  headline: { flexDirection: 'row', alignItems: 'baseline', gap: 8 },
  stageBar: { flexDirection: 'row', height: 14, gap: 2, borderRadius: radius.pill, overflow: 'hidden', marginVertical: spacing.xs },
  legend: { flexDirection: 'row', flexWrap: 'wrap', columnGap: spacing.lg },
  legendRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: 24, width: '47%' },
  swatch: { width: 12, height: 12, borderRadius: 6 },
  legendLabel: { flex: 1 },
  tabular: { fontVariant: ['tabular-nums'] },
});
