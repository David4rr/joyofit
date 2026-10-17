import { useMemo, useState } from 'react';

import { Button } from '@/components/Button';
import type { WorkoutRow } from '@/db/queries';
import { ShareSheet, type ShareSubject } from '@/features/share/ShareSheet';
import { buildShareStats, formatShareDate } from '@/features/share/shareStats';
import { sportIcon } from '@/features/workouts/sportIcon';
import type { RoutePoint, WorkoutSummary } from '@/features/workouts/summary';

const CAPTION = 'Tracked with JoyoFit · https://fit.joyorogo.com';

interface Props {
  workout: WorkoutRow;
  summary: WorkoutSummary;
  route: readonly RoutePoint[];
}

/** The "Share" button of a workout and the sheet it opens. */
export function ShareWorkoutButton({ workout, summary, route }: Props) {
  const [open, setOpen] = useState(false);
  const subject = useMemo<ShareSubject>(
    () => ({
      heading: 'Share workout',
      title: workout.sportName,
      subtitle: formatShareDate(workout.start),
      icon: sportIcon(workout.sportName),
      stats: buildShareStats(workout, summary),
      route,
      caption: CAPTION,
      cardHint: 'Your numbers on a dark JoyoFit card. This workout has no GPS route.',
    }),
    [workout, summary, route],
  );
  return (
    <>
      <Button label="Share" icon="share-outline" onPress={() => setOpen(true)} />
      <ShareSheet subject={subject} visible={open} onClose={() => setOpen(false)} />
    </>
  );
}
