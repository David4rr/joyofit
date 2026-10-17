import { useRouter } from 'expo-router';
import { useCallback, useState } from 'react';

import { NavRow } from '@/components/NavRow';
import { Notice } from '@/components/States';
import { SwitchRow } from '@/components/SwitchRow';
import { isCancelled, useHrvProgress } from '@/features/hrv/useHrvProgress';
import { useNativeRefresh } from '@/features/settings/useNativeRefresh';
import { errorMessage, formatDateTime } from '@/format';
import { HuaweiWear } from '@/wear';

/**
 * The watch's automatic stress switch and the way to Measure HRV, inside the Heart rate and sensors section.
 * Turning the switch on runs the calibration minute here; turning it off is immediate.
 */
export function AutomaticStressRows({ connected }: { connected: boolean }) {
  const router = useRouter();
  const [status, setStatus] = useState(() => HuaweiWear.getStressStatus());
  const [calibrating, setCalibrating] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { progress, reset } = useHrvProgress();

  const refresh = useCallback(() => setStatus(HuaweiWear.getStressStatus()), []);
  useNativeRefresh(refresh);

  const change = async (enabled: boolean) => {
    setError(null);
    setBusy(true);
    setCalibrating(enabled);
    if (enabled) reset();
    try {
      setStatus(await HuaweiWear.setAutomaticStress(enabled));
    } catch (e) {
      if (!isCancelled(e)) setError(errorMessage(e));
    } finally {
      setBusy(false);
      setCalibrating(false);
      refresh();
    }
  };

  const hint = !connected
    ? undefined
    : !status.supported
      ? 'This watch does not offer it.'
      : status.enabled
        ? status.lastCalibratedAt !== null
          ? `Calibrated ${formatDateTime(status.lastCalibratedAt)}`
          : undefined
        : 'Takes 1 min to calibrate.';

  return (
    <>
      <SwitchRow
        icon="pulse"
        label="Automatic stress"
        hint={hint}
        value={status.enabled}
        onValueChange={(value) => void change(value)}
        disabled={busy || !connected || !status.supported}
      />
      {calibrating ? (
        <Notice
          action={{
            label: 'Cancel',
            onPress: () => HuaweiWear.cancelHrvMeasurement().catch((e: unknown) => setError(errorMessage(e))),
          }}>
          {progress
            ? `Calibrating: sit still, ${progress.secondsLeft} s left, ${progress.beats} beats so far.`
            : 'Calibrating: sit still with the watch snug. This takes a minute.'}
        </Notice>
      ) : null}
      {error ? <Notice tone="danger">{error}</Notice> : null}
      <NavRow
        icon="pulse"
        tint="heart"
        title="Measure HRV"
        subtitle="1 min, from beat-to-beat intervals"
        onPress={() => router.push('/hrv')}
      />
    </>
  );
}
