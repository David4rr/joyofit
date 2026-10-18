import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { SectionList, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { showsWatchUi } from '@/features/device/presence';
import { SyncButton } from '@/features/device/SyncButton';
import { useWatchPresence } from '@/features/device/useWatchPresence';
import { IconChip } from '@/components/IconChip';
import { Metric } from '@/components/Metric';
import { PressableScale } from '@/components/PressableScale';
import { PageHeader, useContentPadding, useRefreshControl } from '@/components/Screen';
import { EmptyState, Notice, Skeleton } from '@/components/States';
import { listWorkouts, type WorkoutRow } from '@/db/queries';
import { pickFitFile } from '@/features/fitimport/useFitImport';
import { RecordingBanner } from '@/features/record/ui/RecordingBanner';
import { useStrengthHistory } from '@/features/strength/history';
import { workoutTotals } from '@/features/strength/calc';
import type { StrengthWorkout } from '@/features/strength/types';
import { ActiveWorkoutBanner } from '@/features/strength/ui/ActiveWorkoutBanner';
import { volumeText } from '@/features/strength/ui/liftFormat';
import { sportIcon } from '@/features/workouts/sportIcon';
import { sportLabel } from '@/features/workouts/sportLabel';
import { formatElapsed, workoutDistanceParts } from '@/features/workouts/summary';
import { workoutTimes } from '@/features/workouts/times';
import { useWorkoutStrain } from '@/features/workouts/useWorkoutStrain';
import { errorMessage, formatCount, formatDateTime } from '@/format';
import { fmtDate, fmtDecimal, useLocale } from '@/i18n';
import { useRecorder } from '@/state/RecorderProvider';
import { useWatch } from '@/state/WatchProvider';
import { spacing, tintColors, useColors, useTheme } from '@/theme';

interface MonthGroup {
  title: string;
  data: WorkoutRow[];
}

/** Consecutive workouts of the same month under one heading; relies on the query's newest-first order. */
function groupByMonth(workouts: readonly WorkoutRow[]): MonthGroup[] {
  const groups: MonthGroup[] = [];
  for (const workout of workouts) {
    const title = fmtDate(workout.start, 'month');
    const last = groups[groups.length - 1];
    if (last && last.title === title) last.data.push(workout);
    else groups.push({ title, data: [workout] });
  }
  return groups;
}

function WorkoutCard({ workout, strength }: { workout: WorkoutRow; strength?: StrengthWorkout }) {
  const router = useRouter();
  const { colors, radius } = useTheme();
  const heart = tintColors(colors, 'heart');
  const { t } = useTranslation('workouts');
  const { t: lifts } = useTranslation('lifts');
  const sport = strength?.name.trim() || sportLabel(workout.sportName);
  const { value: distance, unit: distanceUnit } = workoutDistanceParts(workout.distance);
  const strain = useWorkoutStrain(workout);
  const totals = useMemo(() => (strength ? workoutTotals(strength) : null), [strength]);
  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel={t('list.cardA11y', { sport, date: formatDateTime(workout.start) })}
      onPress={() =>
        strength
          ? router.push({ pathname: '/strength/summary/[id]', params: { id: strength.id } })
          : router.push({ pathname: '/workouts/[id]', params: { id: String(workout.id) } })
      }
      style={[styles.card, { backgroundColor: colors.card, borderRadius: radius.card }]}>
      <View style={styles.cardHead}>
        <IconChip icon={sportIcon(workout.sportName)} tint="workouts" />
        <View style={styles.cardTitle}>
          <AppText variant="bodyStrong" numberOfLines={1}>
            {sport}
          </AppText>
          <AppText variant="caption" muted numberOfLines={1}>
            {formatDateTime(workout.start)}
          </AppText>
        </View>
        <Ionicons name="chevron-forward" size={18} color={colors.mutedForeground} />
      </View>
      <View style={styles.metrics}>
        <Metric value={formatElapsed(workoutTimes(workout).movingSec)} size="sm" />
        {workout.distance > 0 ? <Metric value={distance} unit={distanceUnit} size="sm" /> : null}
        {workout.calories > 0 ? <Metric value={formatCount(workout.calories)} unit={t('list.unit.kcal')} size="sm" /> : null}
        {workout.avgHr !== null ? (
          <Metric value={String(workout.avgHr)} unit={t('list.unit.bpmAvg')} size="sm" color={heart.text} unitColor={heart.text} />
        ) : null}
        {strain !== null && strain !== undefined ? (
          <Metric value={fmtDecimal(strain, 1)} unit={t('list.unit.strain')} size="sm" color={colors.workoutsText} unitColor={colors.workoutsText} />
        ) : null}
      </View>
      {totals ? (
        <View style={styles.strengthLine}>
          <Ionicons name="barbell-outline" size={16} color={colors.mutedForeground} />
          <AppText variant="caption" muted style={styles.partialText}>
            {lifts('list.strengthLine', { count: totals.sets, volume: volumeText(totals.volume) })}
          </AppText>
        </View>
      ) : null}
      {!workout.complete ? (
        <View style={styles.partial}>
          <Ionicons name="cloud-download-outline" size={16} color={colors.mutedForeground} />
          <AppText variant="caption" muted style={styles.partialText}>
            {t('list.partial')}
          </AppText>
        </View>
      ) : null}
    </PressableScale>
  );
}

