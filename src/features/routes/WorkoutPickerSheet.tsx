import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useEffect, useState } from 'react';
import { FlatList, Modal, Pressable, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { IconChip } from '@/components/IconChip';
import { PressableScale } from '@/components/PressableScale';
import { LoadingState, Notice } from '@/components/States';
import { sportIcon } from '@/features/workouts/sportIcon';
import { errorMessage } from '@/format';
import { overlay, spacing, useTheme } from '@/theme';

import { IconAction } from '@/features/courses/IconAction';
import { copy, formatRouteDateTime } from './copy';
import { formatRouteDistance, type SavedRoute } from './routeModel';
import { listWorkoutsWithGps, saveWorkoutAsRoute, type WorkoutWithGps } from './saveWorkoutRoute';

interface WorkoutPickerSheetProps {
  visible: boolean;
  onClose: () => void;
  /** A workout was saved as a route. */
  onSaved: (route: SavedRoute) => void;
}

/** A bottom sheet of the workouts that have a GPS track; tapping one saves its track as a route. */
export function WorkoutPickerSheet({ visible, onClose, onSaved }: WorkoutPickerSheetProps) {
  const db = useSQLiteContext();
  const { colors, radius } = useTheme();
  const [items, setItems] = useState<WorkoutWithGps[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<number | null>(null);

  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    listWorkoutsWithGps(db).then(
      (list) => {
        if (!cancelled) setItems(list);
      },
      (e: unknown) => {
        if (!cancelled) setError(copy.workoutPicker.loadFailed(errorMessage(e)));
      },
    );
    return () => {
      cancelled = true;
      setItems(null);
      setError(null);
    };
  }, [visible, db]);

  const pick = useCallback(
    async (item: WorkoutWithGps) => {
      if (savingId !== null) return;
      setSavingId(item.workout.id);
      setError(null);
      try {
        onSaved(await saveWorkoutAsRoute(db, item.workout));
      } catch (e) {
        setError(copy.workoutPicker.saveFailed(errorMessage(e)));
      } finally {
        setSavingId(null);
      }
    },
    [db, onSaved, savingId],
  );

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <View style={styles.root}>
        <Pressable style={styles.scrim} onPress={onClose} accessibilityLabel={copy.workoutPicker.close} />
        <View style={[styles.sheet, { backgroundColor: colors.card, borderTopLeftRadius: radius.card, borderTopRightRadius: radius.card }]} accessibilityViewIsModal>
          <View style={styles.header}>
            <View style={styles.headerText}>
              <AppText variant="heading" accessibilityRole="header">
                {copy.workoutPicker.title}
              </AppText>
              <AppText variant="caption" muted>
                {copy.workoutPicker.caption}
              </AppText>
            </View>
            <IconAction icon="close" label={copy.workoutPicker.close} onPress={onClose} />
          </View>
          {error !== null ? <Notice tone="danger">{error}</Notice> : null}
          {items === null && error === null ? <LoadingState label={copy.workoutPicker.loading} /> : null}
          {items !== null && items.length === 0 ? (
            <AppText variant="caption" muted style={styles.empty}>
              {copy.workoutPicker.empty}
            </AppText>
          ) : null}
          {items !== null ? (
            <FlatList
              data={items}
              style={styles.flat}
              keyExtractor={(item) => String(item.workout.id)}
              showsVerticalScrollIndicator={false}
              contentContainerStyle={styles.list}
              renderItem={({ item }) => {
                const { workout } = item;
                const label = `${workout.sportName}, ${formatRouteDateTime(workout.start * 1000)}`;
                return (
                  <PressableScale
                    accessibilityRole="button"
                    accessibilityLabel={copy.workoutPicker.pick(label)}
                    accessibilityState={{ disabled: savingId !== null, busy: savingId === workout.id }}
                    disabled={savingId !== null}
                    onPress={() => void pick(item)}
                    scaleTo={0.985}
                    style={styles.row}>
                    <IconChip icon={sportIcon(workout.sportName)} tint="workouts" size="md" />
                    <View style={styles.rowText}>
                      <AppText variant="bodyStrong" numberOfLines={1}>
                        {workout.sportName}
                      </AppText>
                      <AppText variant="caption" muted numberOfLines={1}>
                        {`${formatRouteDateTime(workout.start * 1000)} \u00B7 ${workout.distance > 0 ? `${formatRouteDistance(workout.distance)} \u00B7 ` : ''}${copy.workoutPicker.gpsPoints(item.gpsPoints)}`}
                      </AppText>
                    </View>
                    {savingId === workout.id ? (
                      <AppText variant="caption" muted>
                        {copy.workoutPicker.saving}
                      </AppText>
                    ) : null}
                  </PressableScale>
                );
              }}
            />
          ) : null}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, justifyContent: 'flex-end' },
  scrim: { ...StyleSheet.absoluteFill, backgroundColor: overlay.scrim },
  sheet: { maxHeight: '80%', paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: spacing.xl, gap: spacing.sm },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  headerText: { flex: 1, gap: 2 },
  empty: { paddingVertical: spacing.lg },
  list: { paddingBottom: spacing.md },
  flat: { flexShrink: 1 },
  row: { minHeight: 64, flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.sm },
  rowText: { flex: 1, gap: 1 },
});
