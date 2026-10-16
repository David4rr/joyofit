import { useCallback, useState } from 'react';

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
      <Notice icon="information-circle">
        iOS does not let JoyoFit read or forward your notifications. Instead the watch reads them from the iPhone itself, over
        Bluetooth, when iOS allows it. JoyoFit never sees their content.
      </Notice>
      <KeyValue
        icon="phone-portrait"
        label="iPhone shares notifications with the watch"
        value={!connected ? 'Connect the watch to check' : access.granted ? 'Yes' : 'Not yet'}
      />
      {connected && !access.granted ? (
        <Notice>
          On the iPhone open Settings, Bluetooth, tap the i next to your watch and turn on Show Notifications. If iOS asks whether the
          watch may display notifications, allow it. Which apps appear is chosen in Settings, Notifications.
        </Notice>
      ) : null}
      <SwitchRow
        icon="notifications"
        label="Show notifications on the watch"
        hint="Switches the watch's own notification setting, the one Huawei Health sets. Left alone until you change it here."
        value={access.enabled}
        onValueChange={(enabled) => void toggle(enabled)}
        disabled={!connected}
      />
      <Notice>The morning summary notification is not available on iOS yet.</Notice>
      {error ? <Notice tone="danger">{error}</Notice> : null}
    </Section>
  );
}
