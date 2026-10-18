import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { PermissionsAndroid, Platform } from 'react-native';

import { AppText } from '@/components/AppText';
import { Details } from '@/components/Details';
import { Section } from '@/components/Screen';
import { Segmented } from '@/components/Segmented';
import { SwitchRow } from '@/components/SwitchRow';
import { Notice } from '@/components/States';
import { ensureBluetoothConnect } from '@/features/device/useBluetoothPermission';
import { Pair, PairGrid } from '@/features/settings/PairGrid';
import { useBackgroundStatus } from '@/features/settings/useBackgroundStatus';
import { errorMessage } from '@/format';
import { HuaweiWear } from '@/wear';

/** Android 13 (API 33) introduced the runtime POST_NOTIFICATIONS permission. */
const RUNTIME_NOTIFICATION_API = 33;

/** Sync interval choices in minutes; the labels are built at render time. */
const INTERVAL_MINUTES = [15, 30, 60, 120, 240] as const;

export function BackgroundSection() {
  const { t } = useTranslation('settings');
  const { status, refresh } = useBackgroundStatus();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notificationHidden, setNotificationHidden] = useState(false);

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
      refresh();
    }
  };

  const toggle = (next: boolean) =>
    run(async () => {
      if (!next) {
        await HuaweiWear.setBackgroundEnabled(null);
        return;
      }
      if (!status.address) return;
      setNotificationHidden(false);
      if (Platform.OS === 'android' && Number(Platform.Version) >= RUNTIME_NOTIFICATION_API) {
        const result = await PermissionsAndroid.request(
          PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS,
        );
        setNotificationHidden(result !== PermissionsAndroid.RESULTS.GRANTED);
      }
      if ((await ensureBluetoothConnect()) !== 'granted') {
        setError(t('background.btRequired'));
        return;
      }
      await HuaweiWear.setBackgroundEnabled(status.address);
    });

  return (
    <Section title={t('background.title')} icon="sync">
      <SwitchRow
        icon="sync"
        label={t('background.stay')}
        hint={!status.address ? t('background.connectFirst') : undefined}
        value={status.enabled}
        onValueChange={toggle}
        disabled={busy || (!status.enabled && !status.address)}
      />
      {notificationHidden ? (
        <Notice>{t('background.notifDenied')}</Notice>
      ) : null}
      {error ? <Notice tone="danger">{error}</Notice> : null}
      <PairGrid>
        <Pair label={t('background.watch')} value={status.name ?? status.address} />
        <Pair label={t('background.service')} value={status.running ? t('background.running') : t('background.stopped')} />
        {status.enabled ? <Pair label={t('background.autoReconnect')} value={status.paused ? t('background.paused') : t('background.active')} /> : null}
      </PairGrid>
      {status.enabled && status.paused ? <Notice>{t('background.pausedNotice')}</Notice> : null}
      <AppText variant="label" muted>
        {t('background.interval')}
      </AppText>
      <Segmented
        options={INTERVAL_MINUTES.map((value) => ({
          value,
          label: value >= 60 ? t('background.intervals.h', { count: value / 60 }) : t('background.intervals.m', { count: value }),
        }))}
        value={status.syncIntervalMinutes}
        onChange={(minutes) => run(() => HuaweiWear.setSyncIntervalMinutes(minutes))}
        disabled={busy}
      />
      <Details>{t('background.details')}</Details>
    </Section>
  );
}
