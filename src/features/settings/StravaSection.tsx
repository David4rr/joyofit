import { Image, StyleSheet } from 'react-native';

import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { KeyValue } from '@/components/KeyValue';
import { PressableScale } from '@/components/PressableScale';
import { Section } from '@/components/Screen';
import { Notice } from '@/components/States';
import { SwitchRow } from '@/components/SwitchRow';
import { DESCRIPTION_LINK } from '@/features/strava/activityFile';
import { formatDateTime } from '@/format';
import { spacing } from '@/theme';
import { useCloud } from '@/state/CloudProvider';
import { useStrava } from '@/state/StravaProvider';

/* Strava's official artwork, unmodified (https://developers.strava.com/guidelines/): button 48 dp high, logo 437 x 37. */
const CONNECT_BUTTON = require('../../../assets/strava/connect-with-strava.png');
const COMPATIBLE_LOGO = require('../../../assets/strava/compatible-with-strava.png');
const BUTTON_SIZE = { width: 237, height: 48 } as const;
const LOGO_HEIGHT = 16;
const LOGO_SIZE = { width: (437 / 37) * LOGO_HEIGHT, height: LOGO_HEIGHT } as const;

/**
 * Send watch workouts to Strava. Free: it needs the JoyoRogo sign-in (the Worker keeps the Strava tokens against that
 * account) but not Pro. Only workouts that finish after connecting go up on their own; older ones are sent one by one
 * from their detail screen.
 */
export function StravaSection() {
  const strava = useStrava();
  const cloud = useCloud();
  const connected = strava.settings.connectedAt !== null;

  return (
    <Section title="Strava" icon="fitness" tint="workouts">
      <AppText variant="caption" muted>
        Send your watch workouts to Strava, with the distance, calories, heart rate and route the watch recorded. It is free
        and does not need JoyoRogo Pro. After you connect, workouts that finish from then on are sent after each sync;
        earlier ones stay on the phone unless you send them from the workout screen. JoyoFit only sends workouts to your
        own Strava account and never reads your Strava activities.
      </AppText>
      {!strava.configured ? (
        <Notice tone="danger">
          This build has no cloud server URL, which Strava needs to connect. Deploy server/ and set
          EXPO_PUBLIC_JOYOFIT_CLOUD_URL, then rebuild.
        </Notice>
      ) : null}
      {strava.configured && strava.serverReady === false ? (
        <Notice tone="danger">Strava is not set up on the JoyoFit server yet, so it cannot be connected.</Notice>
      ) : null}
      {strava.error ? <Notice tone="danger">{strava.error}</Notice> : null}
      {strava.configured && !strava.signedIn && !connected ? (
        <>
          <Notice icon="person-circle">
            Sign in with your JoyoRogo account first. JoyoFit uses it only to keep your Strava connection on its server.
          </Notice>
          <Button
            label="Sign in with JoyoRogo"
            variant="primary"
            icon="log-in-outline"
            onPress={() => void cloud.signIn()}
            disabled={cloud.sessionPending}
            loading={cloud.sessionPending}
          />
        </>
      ) : null}
      {strava.configured && strava.signedIn && !connected ? (
        <PressableScale
          accessibilityRole="button"
          accessibilityLabel="Connect with Strava"
          accessibilityState={{ disabled: strava.busy || strava.serverReady === false, busy: strava.busy }}
          disabled={strava.busy || strava.serverReady === false}
          onPress={() => void strava.connect()}
          style={[styles.connect, (strava.busy || strava.serverReady === false) && styles.dim]}>
          <Image source={CONNECT_BUTTON} style={BUTTON_SIZE} accessibilityIgnoresInvertColors />
        </PressableScale>
      ) : null}
      {connected ? (
        <>
          <KeyValue icon="checkmark-circle" label="Strava" value="Connected" />
          <KeyValue
            icon="time"
            label="Sending workouts since"
            value={strava.settings.connectedAt ? formatDateTime(strava.settings.connectedAt) : null}
          />
          <SwitchRow
            label={`Add ${DESCRIPTION_LINK} to the description`}
            hint="Plain text in the activity description. Never in the title. Off by default."
            value={strava.settings.addLink}
            onValueChange={(on) => void strava.setAddLink(on)}
          />
          <Button
            label="Disconnect Strava"
            variant="destructive"
            icon="unlink"
            onPress={() => void strava.disconnect()}
            disabled={strava.busy || !strava.signedIn}
            loading={strava.busy}
          />
          {!strava.signedIn ? (
            <AppText variant="caption" muted>
              Sign in with JoyoRogo to disconnect or to send workouts.
            </AppText>
          ) : null}
        </>
      ) : null}
      <Image
        source={COMPATIBLE_LOGO}
        style={[LOGO_SIZE, styles.logo]}
        accessibilityLabel="Compatible with Strava"
        accessibilityIgnoresInvertColors
      />
      <AppText variant="caption" muted>
        Compatible with Strava. JoyoFit is not made, sponsored or endorsed by Strava. What you send follows your Strava
        privacy settings; you can remove JoyoFit any time in Strava under Settings, My Apps.
      </AppText>
    </Section>
  );
}

const styles = StyleSheet.create({
  connect: { alignSelf: 'flex-start', height: BUTTON_SIZE.height, marginVertical: spacing.xs },
  dim: { opacity: 0.5 },
  logo: { alignSelf: 'flex-start', marginTop: spacing.sm },
});
