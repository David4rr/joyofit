import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { ConfirmDialog } from '@/components/ConfirmDialog';
import { Screen } from '@/components/Screen';
import { holdScreenOn, releaseScreen } from '@/features/strength/keepAwake';
import type { ManualSport } from '@/features/workouts/manual';
import { errorMessage } from '@/format';
import { useRecorder } from '@/state/RecorderProvider';
import { useStrava } from '@/state/StravaProvider';

import { FinishDialog } from './FinishDialog';
import { LiveView } from './LiveView';
import { ReadyView } from './ReadyView';
import { SetupView } from './SetupView';

/** The tag this screen holds the screen on under, so the strength logger's hold is not released with it. */
const KEEP_AWAKE_TAG = 'recording';

type Dialog = 'finish' | 'discard' | null;

/**
 * Recording a workout on the phone. The recording itself lives in `RecorderProvider`, so leaving this screen (back button, gesture, the
 * Workouts tab) leaves it running; only "Buang" ends it without saving. The screen follows the recorder's phase: setup, ready (GPS and
 * sensors connecting), live numbers.
 */
export function RecordScreen() {
  const { t } = useTranslation('workouts');
  const router = useRouter();
  const { snapshot, pause, resume, finish, discard } = useRecorder();
  const { settings } = useStrava();
  const stravaAvailable = settings.connectedAt !== null;

  const [sport, setSport] = useState<ManualSport>('run');
  const [dialog, setDialog] = useState<Dialog>(null);
  const [strava, setStrava] = useState(true);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [discarding, setDiscarding] = useState(false);
  const [leaving, setLeaving] = useState(false);

  const { phase, status } = snapshot;
  const awake = phase === 'ready' || phase === 'active';
  useEffect(() => {
    if (!awake) return;
    void holdScreenOn(KEEP_AWAKE_TAG);
    return () => {
      void releaseScreen(KEEP_AWAKE_TAG);
    };
  }, [awake]);

  /** The clock stops while the person decides, so the minutes in the dialog are not part of the workout. */
  const askFinish = () => {
    if (status === 'recording') pause();
    setDialog('finish');
  };

  const keepGoing = () => {
    setDialog(null);
    if (status === 'paused') resume();
  };

  const save = async () => {
    setSaveError(null);
    setNotice(null);
    try {
      const result = await finish({ strava: stravaAvailable && strava });
      setDialog(null);
      if (result) {
        setLeaving(true);
        router.replace({ pathname: '/workouts/[id]', params: { id: String(result.workoutId) } });
      } else {
        setNotice(t('record.finish.nothing'));
      }
    } catch (e) {
      setDialog(null);
      setSaveError(errorMessage(e));
    }
  };

  const confirmDiscard = async () => {
    setDiscarding(true);
    try {
      await discard();
      setDialog(null);
      setSaveError(null);
      if (router.canGoBack()) router.back();
      else router.replace('/workouts');
    } catch {
      // The recording is still there (the phase did not change): the dialog closes and "Buang" can be tried again.
      setDialog(null);
    } finally {
      setDiscarding(false);
    }
  };

  return (
    <>
      <Screen>
        {leaving ? null : phase === 'idle' ? (
          <SetupView sport={sport} onSport={setSport} notice={notice} />
        ) : phase === 'ready' ? (
          <ReadyView />
        ) : (
          <LiveView
            saving={phase === 'saving'}
            saveError={saveError}
            onFinish={askFinish}
            onSaveAgain={() => void save()}
            onDiscard={() => setDialog('discard')}
          />
        )}
      </Screen>
      <FinishDialog
        visible={dialog === 'finish'}
        live={snapshot.live}
        stravaAvailable={stravaAvailable}
        strava={strava}
        onStrava={setStrava}
        busy={phase === 'saving'}
        onSave={() => void save()}
        onResume={keepGoing}
        onDiscard={() => setDialog('discard')}
      />
      <ConfirmDialog
        visible={dialog === 'discard'}
        title={t('record.finish.discardTitle')}
        message={t('record.finish.discardMessage')}
        confirmLabel={t('record.finish.discardConfirm')}
        destructive
        busy={discarding}
        onConfirm={() => void confirmDiscard()}
        onCancel={() => setDialog(status === 'finished' ? null : 'finish')}
      />
    </>
  );
}
