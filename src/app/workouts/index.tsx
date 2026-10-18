import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { SectionList, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { SyncButton } from '@/features/device/SyncButton';
import { IconChip } from '@/components/IconChip';
import { Metric } from '@/components/Metric';
import { PressableScale } from '@/components/PressableScale';
import { PageHeader, useContentPadding, useRefreshControl } from '@/components/Screen';
import { EmptyState, Notice, Skeleton } from '@/components/States';
import { listWorkouts, type WorkoutRow } from '@/db/queries';
import { pickFitFile } from '@/features/fitimport/useFitImport';
import { sportIcon } from '@/features/workouts/sportIcon';
import { sportLabel } from '@/features/workouts/sportLabel';
import { formatElapsed, workoutDistanceParts } from '@/features/workouts/summary';
import { workoutTimes } from '@/features/workouts/times';
import { useWorkoutStrain } from '@/features/workouts/useWorkoutStrain';
import { errorMessage, formatCount, formatDateTime } from '@/format';
import { fmtDate, fmtDecimal, useLocale } from '@/i18n';
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

function WorkoutCard({ workout }: { workout: WorkoutRow }) {
  const router = useRouter();
  const { colors, radius } = useTheme();
  const heart = tintColors(colors, 'heart');
  const { t } = useTranslation('workouts');
  const sport = sportLabel(workout.sportName);
  const { value: distance, unit: distanceUnit } = workoutDistanceParts(workout.distance);
  const strain = useWorkoutStrain(workout);
  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel={t('list.cardA11y', { sport, date: formatDateTime(workout.start) })}
      onPress={() => router.push({ pathname: '/workouts/[id]', params: { id: String(workout.id) } })}
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
  const locale = useLocale();
  // The status-bar inset is applied outside the list so sticky month headers stop below it.
  const padding = useContentPadding(false);
  const { linkState, device, dataVersion, sync } = useWatch();
  const [workouts, setWorkouts] = useState<WorkoutRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pulling, setPulling] = useState(false);
  const [pickError, setPickError] = useState<string | null>(null);

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
              right={
                <SyncButton variant="primary" />
              }
            />
            <Button
              label={t('list.importFit')}
              variant="secondary"
              icon="bicycle"
              onPress={() => void importFit()}
            />
            {pickError ? <Notice tone="danger">{t('list.pickError', { error: pickError })}</Notice> : null}
            {error ? <Notice tone="danger">{t('list.readError', { error })}</Notice> : null}
            {!canSync && !syncing && workouts && workouts.length > 0 ? (
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
              description={t('list.empty.description')}
              action={
                canSync
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
        renderItem={({ item }) => <WorkoutCard workout={item} />}
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
  partialText: { flex: 1 },
  skeletons: { gap: spacing.md },
});
