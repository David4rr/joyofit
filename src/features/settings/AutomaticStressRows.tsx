import { useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';

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
  const { t } = useTranslation(['settings', 'common']);
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

  const unsupported = !status.supported || status.knownSupported === false;
  const hint = !connected
    ? undefined
    : unsupported
      ? t('stress.unavailable')
      : status.enabled
        ? status.lastCalibratedAt !== null
          ? t('stress.calibrated', { when: formatDateTime(status.lastCalibratedAt) })
          : undefined
        : t('stress.calibrate');

  return (
    <>
      <SwitchRow
        icon="pulse"
        label={t('stress.label')}
        hint={hint}
        value={status.enabled}
        onValueChange={(value) => void change(value)}
        disabled={busy || !connected || unsupported}
      />
      {calibrating ? (
        <Notice
          action={{
            label: t('common:actions.cancel'),
            onPress: () => HuaweiWear.cancelHrvMeasurement().catch((e: unknown) => setError(errorMessage(e))),
          }}>
          {progress
            ? t('stress.calibrating', { seconds: progress.secondsLeft, beats: progress.beats })
            : t('stress.calibratingStart')}
        </Notice>
      ) : null}
      {error ? <Notice tone="danger">{error}</Notice> : null}
      <NavRow
        icon="pulse"
        tint="heart"
        title={t('stress.hrvTitle')}
        subtitle={t('stress.hrvSubtitle')}
        onPress={() => router.push('/hrv')}
      />
    </>
  );
}
