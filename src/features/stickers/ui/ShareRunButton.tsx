import { useSQLiteContext } from 'expo-sqlite';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/Button';
import type { WorkoutRow } from '@/db/queries';
import { gearShareLine } from '@/features/gear/format';
import { allGearTotals, gearOfWorkout } from '@/features/gear/store';
import { buildRunSubject } from '@/features/stickers/data/run';
import { StickerSheet } from '@/features/stickers/ui/StickerSheet';
import type { WorkoutAnalysis } from '@/features/workouts/analysis/types';
import type { RoutePoint, WorkoutSummary } from '@/features/workouts/summary';
import { useLocale } from '@/i18n';

interface Props {
  workout: WorkoutRow;
  summary: WorkoutSummary;
  route: readonly RoutePoint[];
  analysis: WorkoutAnalysis | null;
}

/** The "Share" button of a workout and the sticker sheet it opens. */
export function ShareRunButton({ workout, summary, route, analysis }: Props) {
  const { t } = useTranslation('common');
  const locale = useLocale();
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
  }, [db, open, workout.start, locale]);

  const subject = useMemo(
    () => buildRunSubject({ workout, summary, analysis, route, gearLine }, locale),
    [workout, summary, analysis, route, gearLine, locale],
  );

  return (
    <>
      <Button label={t('actions.share')} icon="share-outline" onPress={() => setOpen(true)} />
      <StickerSheet subject={subject} visible={open} onClose={() => setOpen(false)} />
    </>
  );
}
