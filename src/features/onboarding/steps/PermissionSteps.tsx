import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Linking, Modal, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { isIos } from '@/components/IosUnavailable';
import { Notice } from '@/components/States';
import { StepIntro } from '@/features/onboarding/StepIntro';
import { BackgroundSection } from '@/features/settings/BackgroundSection';
import { HealthConnectSection } from '@/features/settings/HealthConnectSection';
import { NotificationAppList } from '@/features/settings/NotificationAppList';
import { NotificationsSection } from '@/features/settings/NotificationsSection';
import { WeatherSection } from '@/features/settings/WeatherSection';
import { spacing, useColors } from '@/theme';

const HEALTH_STORE = isIos ? 'Apple Health' : 'Health Connect'; // i18n-ok: platform brand names

/**
 * Android: notification access, forwarding and the morning summary, then the per-app list (a full-screen list, so it opens over the guide
 * instead of inside the scrolling step). iOS: the watch reads the iPhone's notifications itself (ANCS), which the shared section explains
 * and checks.
 */
export function NotificationsStep() {
  const { t } = useTranslation('onboarding');
  const [choosingApps, setChoosingApps] = useState(false);
  return (
    <>
      <StepIntro icon="notifications" title={t('notifications.title')} badge={t('badge.optional')}>
        {isIos ? t('notifications.introIos') : t('notifications.introAndroid')}
      </StepIntro>
      {isIos ? (
        <Notice icon="information-circle">
          {t('notifications.iosNotice')}
        </Notice>
      ) : null}
      <NotificationsSection />
      {isIos ? null : (
        <>
          <Button label={t('notifications.chooseApps')} variant="secondary" icon="apps" onPress={() => setChoosingApps(true)} />
          <AppsModal visible={choosingApps} onClose={() => setChoosingApps(false)} />
        </>
      )}
    </>
  );
}

function AppsModal({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const { t } = useTranslation(['onboarding', 'common']);
  const colors = useColors();
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={[styles.modal, { backgroundColor: colors.background, paddingTop: insets.top, paddingBottom: insets.bottom }]}>
        <View style={styles.modalHeader}>
          <AppText variant="heading" style={styles.modalTitle} accessibilityRole="header">
            {t('notifications.appsTitle')}
          </AppText>
          <Button label={t('common:actions.done')} variant="primary" onPress={onClose} />
        </View>
        {visible ? <NotificationAppList /> : null}
      </View>
    </Modal>
  );
}

export function HealthStep() {
  const { t } = useTranslation('onboarding');
  return (
    <>
      <StepIntro icon="heart" tint="heart" title={t('health.title', { store: HEALTH_STORE })} badge={t('badge.optional')}>
        {t('health.intro', { store: HEALTH_STORE })}
      </StepIntro>
      <HealthConnectSection />
    </>
  );
}

export function WeatherStep() {
  const { t } = useTranslation('onboarding');
  return (
    <>
      <StepIntro icon="partly-sunny" title={t('weather.title')} badge={t('badge.optional')}>
        {t('weather.intro')}
      </StepIntro>
      <WeatherSection />
    </>
  );
}

/** Android only. JoyoFit keeps the link up with a foreground service; some phone makers stop those, which the notice explains. */
export function BackgroundStep() {
  const { t } = useTranslation('onboarding');
  return (
    <>
      <StepIntro icon="sync" tint="link" title={t('background.title')} badge={t('badge.optional')}>
        {t('background.intro')}
      </StepIntro>
      <BackgroundSection />
      <Notice icon="battery-charging">
        {t('background.notice')}
      </Notice>
      <Button label={t('background.openSettings')} variant="secondary" icon="settings" onPress={() => void Linking.openSettings()} />
    </>
  );
}

const styles = StyleSheet.create({
  modal: { flex: 1 },
  modalHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm },
  modalTitle: { flex: 1 },
});
