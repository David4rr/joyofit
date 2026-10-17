import { useCallback, useState } from 'react';
import { Alert, PermissionsAndroid, Platform } from 'react-native';

import { Button } from '@/components/Button';
import { Details } from '@/components/Details';
import { KeyValue } from '@/components/KeyValue';
import { Section } from '@/components/Screen';
import { Notice } from '@/components/States';
import { SwitchRow } from '@/components/SwitchRow';
import { isIos } from '@/components/IosUnavailable';
import { useNativeRefresh } from '@/features/settings/useNativeRefresh';
import { NotificationsSectionIos } from '@/features/settings/NotificationsSectionIos';
import { errorMessage } from '@/format';
import { HuaweiWear } from '@/wear';

/** Android 13 (API 33) introduced the runtime POST_NOTIFICATIONS permission. */
const RUNTIME_NOTIFICATION_API = 33;

/** Shown before Android's notification-access screen: what is read, where it goes, what is kept. */
const DISCLOSURE =
  'JoyoFit reads the notifications on this phone (app name, title and text) so it can show them on your watch. ' +
  'They are sent to the watch over Bluetooth only. JoyoFit does not store them and does not send them over the internet. ' +
  'You can choose which apps are forwarded, and turn this off at any time.';

export function NotificationsSection() {
  return isIos ? <NotificationsSectionIos /> : <NotificationsSectionAndroid />;
}

function NotificationsSectionAndroid() {
  const [access, setAccess] = useState(() => HuaweiWear.getNotificationAccess());
  const [morning, setMorning] = useState(() => HuaweiWear.getMorningSummaryEnabled());
  const [morningDenied, setMorningDenied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(() => setAccess(HuaweiWear.getNotificationAccess()), []);
  useNativeRefresh(refresh);

  const run = async (action: () => Promise<void>) => {
    setError(null);
    try {
      await action();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      refresh();
    }
  };

  const toggleMorning = (next: boolean) =>
    run(async () => {
      setMorningDenied(false);
      if (next && Platform.OS === 'android' && Number(Platform.Version) >= RUNTIME_NOTIFICATION_API) {
        const result = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS);
        setMorningDenied(result !== PermissionsAndroid.RESULTS.GRANTED);
      }
      await HuaweiWear.setMorningSummaryEnabled(next);
      setMorning(next);
    });

  return (
    <Section title="Notifications" icon="notifications">
      <KeyValue icon="key" label="Notification access" value={access.granted ? 'Granted' : 'Not granted'} />
      <Button
        label="Open access settings"
        variant="secondary"
        icon="open-outline"
        onPress={() =>
          Alert.alert('Read your notifications?', DISCLOSURE, [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Continue', onPress: () => void run(() => HuaweiWear.openNotificationAccess()) },
          ])
        }
      />
      {HuaweiWear.distribution === 'sideload' ? (
        <Notice>Android 13+: first allow restricted settings (App info, menu, Allow restricted settings).</Notice>
      ) : null}
      <SwitchRow
        icon="notifications"
        label="Forward to the watch"
        hint={access.granted ? undefined : 'Grant access first.'}
        value={access.enabled}
        onValueChange={(enabled) => run(() => HuaweiWear.setNotificationsEnabled(enabled))}
        disabled={!access.granted}
      />
      <SwitchRow
        icon="sunny"
        label="Morning summary"
        value={morning}
        onValueChange={toggleMorning}
      />
      {morning && morningDenied ? (
        <Notice>Notification permission denied: the summary cannot be shown.</Notice>
      ) : null}
      {error ? <Notice tone="danger">{error}</Notice> : null}
      <Details>
        {"Forwarding sends the app name, title and text of each notification to the watch over Bluetooth only. Nothing is stored or sent over the internet. Choose which apps are forwarded in Notification apps.\n\nMorning summary: once a day after the sync that brings in last night's sleep, with time asleep and HRV against your usual."}
      </Details>
    </Section>
  );
}
