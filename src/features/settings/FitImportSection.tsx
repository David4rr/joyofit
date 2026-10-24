import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';

import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { Details } from '@/components/Details';
import { isIos } from '@/components/IosUnavailable';
import { Section } from '@/components/Screen';
import { Notice } from '@/components/States';
import { useFitImport } from '@/features/fitimport/useFitImport';
import { OPEN_IN_STACK } from '@/components/navigation';

const HEALTH_APP = isIos ? 'Apple Health' : 'Health Connect';

/**
 * Import a ride or run from a `.fit` file: the file iGPSPORT, Garmin, Wahoo, Bryton, Magene and XOSS bike computers and
 * watches record. It runs on the phone, free. A file opened with or shared to JoyoFit arrives here through
 * `+native-intent` with its address in the `uri` parameter and is imported at once.
 */
export function FitImportSection() {
  const { t } = useTranslation('settings');
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
      <Section title={t('fitImport.title')} icon="bicycle" tint="workouts">
        <AppText variant="caption" muted>
          {t('fitImport.intro')}
        </AppText>
        <Button
          label={running ? t('fitImport.importing') : t('fitImport.choose')}
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
                label: t('fitImport.openWorkout'),
                onPress: () => router.push({ pathname: '/workouts/[id]', params: { id: String(result.workoutId) } }, OPEN_IN_STACK),
              }}>
              {result.message}
            </Notice>
          ) : (
            <Notice tone="danger">{result.message}</Notice>
          )
        ) : null}
        <Details title={t('fitImport.howTitle')}>
          {t('fitImport.details', {
            share: isIos ? t('fitImport.shareIos') : t('fitImport.shareAndroid'),
            app: HEALTH_APP,
          })}
        </Details>
      </Section>
    </>
  );
}
