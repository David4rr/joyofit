import { useTranslation } from 'react-i18next';
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
  const { t } = useTranslation('settings');
  const strava = useStrava();
  const cloud = useCloud();
  const connected = strava.settings.connectedAt !== null;

  return (
    <Section title="Strava" icon="fitness" tint="workouts">
      <AppText variant="caption" muted>
        {t('strava.intro')}
      </AppText>
      <Details title={t('strava.howTitle')}>{t('strava.how')}</Details>
      {!strava.configured ? (
        <Notice tone="danger">
          {t('strava.noCloud')}
        </Notice>
      ) : null}
      {strava.configured && strava.serverReady === false ? (
        <Notice tone="danger">{t('strava.serverNotReady')}</Notice>
      ) : null}
      {strava.error ? <Notice tone="danger">{strava.error}</Notice> : null}
      {strava.configured && !strava.signedIn && !connected ? (
        <>
          <Notice icon="person-circle">
            {t('strava.signInFirst')}
          </Notice>
          <Button
            label={t('strava.signIn')}
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
          accessibilityLabel={t('strava.connect')}
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
            label={t('strava.connectedSince')}
            value={strava.settings.connectedAt ? formatDateTime(strava.settings.connectedAt) : null}
          />
          <SwitchRow
            label={t('strava.addLink')}
            hint={t('strava.addLinkHint')}
            value={strava.settings.addLink}
            onValueChange={(on) => void strava.setAddLink(on)}
          />
          <Button
            label={t('strava.disconnect')}
            variant="destructive"
            icon="unlink"
            onPress={() => void strava.disconnect()}
            disabled={strava.busy || !strava.signedIn}
            loading={strava.busy}
          />
          {!strava.signedIn ? (
            <AppText variant="caption" muted>
              {t('strava.signInToDisconnect')}
            </AppText>
          ) : null}
        </>
      ) : null}
      <Image
        source={COMPATIBLE_LOGO}
        style={[LOGO_SIZE, styles.logo]}
        accessibilityLabel={t('strava.compatible')}
        accessibilityIgnoresInvertColors
      />
      <Details>{t('strava.legal')}</Details>
    </Section>
  );
}

const styles = StyleSheet.create({
  connect: { alignSelf: 'flex-start', height: BUTTON_SIZE.height, marginVertical: spacing.xs },
  dim: { opacity: 0.5 },
  logo: { alignSelf: 'flex-start' },
});
