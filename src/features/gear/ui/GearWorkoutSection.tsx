import { useFocusEffect, useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { syncActivityGear } from '@/cloud/strava';
import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { Chip } from '@/components/Chip';
import { Section } from '@/components/Screen';
import type { WorkoutRow } from '@/db/queries';
import { fmtDistance } from '@/i18n';
import { useCloud } from '@/state/CloudProvider';
import { spacing } from '@/theme';
import { gearChoices, gearSport, type Gear, type GearAssignment } from '../model';
import {
  allGearTotals,
  assignWorkout,
  dismissReminder,
  getAssignment,
  gearOfWorkout,
  listGear,
  reconcileDefaults,
  reminderPending,
} from '../store';
import { GearReminderCard } from './GearReminderCard';
import { OPEN_IN_STACK } from '@/components/navigation';

interface State {
  all: Gear[];
  current: Gear | null;
  assignment: GearAssignment | null;
  distanceM: number;
}

/**
 * The gear a workout was done with and a row of chips to change it. The first read hands the default gear to workouts that
 * have no choice yet, so a workout of a sport with a default shows it without the person doing anything.
 */
export function GearWorkoutSection({ workout }: { workout: WorkoutRow }) {
  const { t } = useTranslation('gear');
  const db = useSQLiteContext();
  const router = useRouter();
  const cloud = useCloud();
  const [state, setState] = useState<State | null>(null);

  const load = useCallback(
    async (reconcile: boolean) => {
      if (reconcile) await reconcileDefaults(db);
      const [all, current, assignment, totals] = await Promise.all([
        listGear(db),
        gearOfWorkout(db, workout.start),
        getAssignment(db, workout.start),
        allGearTotals(db),
      ]);
      setState({ all, current, assignment, distanceM: current ? (totals.get(current.id)?.distanceM ?? current.startDistanceM) : 0 });
    },
    [db, workout.start],
  );

  useFocusEffect(
    useCallback(() => {
      void load(true).catch(() => {});
    }, [load]),
  );

  const sync = () => {
    if (cloud.signedIn) void cloud.syncNow().catch(() => {});
  };

  const choose = async (gearId: string | null) => {
    await assignWorkout(db, workout.start, gearId);
    await load(false);
    syncActivityGear(db, workout.start).catch(() => {});
    sync();
  };

  const dismiss = async (gear: Gear, level: Parameters<typeof dismissReminder>[2]) => {
    await dismissReminder(db, gear.id, level);
    await load(false);
    sync();
  };

  if (!state) return null;
  const { all, current, assignment, distanceM } = state;
  const choices = gearChoices(all, gearSport(workout.sportType));
  const pending = current ? reminderPending(current, distanceM) : 0;

  return (
    <Section title={t('workout.title')} icon="footsteps" tint="workouts">
      {current ? (
        <View style={styles.current}>
          <View style={styles.currentText}>
            <AppText variant="caption" muted>
              {t('workout.current')}
            </AppText>
            <AppText variant="bodyStrong" numberOfLines={2}>
              {current.name}
            </AppText>
            <AppText variant="caption" muted>
              {t('workout.total', { distance: fmtDistance(distanceM) })}
            </AppText>
          </View>
          {assignment?.source === 'default' ? (
            <AppText variant="label" muted>
              {t('workout.fromDefault')}
            </AppText>
          ) : null}
        </View>
      ) : null}
      {current && pending > 0 ? <GearReminderCard gear={current} distanceM={distanceM} onDismiss={() => void dismiss(current, pending)} /> : null}
      {choices.length === 0 ? (
        <>
          <AppText variant="caption" muted>
            {t('workout.noMatch')}
          </AppText>
          <Button label={t('workout.manage')} variant="secondary" icon="settings-outline" onPress={() => router.push('/settings/gear', OPEN_IN_STACK)} />
        </>
      ) : (
        <>
          <AppText variant="label" muted>
            {t('workout.choose')}
          </AppText>
          <View style={styles.chips}>
            <Chip label={t('workout.none')} selected={current === null} onPress={() => void choose(null)} />
            {choices.map((gear) => (
              <Chip key={gear.id} label={gear.name} selected={current?.id === gear.id} onPress={() => void choose(gear.id)} />
            ))}
          </View>
        </>
      )}
    </Section>
  );
}

const styles = StyleSheet.create({
  current: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  currentText: { flex: 1, gap: 2 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
});
