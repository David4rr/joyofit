import * as Linking from 'expo-linking';
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { isIos } from '@/components/IosUnavailable';
import { Card } from '@/components/Screen';
import { Notice } from '@/components/States';
import { JOYOROGO_URL } from '@/cloud/config';
import { Bullet, StepIntro } from '@/features/onboarding/StepIntro';
import { fetchProConfig, priceLine, proOffer, scansLine, type ProConfig } from '@/features/onboarding/pro';
import { useCloud } from '@/state/CloudProvider';
import { spacing } from '@/theme';
import { HuaweiWear } from '@/wear';

/** utm convention: docs/utm.md in the joyorogo repo. The Play listing takes the tags in `referrer`. */
const PRO_URL = 'https://joyorogo.com/pro?from=joyofit&utm_source=joyofit&utm_medium=app&utm_campaign=evergreen-onboarding';
const PLAY_URL =
  'https://play.google.com/store/apps/details?id=com.joyodigitama.joyorogo&referrer=utm_source%3Djoyofit%26utm_medium%3Dapp%26utm_campaign%3Devergreen-onboarding';

const OFFER = proOffer(isIos ? 'ios' : 'android', HuaweiWear.distribution);

/**
 * JoyoRogo Pro, described honestly and never required. What may be shown depends on the store (see `proOffer`): the price and a link to
 * the web page only in a build outside Google Play, a link to the JoyoRogo app's Play listing in a Play build, and plain text on iOS.
 * Prices and limits come from JoyoRogo's live config, never from this app's code.
 */
export function ProStep() {
  const cloud = useCloud();
  const [config, setConfig] = useState<ProConfig | null>(null);

  useEffect(() => {
    let live = true;
    void fetchProConfig(JOYOROGO_URL).then((next) => live && setConfig(next));
    return () => {
      live = false;
    };
  }, []);

  const price = OFFER === 'web' ? priceLine(config) : null;
  const active = cloud.signedIn && !cloud.locked && cloud.lastSyncAt !== null;

  return (
    <>
      <StepIntro icon="cloud-upload" tint="link" title="JoyoRogo Pro" badge="Optional, paid">
        JoyoFit is free to use in full: pairing, sync, workouts, Strava and the health apps all work on this phone without paying. Pro is an
        optional plan on your JoyoRogo account.
      </StepIntro>
      <Card>
        <AppText variant="heading">What Pro adds</AppText>
        <View style={styles.bullets}>
          <Bullet label={'\u2022'}>
            Cloud backup of your watch data (steps, heart rate, blood oxygen, sleep and workouts) to your own JoyoRogo account. JoyoFit
            uploads it today; restoring it into the app is not built yet.
          </Bullet>
          <Bullet label={'\u2022'}>
            Meal suggestions in JoyoRogo built from today&apos;s JoyoFit scores. Without Pro the diary shows a short hint instead.
          </Bullet>
          <Bullet label={'\u2022'}>{scansLine(config)}</Bullet>
        </View>
        {price ? <AppText variant="bodyStrong">{price}</AppText> : null}
        {OFFER === 'mention' ? (
          <AppText variant="caption" muted>
            JoyoRogo Pro is available in JoyoRogo.
          </AppText>
        ) : null}
        {OFFER === 'store' ? (
          <AppText variant="caption" muted>
            JoyoRogo Pro is managed in the JoyoRogo app.
          </AppText>
        ) : null}
      </Card>
      {active ? <Notice icon="checkmark-circle">Cloud backup is on for this account.</Notice> : null}
      {cloud.signedIn && cloud.locked ? (
        <Notice icon="lock-closed">This account is not on Pro, so nothing is uploaded. Everything else works as before.</Notice>
      ) : null}
      {!cloud.signedIn ? <Notice icon="information-circle">Pro belongs to your JoyoRogo account. Sign in in the previous step to use it.</Notice> : null}
      {OFFER === 'web' ? <Button label="See JoyoRogo Pro" variant="secondary" icon="open-outline" onPress={() => void Linking.openURL(PRO_URL)} /> : null}
      {OFFER === 'store' ? (
        <Button label="Get JoyoRogo on Google Play" variant="secondary" icon="logo-google-playstore" onPress={() => void Linking.openURL(PLAY_URL)} />
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  bullets: { gap: spacing.sm },
});
