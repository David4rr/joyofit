import * as Linking from 'expo-linking';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
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
  const { t } = useTranslation('onboarding');
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
      <StepIntro icon="cloud-upload" tint="link" title={t('pro.title')} badge={t('badge.optionalPaid')}>
        {t('pro.intro')}
      </StepIntro>
      <Card>
        <AppText variant="heading">{t('pro.addsTitle')}</AppText>
        <View style={styles.bullets}>
          <Bullet label={'\u2022'}>
            {t('pro.adds1')}
          </Bullet>
          <Bullet label={'\u2022'}>
            {t('pro.adds2')}
          </Bullet>
          <Bullet label={'\u2022'}>{scansLine(config)}</Bullet>
        </View>
        {price ? <AppText variant="bodyStrong">{price}</AppText> : null}
        {OFFER === 'mention' ? (
          <AppText variant="caption" muted>
            {t('pro.mention')}
          </AppText>
        ) : null}
        {OFFER === 'store' ? (
          <AppText variant="caption" muted>
            {t('pro.managed')}
          </AppText>
        ) : null}
      </Card>
      {active ? <Notice icon="checkmark-circle">{t('pro.active')}</Notice> : null}
      {cloud.signedIn && cloud.locked ? (
        <Notice icon="lock-closed">{t('pro.locked')}</Notice>
      ) : null}
      {!cloud.signedIn ? <Notice icon="information-circle">{t('pro.signInFirst')}</Notice> : null}
      {OFFER === 'web' ? <Button label={t('pro.see')} variant="secondary" icon="open-outline" onPress={() => void Linking.openURL(PRO_URL)} /> : null}
      {OFFER === 'store' ? (
        <Button label={t('pro.getOnPlay')} variant="secondary" icon="logo-google-playstore" onPress={() => void Linking.openURL(PLAY_URL)} />
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  bullets: { gap: spacing.sm },
});
