import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef } from 'react';

import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { Details } from '@/components/Details';
import { isIos } from '@/components/IosUnavailable';
import { Section } from '@/components/Screen';
import { Notice } from '@/components/States';
import { useFitImport } from '@/features/fitimport/useFitImport';

const HEALTH_APP = isIos ? 'Apple Health' : 'Health Connect';

/**
 * Import a ride or run from a `.fit` file: the file iGPSPORT, Garmin, Wahoo, Bryton, Magene and XOSS bike computers and
 * watches record. It runs on the phone, free. A file opened with or shared to JoyoFit arrives here through
 * `+native-intent` with its address in the `uri` parameter and is imported at once.
 */
export function FitImportSection() {
  const router = useRouter();
  const { uri } = useLocalSearchParams<{ uri?: string }>();
  const { running, result, run, pick } = useFitImport();
  // One import per incoming address, however often the screen renders or the same intent is delivered again.
  const handled = useRef<string | null>(null);

  useEffect(() => {
    if (!uri || handled.current === uri) return;
    handled.current = uri;
    void run(uri);
  }, [uri, run]);

  return (
    <>
      <Section title="Import a FIT file" icon="bicycle" tint="workouts">
        <AppText variant="caption" muted>
          A ride or run from a bike computer or sports watch, with route, heart rate, speed, power and cadence. Free, runs on this phone.
        </AppText>
        <Button
          label={running ? 'Importing' : 'Choose a .fit file'}
          variant="primary"
          icon="folder-open"
          onPress={() => void pick()}
          loading={running}
        />
        {result ? (
          result.ok ? (
            <Notice
              icon="checkmark-circle"
              action={{
                label: 'Open workout',
                onPress: () => router.push({ pathname: '/workouts/[id]', params: { id: String(result.workoutId) } }),
              }}>
              {result.message}
            </Notice>
          ) : (
            <Notice tone="danger">{result.message}</Notice>
          )
        ) : null}
        <Details title="How does it work?">
          {`Works with the .fit files of iGPSPORT, Garmin, Wahoo, Bryton, Magene and XOSS. ${
            isIos
              ? 'In Files or the app that has the file, choose Share, then JoyoFit.'
              : 'In your file manager or the bike computer app, open the .fit file with JoyoFit, or share it to JoyoFit.'
          } Importing the same file twice adds nothing, and a file that overlaps a workout your watch already recorded is skipped: the workout from the watch is kept. Imported workouts count for strain, readiness and trends, stay on this phone and are not uploaded to the cloud, written to ${HEALTH_APP} or sent to Strava on their own.`}
        </Details>
      </Section>
    </>
  );
}
