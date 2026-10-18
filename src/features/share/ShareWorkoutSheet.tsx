import { useSQLiteContext } from 'expo-sqlite';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/Button';
import type { WorkoutRow } from '@/db/queries';
import { gearShareLine } from '@/features/gear/format';
import { allGearTotals, gearOfWorkout } from '@/features/gear/store';
import { ShareSheet, type ShareSubject } from '@/features/share/ShareSheet';
import { buildShareStats, formatShareDate } from '@/features/share/shareStats';
import { sportIcon } from '@/features/workouts/sportIcon';
import type { RoutePoint, WorkoutSummary } from '@/features/workouts/summary';
import { sportLabel } from '@/features/workouts/sportLabel';

interface Props {
  workout: WorkoutRow;
  summary: WorkoutSummary;
  route: readonly RoutePoint[];
}

/** The "Share" button of a workout and the sheet it opens. */
export function ShareWorkoutButton({ workout, summary, route }: Props) {
  const { t, i18n } = useTranslation(['sharing', 'common']);
  const db = useSQLiteContext();
  const [open, setOpen] = useState(false);
  const [gearLine, setGearLine] = useState<string | null>(null);

  // The gear the workout was done with, and its lifetime distance, as "Sepatu: Nike Pegasus 41 · 312 km".
  useEffect(() => {
    if (!open) return;
    let live = true;
    (async () => {
      const gear = await gearOfWorkout(db, workout.start);
      const distance = gear ? (await allGearTotals(db)).get(gear.id)?.distanceM : undefined;
      if (live) setGearLine(gear && distance !== undefined ? gearShareLine(gear, distance) : null);
    })().catch(() => {});
    return () => {
      live = false;
    };
  }, [db, open, workout.start, i18n.language]);

  const subject = useMemo<ShareSubject>(
    () => ({
      heading: t('sharing:share.workout.heading'),
      title: sportLabel(workout.sportName),
      subtitle: formatShareDate(workout.start),
      icon: sportIcon(workout.sportName),
      stats: buildShareStats(workout, summary),
      route,
      caption: t('sharing:share.caption'),
      cardHint: t('sharing:share.workout.hint'),
      extraLine: gearLine,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `t` follows the language
    [workout, summary, route, gearLine, i18n.language],
  );
  return (
    <>
      <Button label={t('common:actions.share')} icon="share-outline" onPress={() => setOpen(true)} />
      <ShareSheet subject={subject} visible={open} onClose={() => setOpen(false)} />
    </>
  );
}
