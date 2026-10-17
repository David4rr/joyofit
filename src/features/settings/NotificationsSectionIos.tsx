import { useCallback, useState } from 'react';

import { Details } from '@/components/Details';
import { KeyValue } from '@/components/KeyValue';
import { Section } from '@/components/Screen';
import { Notice } from '@/components/States';
import { SwitchRow } from '@/components/SwitchRow';
import { useNativeRefresh } from '@/features/settings/useNativeRefresh';
import { errorMessage } from '@/format';
import { useWatch } from '@/state/WatchProvider';
import { HuaweiWear } from '@/wear';

/**
 * iOS does not let an app read other apps' notifications, so JoyoFit cannot forward them. The watch reads the iPhone's notifications
 * itself (Apple's notification service, ANCS) once iOS shares them with it; JoyoFit switches the watch's notification setting and
 * shows whether iOS shares them. Which apps appear is decided in iPhone Settings > Notifications.
 */
export function NotificationsSectionIos() {
  const { linkState } = useWatch();
  const connected = linkState === 'connected' || linkState === 'syncing';
  const [access, setAccess] = useState(() => HuaweiWear.getNotificationAccess());
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(() => setAccess(HuaweiWear.getNotificationAccess()), []);
  useNativeRefresh(refresh);

  const toggle = async (enabled: boolean) => {
    setError(null);
    try {
      await HuaweiWear.setNotificationsEnabled(enabled);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      refresh();
    }
  };

  return (
    <Section title="Notifications" icon="notifications">
      <KeyValue
        icon="phone-portrait"
        label="iPhone shares them with watch"
        value={!connected ? 'Connect the watch to check' : access.granted ? 'Yes' : 'Not yet'}
      />
      {connected && !access.granted ? (
        <Notice>iPhone Settings, Bluetooth, tap i next to the watch, turn on Show Notifications. Allow it if iOS asks.</Notice>
      ) : null}
      <SwitchRow
        icon="notifications"
        label="Show notifications on the watch"
        value={access.enabled}
        onValueChange={(enabled) => void toggle(enabled)}
        disabled={!connected}
      />
      {error ? <Notice tone="danger">{error}</Notice> : null}
      <Details>
        {"iOS does not let JoyoFit read or forward your notifications. The watch reads them from the iPhone itself, over Bluetooth, when iOS allows it; JoyoFit never sees their content. Which apps appear is chosen in iPhone Settings, Notifications.\n\nThe switch changes the watch's own notification setting, the one Huawei Health sets. It is left alone until you change it here.\n\nThe morning summary notification is not available on iOS yet."}
      </Details>
    </Section>
  );
}
