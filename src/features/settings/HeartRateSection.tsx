import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { AppText } from '@/components/AppText';
import { Details } from '@/components/Details';
import { Divider, Section } from '@/components/Screen';
import { Segmented } from '@/components/Segmented';
import { Notice } from '@/components/States';
import { SwitchRow } from '@/components/SwitchRow';
import { AutomaticStressRows } from '@/features/settings/AutomaticStressRows';
import { useNativeRefresh } from '@/features/settings/useNativeRefresh';
import { errorMessage } from '@/format';
import { HuaweiWear, type HealthSensorsUpdate } from '@/wear';

// The thresholds Gadgetbridge offers: high 100 to 150, low 40 to 50 bpm (0 = off).
const HIGH_ALERTS = [0, 100, 120, 140, 150] as const;
const LOW_ALERTS = [0, 40, 45, 50] as const;

/**
 * The watch's own heart rate, SpO2 and sleep sensors. They are sent to the watch on every connect;
 * a change here is sent at once when the watch is connected. Without continuous heart rate the
 * watch records no heart rate and Today shows none.
 */
export function HeartRateSection() {
  const { t } = useTranslation(['settings', 'common']);
  const alertOptions = (values: readonly number[]) =>
    values.map((value) => ({ value, label: value === 0 ? t('common:state.off') : String(value) }));
  const [sensors, setSensors] = useState(() => HuaweiWear.getHealthSensors());
  const [error, setError] = useState<string | null>(null);
  const [notSent, setNotSent] = useState(false);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(() => setSensors(HuaweiWear.getHealthSensors()), []);
  useNativeRefresh(refresh);

  const change = async (patch: Partial<HealthSensorsUpdate>) => {
    const current: HealthSensorsUpdate = {
      automaticHeartRate: sensors.automaticHeartRate,
      automaticSpo2: sensors.automaticSpo2,
      truSleep: sensors.truSleep,
      highHeartRateAlert: sensors.highHeartRateAlert,
      lowHeartRateAlert: sensors.lowHeartRateAlert,
    };
    setBusy(true);
    setError(null);
    try {
      const sent = await HuaweiWear.setHealthSensors({ ...current, ...patch });
      // Not connected (or the watch gave no answer): the choice is stored and goes out on the next connect.
      setNotSent(!sent);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
      refresh();
    }
  };

  const supported = sensors.supported;
  // Capabilities are only known while connected; until then everything stays switchable.
  const off = (key: keyof NonNullable<typeof supported>) => supported !== null && !supported[key];
  const hint = (key: keyof NonNullable<typeof supported>) => (off(key) ? t('heartRate.unsupported') : undefined);

  return (
    <Section title={t('heartRate.title')} icon="heart" tint="heart">
      <SwitchRow
        icon="heart"
        label={t('heartRate.continuous')}
        hint={hint('heartRate')}
        value={sensors.automaticHeartRate}
        onValueChange={(value) => change({ automaticHeartRate: value })}
        disabled={busy || off('heartRate')}
      />
      <SwitchRow
        icon="water"
        label={t('heartRate.spo2')}
        hint={hint('spo2')}
        value={sensors.automaticSpo2}
        onValueChange={(value) => change({ automaticSpo2: value })}
        disabled={busy || off('spo2')}
      />
      <SwitchRow
        icon="moon"
        label={t('heartRate.sleep')}
        hint={hint('truSleep')}
        value={sensors.truSleep}
        onValueChange={(value) => change({ truSleep: value })}
        disabled={busy || off('truSleep')}
      />
      <AutomaticStressRows connected={supported !== null} />
      <Divider />
      <AppText variant="bodyStrong">{t('heartRate.highAlert')}</AppText>
      {off('highHeartRateAlert') ? (
        <AppText variant="caption" muted>
          {t('heartRate.unsupported')}
        </AppText>
      ) : null}
      <Segmented
        options={alertOptions(HIGH_ALERTS)}
        value={sensors.highHeartRateAlert}
        onChange={(value) => change({ highHeartRateAlert: value })}
        disabled={busy || off('highHeartRateAlert') || !sensors.automaticHeartRate}
      />
      <AppText variant="bodyStrong">{t('heartRate.lowAlert')}</AppText>
      {off('lowHeartRateAlert') ? (
        <AppText variant="caption" muted>
          {t('heartRate.unsupported')}
        </AppText>
      ) : null}
      <Segmented
        options={alertOptions(LOW_ALERTS)}
        value={sensors.lowHeartRateAlert}
        onChange={(value) => change({ lowHeartRateAlert: value })}
        disabled={busy || off('lowHeartRateAlert') || !sensors.automaticHeartRate}
      />
      {supported === null ? (
        <Notice>{t('heartRate.notConnected')}</Notice>
      ) : notSent ? (
        <Notice>{t('heartRate.notConfirmed')}</Notice>
      ) : null}
      {error ? <Notice tone="danger">{error}</Notice> : null}
      <Details>
        {(['continuous', 'spo2', 'sleep', 'stress', 'high', 'low'] as const).map((key) => t(`heartRate.details.${key}`)).join(' ')}
      </Details>
    </Section>
  );
}
