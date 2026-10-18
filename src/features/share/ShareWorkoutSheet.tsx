import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/Button';
import type { WorkoutRow } from '@/db/queries';
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
  const [open, setOpen] = useState(false);
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
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `t` follows the language
    [workout, summary, route, i18n.language],
  );
  return (
    <>
      <Button label={t('common:actions.share')} icon="share-outline" onPress={() => setOpen(true)} />
      <ShareSheet subject={subject} visible={open} onClose={() => setOpen(false)} />
    </>
  );
}
