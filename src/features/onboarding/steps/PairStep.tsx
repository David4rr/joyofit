import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { Details } from '@/components/Details';
import { isIos } from '@/components/IosUnavailable';
import { Card } from '@/components/Screen';
import { Notice } from '@/components/States';
import { AvailableWatchesSection } from '@/features/device/AvailableWatchesSection';
import { BindConfirmDialog } from '@/features/device/BindConfirmDialog';
import { isLinkUp } from '@/features/device/linkState';
import { useBluetoothPermission } from '@/features/device/useBluetoothPermission';
import { useBondedDevices } from '@/features/device/useBondedDevices';
import { WatchStatusCard } from '@/features/device/WatchStatusCard';
import { Bullet, StepIntro } from '@/features/onboarding/StepIntro';
import { useWatch } from '@/state/WatchProvider';
import { spacing } from '@/theme';

/**
 * Pairing with the connect list and bind confirmation the Watch tab uses, not a copy of them. Nothing asks for Bluetooth until
 * "Continue": the list (and with it the permission prompt on Android and the first scan on iOS) only mounts after it.
 */
export function PairStep() {
  const { t } = useTranslation('onboarding');
  const { linkState } = useWatch();
  const [started, setStarted] = useState(false);
  const linked = isLinkUp(linkState);

  return (
    <>
      <StepIntro icon="bluetooth" tint="link" title={t('pair.title')}>
        {t('pair.intro')}
      </StepIntro>
      {started || linked ? <PairingList /> : <PrePrompt onContinue={() => setStarted(true)} />}
      {linked ? <Notice icon="checkmark-circle">{t('pair.connected')}</Notice> : null}
      <Details title={t('pair.helpTitle')}>
        {t('pair.help')}
      </Details>
    </>
  );
}

function PrePrompt({ onContinue }: { onContinue: () => void }) {
  const { t } = useTranslation('onboarding');
  return (
    <Card>
      <AppText variant="heading">{t('pair.preTitle')}</AppText>
      <View style={styles.bullets}>
        <Bullet label="1">
          {isIos ? t('pair.pre1Ios') : t('pair.pre1Android')}
        </Bullet>
        <Bullet label="2">{isIos ? t('pair.pre2Ios') : t('pair.pre2Android')}</Bullet>
        <Bullet label="3">
          {isIos ? t('pair.pre3Ios') : t('pair.pre3Android')}
        </Bullet>
      </View>
      <Button label={t('footer.continue')} variant="primary" icon="bluetooth" onPress={onContinue} />
    </Card>
  );
}

/** Owns the permission and device hooks, so they start when this mounts, after the pre-prompt. */
function PairingList() {
  const permission = useBluetoothPermission();
  const bonded = useBondedDevices(permission.status === 'granted');
  return (
    <>
      <WatchStatusCard />
      <ConnectHint />
      <AvailableWatchesSection permission={permission} bonded={bonded} />
      <BindConfirmDialog />
    </>
  );
}

/** What to do right now, by link state: the accept on the watch is the step people miss. */
function ConnectHint() {
  const { t } = useTranslation('onboarding');
  const { linkState, bindRequest } = useWatch();
  if (bindRequest) return null;
  if (linkState === 'connecting' || linkState === 'authenticating' || linkState === 'initializing') {
    return (
      <Notice icon="watch">
        {isIos ? t('pair.keepAwakeIos') : t('pair.keepAwake')}
      </Notice>
    );
  }
  return null;
}

const styles = StyleSheet.create({
  bullets: { gap: spacing.sm },
});
