import { useState } from 'react';
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

const HEALTH_STORE = isIos ? 'Apple Health' : 'Health Connect';

/**
 * Android: notification access, forwarding and the morning summary, then the per-app list (a full-screen list, so it opens over the guide
 * instead of inside the scrolling step). iOS: the watch reads the iPhone's notifications itself (ANCS), which the shared section explains
 * and checks.
 */
export function NotificationsStep() {
  const [choosingApps, setChoosingApps] = useState(false);
  return (
    <>
      <StepIntro icon="notifications" title="Notifications on the watch" badge="Optional">
        {isIos
          ? 'The watch shows your iPhone notifications itself, over Bluetooth. iOS only shares them once you allow it for the watch.'
          : 'JoyoFit can show your phone notifications on the watch. Android asks you to grant notification access to JoyoFit first.'}
      </StepIntro>
      {isIos ? (
        <Notice icon="information-circle">
          On the iPhone open Settings, Bluetooth, tap the i next to your watch and turn on Show Notifications. Which apps appear is chosen in
          iPhone Settings, Notifications.
        </Notice>
      ) : null}
      <NotificationsSection />
      {isIos ? null : (
        <>
          <Button label="Choose which apps are forwarded" variant="secondary" icon="apps" onPress={() => setChoosingApps(true)} />
          <AppsModal visible={choosingApps} onClose={() => setChoosingApps(false)} />
        </>
      )}
    </>
  );
}

function AppsModal({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={[styles.modal, { backgroundColor: colors.background, paddingTop: insets.top, paddingBottom: insets.bottom }]}>
        <View style={styles.modalHeader}>
          <AppText variant="heading" style={styles.modalTitle} accessibilityRole="header">
            Notification apps
          </AppText>
          <Button label="Done" variant="primary" onPress={onClose} />
        </View>
        {visible ? <NotificationAppList /> : null}
      </View>
    </Modal>
  );
}

export function HealthStep() {
  return (
    <>
      <StepIntro icon="heart" tint="heart" title={`Share with ${HEALTH_STORE}`} badge="Optional">
        {`JoyoFit can write your steps, heart rate, blood oxygen, sleep and workouts to ${HEALTH_STORE} after every sync, so other apps such as JoyoRogo can read them. Nothing is shared until you switch it on and allow it.`}
      </StepIntro>
      <HealthConnectSection />
    </>
  );
}

export function WeatherStep() {
  return (
    <>
      <StepIntro icon="partly-sunny" title="Weather on the watch" badge="Optional">
        JoyoFit can send the forecast to the watch. It needs this phone&apos;s location, or you can pick a city and share no location at
        all.
      </StepIntro>
      <WeatherSection />
    </>
  );
}

/** Android only. JoyoFit keeps the link up with a foreground service; some phone makers stop those, which the notice explains. */
export function BackgroundStep() {
  return (
    <>
      <StepIntro icon="sync" tint="link" title="Stay connected in the background" badge="Optional">
        With this on, JoyoFit keeps the watch connected and syncs on a timer while the app is closed, so Today is current when you open it.
      </StepIntro>
      <BackgroundSection />
      <Notice icon="battery-charging">
        Some phones (Huawei, Honor, Xiaomi, Oppo, Vivo, Samsung and others) stop background apps to save battery. If the watch keeps
        disconnecting while the screen is off, open JoyoFit&apos;s app settings, go to Battery and choose Unrestricted or No restrictions.
      </Notice>
      <Button label="Open app settings" variant="secondary" icon="settings" onPress={() => void Linking.openSettings()} />
    </>
  );
}

const styles = StyleSheet.create({
  modal: { flex: 1 },
  modalHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm },
  modalTitle: { flex: 1 },
});
