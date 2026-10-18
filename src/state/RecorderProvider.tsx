import { useSQLiteContext } from 'expo-sqlite';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useSyncExternalStore, type ReactNode } from 'react';
import { AppState } from 'react-native';

import { BleSensors } from '@/ble';
import { cloudLog as log } from '@/cloud/log';
import { fmtDecimal, t } from '@/i18n';
import { afterRecordingSaved } from '@/features/record/afterSave';
import { RecordingController, type FinishResult, type RecordingSnapshot } from '@/features/record/controller';
import type { EnergyProfile, Sex } from '@/features/record/energy';
import type { LiveStats } from '@/features/record/recorder';
import { sensorHub } from '@/features/sensors/instance';
import { getWheelMm } from '@/features/sensors/settings';
import { userWeightKg } from '@/features/strength/profile';
import { DEFAULT_AGE } from '@/features/workouts/substrate';
import { formatElapsed } from '@/features/workouts/summary';
import type { ManualSport } from '@/features/workouts/manual';
import { useSensors } from '@/state/SensorsProvider';
import { useWatch } from '@/state/WatchProvider';
import { HuaweiWear } from '@/wear';

export interface RecorderContextValue {
  snapshot: RecordingSnapshot;
  /** Gets ready to record `sport` (native session, GPS, sensors). `title` is the Android notification title. Rejects with ERR_LOCATION_PERMISSION for an outdoor sport without precise location; ask first (`ensureLocation`). */
  prepare: (sport: ManualSport, title: string) => Promise<void>;
  cancel: () => Promise<void>;
  start: () => void;
  pause: () => void;
  resume: () => void;
  lap: () => void;
  /**
   * Ends and saves the workout, then reports the data change (cloud sync, lists) and runs the follow-ups (JoyoRogo energy, Strava when
   * `strava` is true). Resolves with the new workout's id, or null when nothing was recorded. Rejects when saving fails; the
   * recording is kept (`snapshot.status` is `finished`) and `finish` can be called again.
   */
  finish: (options: { strava: boolean }) => Promise<FinishResult | null>;
  discard: () => Promise<void>;
}

const RecorderContext = createContext<RecorderContextValue | null>(null);

export function useRecorder(): RecorderContextValue {
  const value = useContext(RecorderContext);
  if (!value) throw new Error('useRecorder must be used inside <RecorderProvider>');
  return value;
}

/** The profile the energy estimate runs on: the saved weight (or the default), age from the birth year, sex. */
function energyProfile(): EnergyProfile {
  const profile = HuaweiWear.getUserProfile();
  const age = profile?.birthYear ? new Date().getFullYear() - profile.birthYear : DEFAULT_AGE;
  const sex: Sex = profile?.sex === 'male' || profile?.sex === 'female' ? profile.sex : 'unknown';
  return { weightKg: userWeightKg(), age: Math.min(100, Math.max(10, age)), sex };
}

function notificationText(live: LiveStats): string {
  const time = formatElapsed(live.movingSec);
  const distance = live.distanceM >= 10 ? `${fmtDecimal(live.distanceM / 1000, 2)} km` : null;
  if (distance && live.hr !== null) return t('workouts:record.notification.timeDistanceHr', { time, distance, hr: live.hr });
  if (distance) return t('workouts:record.notification.timeDistance', { time, distance });
  if (live.hr !== null) return t('workouts:record.notification.timeHr', { time, hr: live.hr });
  return time;
}

/**
 * The phone-recorded workout (see `features/record/controller.ts`) for the whole app: the recording survives leaving the screen, and a
 * recording the app lost (killed, crashed) is brought back, paused, when the app opens. Must sit inside `SensorsProvider`.
 */
export function RecorderProvider({ children }: { children: ReactNode }) {
  const db = useSQLiteContext();
  const { saved } = useSensors();
  const { dataChanged } = useWatch();
  const savedRef = useRef(saved);
  savedRef.current = saved;

  const controller = useMemo(
    () =>
      new RecordingController({
        hub: sensorHub,
        session: {
          start: (options) => BleSensors.startWorkoutSession(options),
          update: (text) => BleSensors.updateWorkoutSession(text),
          end: () => BleSensors.endWorkoutSession(),
        },
        db,
        now: Date.now,
        profile: energyProfile,
        wheelCircumferenceM: () => getWheelMm() / 1000,
        sensors: () => savedRef.current,
        notificationText,
        log: (message) => log(`recording: ${message}`),
      }),
    [db],
  );

  const snapshot = useSyncExternalStore(controller.subscribe, controller.getSnapshot);

  useEffect(() => {
    void sensorHub.start().then(() => controller.restore()).catch((error) => log(`recording restore failed: ${String(error)}`, 'error'));
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') controller.tick();
    });
    return () => sub.remove();
  }, [controller]);

  const finish = useCallback(
    async (options: { strava: boolean }) => {
      const result = await controller.finish();
      if (result) {
        dataChanged();
        void afterRecordingSaved(db, result.workoutId, options);
      }
      return result;
    },
    [controller, dataChanged, db],
  );

  const value = useMemo<RecorderContextValue>(
    () => ({
      snapshot,
      prepare: (sport, title) => controller.prepare(sport, title),
      cancel: () => controller.cancel(),
      start: () => controller.start(),
      pause: () => controller.pause(),
      resume: () => controller.resume(),
      lap: () => controller.lap(),
      finish,
      discard: () => controller.discard(),
    }),
    [controller, finish, snapshot],
  );

  return <RecorderContext.Provider value={value}>{children}</RecorderContext.Provider>;
}
