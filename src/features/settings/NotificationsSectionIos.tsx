import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';

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
  const { t } = useTranslation('settings');
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
    <Section title={t('notifications.title')} icon="notifications">
      <KeyValue
        icon="phone-portrait"
        label={t('notifications.ios.shared')}
        value={!connected
            ? t('notifications.ios.connectToCheck')
            : access.granted
              ? t('notifications.ios.yes')
              : t('notifications.ios.notYet')}
      />
      {connected && !access.granted ? (
        <Notice>{t('notifications.ios.howTo')}</Notice>
      ) : null}
      <SwitchRow
        icon="notifications"
        label={t('notifications.ios.show')}
        value={access.enabled}
        onValueChange={(enabled) => void toggle(enabled)}
        disabled={!connected}
      />
      {error ? <Notice tone="danger">{error}</Notice> : null}
      <Details>{t('notifications.ios.details')}</Details>
    </Section>
  );
}
