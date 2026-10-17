import { useState } from 'react';
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
  const { linkState } = useWatch();
  const [started, setStarted] = useState(false);
  const linked = isLinkUp(linkState);

  return (
    <>
      <StepIntro icon="bluetooth" tint="link" title="Pair your watch">
        Connect the watch to JoyoFit. The first time, the watch asks you to confirm on its own screen.
      </StepIntro>
      {started || linked ? <PairingList /> : <PrePrompt onContinue={() => setStarted(true)} />}
      {linked ? <Notice icon="checkmark-circle">Connected. Continue to read your history from the watch.</Notice> : null}
      <Details title="The watch refuses to pair?">
        {
          'Check that it is unbound from Huawei Health and not connected to another phone or app, that it is awake and close, and try Connect again. If it still refuses after a restart of the watch, a reset of the watch from its own Settings is the last resort. A reset erases the data stored on the watch (workouts and days that were never synced), so sync first if you can, and do not start here.'
        }
      </Details>
    </>
  );
}

function PrePrompt({ onContinue }: { onContinue: () => void }) {
  return (
    <Card>
      <AppText variant="heading">What happens next</AppText>
      <View style={styles.bullets}>
        <Bullet label="1">
          {isIos
            ? 'iOS asks whether JoyoFit may use Bluetooth. Allow it: that is how the watch is found.'
            : 'Android asks whether JoyoFit may find and connect to nearby devices. Allow it: that is how the watch is found.'}
        </Bullet>
        <Bullet label="2">{isIos ? 'Pick your watch in the list and tap Connect.' : 'Pick your watch in the list (or scan for it) and tap Connect.'}</Bullet>
        <Bullet label="3">
          {isIos
            ? 'Confirm the pairing in JoyoFit, accept the prompt on the watch, then tap Pair when iOS shows its pairing request.'
            : 'Confirm the pairing in JoyoFit, then accept the prompt on the watch.'}
        </Bullet>
      </View>
      <Button label="Continue" variant="primary" icon="bluetooth" onPress={onContinue} />
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
  const { linkState, bindRequest } = useWatch();
  if (bindRequest) return null;
  if (linkState === 'connecting' || linkState === 'authenticating' || linkState === 'initializing') {
    return (
      <Notice icon="watch">
        Keep the watch awake. When its screen asks to pair, accept it on the watch
        {isIos ? ', then tap Pair if iOS shows its pairing request' : ''}. This can take up to a minute.
      </Notice>
    );
  }
  return null;
}

const styles = StyleSheet.create({
  bullets: { gap: spacing.sm },
});