function WorkoutSkeletons() {
  return (
    <View style={styles.skeletons}>
      {[0, 1, 2, 3].map((i) => (
        <Skeleton key={i} width="100%" height={96} radius="card" />
      ))}
    </View>
  );
}

export default function WorkoutsScreen() {
  const db = useSQLiteContext();
  const router = useRouter();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { t } = useTranslation('workouts');
  const { t: lifts } = useTranslation('lifts');
  const locale = useLocale();
  // The status-bar inset is applied outside the list so sticky month headers stop below it.
  const padding = useContentPadding(false);
  const { linkState, device, dataVersion, sync } = useWatch();
  const recording = useRecorder().snapshot.phase !== 'idle';
  const presence = useWatchPresence();
  // A phone that never had a watch gets no Sync button and no "connect your watch" nagging; the strength logger is the point of this tab.
  const watchUi = presence !== null && showsWatchUi(presence);
  const [workouts, setWorkouts] = useState<WorkoutRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pulling, setPulling] = useState(false);
  const [pickError, setPickError] = useState<string | null>(null);
  // Strength workouts by the `workouts.start` they are stored as (their own row, or the watch row they merged with).
  const { workouts: strengthWorkouts } = useStrengthHistory();
  const strengthByStart = useMemo(() => {
    const map = new Map<number, StrengthWorkout>();
    for (const w of strengthWorkouts) if (w.workoutStart !== null) map.set(w.workoutStart, w);
    return map;
  }, [strengthWorkouts]);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      listWorkouts(db).then(
        (rows) => {
          if (!cancelled) {
            setWorkouts(rows);
            setError(null);
          }
        },
        (e: unknown) => {
          if (!cancelled) setError(errorMessage(e));
        },
      );
      return () => {
        cancelled = true;
      };
      // dataVersion re-runs the query after each stored sync.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [db, dataVersion]),
  );

  const canSync = linkState === 'connected' && device !== null;
  const syncing = linkState === 'syncing';
  const sections = useMemo(() => groupByMonth(workouts ?? []), [workouts, locale]);
  const refreshControl = useRefreshControl({
    refreshing: pulling,
    enabled: canSync,
    onRefresh: () => {
      setPulling(true);
      void sync().finally(() => setPulling(false));
    },
  });

  const connectAction = { label: t('list.connectWatch'), onPress: () => router.push('/watch') };
  // Strength workouts that have no row in this list (imported from JoyoRogo): they live in the strength history.
  const strengthOnlyCount = useMemo(() => strengthWorkouts.filter((w) => w.workoutStart === null).length, [strengthWorkouts]);

  /** The picker here, the import and its result on the FIT import screen. */
  const importFit = async () => {
    setPickError(null);
    try {
      const picked = await pickFitFile();
      if (picked) router.push({ pathname: '/settings/import-fit', params: { uri: picked.uri } });
    } catch (e) {
      setPickError(errorMessage(e));
    }
  };

  return (
    <View style={[styles.root, { backgroundColor: colors.background, paddingTop: insets.top }]}>
      <SectionList
        sections={sections}
        keyExtractor={(w) => String(w.id)}
        contentContainerStyle={padding}
        refreshControl={refreshControl}
        showsVerticalScrollIndicator={false}
        stickySectionHeadersEnabled
        initialNumToRender={8}
        maxToRenderPerBatch={8}
        windowSize={7}
        ItemSeparatorComponent={ItemGap}
        ListHeaderComponent={
          <View style={styles.header}>
            <PageHeader
              title={t('list.title')}
              right={watchUi ? <SyncButton variant="primary" /> : undefined}
            />
            <ActiveWorkoutBanner />
            <RecordingBanner />
            {recording ? null : <Button label={t('record.title')} variant="primary" icon="radio-button-on" onPress={() => router.push('/workouts/record')} />}
            <Button label={lifts('list.start')} variant="primary" icon="barbell" onPress={() => router.push('/strength')} />
            <Button label={lifts('list.history')} variant="secondary" icon="calendar" onPress={() => router.push('/strength/history')} />
            <Button label={t('list.logManual')} variant="secondary" icon="create-outline" onPress={() => router.push('/workouts/manual')} />
            <Button
              label={t('list.importFit')}
              variant="secondary"
              icon="bicycle"
              onPress={() => void importFit()}
            />
            {pickError ? <Notice tone="danger">{t('list.pickError', { error: pickError })}</Notice> : null}
            {error ? <Notice tone="danger">{t('list.readError', { error })}</Notice> : null}
            {strengthOnlyCount > 0 ? (
              <Notice icon="barbell-outline" action={{ label: lifts('list.history'), onPress: () => router.push('/strength/history') }}>
                {t('list.strengthElsewhere', { count: strengthOnlyCount })}
              </Notice>
            ) : null}
            {watchUi && !canSync && !syncing && workouts && workouts.some((w) => !w.imported) ? (
              <Notice icon="watch-outline" action={connectAction}>
                {t('list.connectToSync')}
              </Notice>
            ) : null}
          </View>
        }
        ListEmptyComponent={
          workouts ? (
            <EmptyState
              icon="fitness"
              title={t('list.empty.title')}
              description={watchUi ? t('list.empty.description') : t('list.empty.descriptionNoWatch')}
              action={
                !watchUi
                  ? { label: t('record.title'), icon: 'radio-button-on', onPress: () => router.push('/workouts/record') }
                  : canSync
                    ? { label: t('list.empty.syncNow'), icon: 'sync', onPress: () => void sync() }
                    : syncing
                      ? undefined
                      : connectAction
              }
            />
          ) : error ? null : (
            <WorkoutSkeletons />
          )
        }
        renderSectionHeader={({ section }) => (
          <View style={[styles.sectionHeader, { backgroundColor: colors.background }]}>
            <AppText variant="label" muted accessibilityRole="header">
              {section.title}
            </AppText>
          </View>
        )}
        renderItem={({ item }) => <WorkoutCard workout={item} strength={strengthByStart.get(item.start)} />}
      />
    </View>
  );
}

function ItemGap() {
  return <View style={styles.gap} />;
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: { gap: spacing.sm, marginBottom: spacing.xs },
  sectionHeader: { paddingTop: spacing.sm, paddingBottom: spacing.xs },
  gap: { height: spacing.sm },
  card: { padding: spacing.md + 4, gap: spacing.sm },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  cardTitle: { flex: 1, gap: 2 },
  metrics: { flexDirection: 'row', flexWrap: 'wrap', columnGap: spacing.md, rowGap: 0 },
  partial: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  strengthLine: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  partialText: { flex: 1 },
  skeletons: { gap: spacing.md },
});
