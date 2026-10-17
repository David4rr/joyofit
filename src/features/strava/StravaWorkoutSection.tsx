import { useFocusEffect, useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useState } from 'react';

import { StravaNotConnectedError, sendWorkoutToStrava } from '@/cloud/strava';
import { Button } from '@/components/Button';
import { KeyValue } from '@/components/KeyValue';
import { Section } from '@/components/Screen';
import { Notice } from '@/components/States';
import { AppText } from '@/components/AppText';
import { getStravaUpload, type StravaUploadRow } from '@/db/strava';
import type { WorkoutRow } from '@/db/queries';
import { ViewOnStrava } from '@/features/strava/StravaLink';
import { errorMessage } from '@/format';
import { useStrava } from '@/state/StravaProvider';

const STATUS_LABEL: Record<StravaUploadRow['status'], string> = {
  processing: 'Strava is still processing it',
  done: 'Sent to Strava',
  failed: 'Could not be sent, try again',
  rejected: 'Strava refused the file',
};

/**
 * "Send to Strava" for one workout, and where it ended up. Sending is also allowed for workouts that ended before
 * the account connected (and for imported ones): only the automatic upload is limited to new workouts.
 */
export function StravaWorkoutSection({ workout }: { workout: WorkoutRow }) {
  const db = useSQLiteContext();
  const router = useRouter();
  const strava = useStrava();
  const [row, setRow] = useState<StravaUploadRow | null>(null);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const connected = strava.settings.connectedAt !== null;

  useFocusEffect(
    useCallback(() => {
      let live = true;
      getStravaUpload(db, workout.start).then(
        (found) => {
          if (live) setRow(found);
        },
        () => {},
      );
      return () => {
        live = false;
      };
    }, [db, workout.start]),
  );

  const send = useCallback(async () => {
    setError(null);
    setSending(true);
    try {
      setRow(await sendWorkoutToStrava(db, workout.id));
    } catch (e) {
      setError(e instanceof StravaNotConnectedError ? e.message : errorMessage(e));
      await strava.refresh().catch(() => {});
    } finally {
      setSending(false);
    }
  }, [db, workout.id, strava]);

  const done = row?.status === 'done' && row.activityId !== null;

  return (
    <Section title="Strava" icon="share-social" tint="workouts">
      {!connected ? (
        <>
          <AppText variant="caption" muted>
            Connect Strava to send this workout with its distance, calories, heart rate and route.
          </AppText>
          <Button label="Set up Strava" variant="secondary" icon="link" onPress={() => router.push('/settings/strava')} />
        </>
      ) : (
        <>
          <KeyValue icon="cloud-upload-outline" label="Status" value={row ? STATUS_LABEL[row.status] : 'Not sent'} />
          {done ? <ViewOnStrava activityId={row.activityId as number} /> : null}
          {row && row.status !== 'done' && row.error ? <Notice tone="danger">{row.error}</Notice> : null}
          {error ? <Notice tone="danger">{error}</Notice> : null}
          {!workout.complete ? (
            <Notice>Still downloading from the watch. Send after the next sync.</Notice>
          ) : null}
          {!done ? (
            <Button
              label={row?.status === 'processing' ? 'Check Strava' : 'Send to Strava'}
              variant="primary"
              icon="cloud-upload"
              onPress={() => void send()}
              disabled={!workout.complete || !strava.signedIn}
              loading={sending}
            />
          ) : null}
          {!strava.signedIn ? (
            <AppText variant="caption" muted>
              Sign in with JoyoRogo (Settings, Health and cloud) to send.
            </AppText>
          ) : null}
        </>
      )}
    </Section>
  );
}
