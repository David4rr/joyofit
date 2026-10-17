import { Image, StyleSheet } from 'react-native';

import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { Details } from '@/components/Details';
import { KeyValue } from '@/components/KeyValue';
import { PressableScale } from '@/components/PressableScale';
import { Section } from '@/components/Screen';
import { Notice } from '@/components/States';
import { SwitchRow } from '@/components/SwitchRow';
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
        Send watch workouts to Strava. Free, no JoyoRogo Pro needed.
      </AppText>
      <Details title="How does it work?">
        Workouts go to Strava with the distance, calories, heart rate and route the watch recorded. After you connect,
        workouts that finish from then on are sent after each sync; earlier ones stay on the phone unless you send them
        from the workout screen. JoyoFit only sends workouts to your own Strava account and never reads your Strava
        activities.
      </Details>
      {!strava.configured ? (
        <Notice tone="danger">
          No cloud server URL in this build, which Strava needs. Deploy server/, set EXPO_PUBLIC_JOYOFIT_CLOUD_URL, rebuild.
        </Notice>
      ) : null}
      {strava.configured && strava.serverReady === false ? (
        <Notice tone="danger">Strava is not set up on the JoyoFit server yet.</Notice>
      ) : null}
      {strava.error ? <Notice tone="danger">{strava.error}</Notice> : null}
      {strava.configured && !strava.signedIn && !connected ? (
        <>
          <Notice icon="person-circle">
            Sign in with JoyoRogo first; it only keeps your Strava connection on the server.
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
          <KeyValue
            icon="checkmark-circle"
            label="Connected, sending since"
            value={strava.settings.connectedAt ? formatDateTime(strava.settings.connectedAt) : null}
          />
          <SwitchRow
            label="Add fit.joyorogo.com to the description"
            hint="Plain text, never in the title."
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
              Sign in with JoyoRogo to disconnect or send.
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
      <Details>
        Compatible with Strava. JoyoFit is not made, sponsored or endorsed by Strava. What you send follows your Strava
        privacy settings; you can remove JoyoFit any time in Strava under Settings, My Apps.
      </Details>
    </Section>
  );
}

const styles = StyleSheet.create({
  connect: { alignSelf: 'flex-start', height: BUTTON_SIZE.height, marginVertical: spacing.xs },
  dim: { opacity: 0.5 },
  logo: { alignSelf: 'flex-start' },
});
