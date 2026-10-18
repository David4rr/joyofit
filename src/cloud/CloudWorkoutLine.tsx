import { useSQLiteContext } from 'expo-sqlite';
import { useEffect, useState } from 'react';

import { AppText } from '@/components/AppText';
import { cloudLineText, estimateBytes } from '@/cloud/estimate';
import { getUploadedStats, getWorkoutCloudInfo } from '@/db/cloud';
import { ANALYSIS_ENGINE_REV } from '@/features/workouts/analysis/engineRev';
import { useCloud } from '@/state/CloudProvider';

/**
 * One caption line for the workout detail: whether the workout is in the JoyoRogo cloud and how big the copy is, or how big
 * the upload will be. Takes the workout's `start` (unix seconds, the key it has in the cloud). Renders nothing while it
 * is read, and for a phone that is not signed in (there is no cloud to speak of).
 */
export function CloudWorkoutLine({ start }: { start: number }) {
  const db = useSQLiteContext();
  const { signedIn, locked, lastSyncAt, uploading } = useCloud();
  const [text, setText] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    (async () => {
      const [info, uploaded] = await Promise.all([getWorkoutCloudInfo(db, start), getUploadedStats(db)]);
      if (!live || !info) return;
      const stale = info.cloud !== null && (info.rev > info.cloud.rev || info.cloud.engineRev < ANALYSIS_ENGINE_REV);
      setText(
        cloudLineText({
          cloudBytes: info.cloud?.bytes ?? null,
          stale,
          estimateBytes: estimateBytes(1, info.points, uploaded),
          locked,
        }),
      );
    })().catch(() => {});
    return () => {
      live = false;
    };
  }, [db, start, locked, lastSyncAt, uploading]);

  if (!signedIn || text === null) return null;
  return (
    <AppText variant="caption" muted>
      {text}
    </AppText>
  );
}
