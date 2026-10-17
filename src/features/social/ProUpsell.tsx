import * as Linking from 'expo-linking';
import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { IconChip } from '@/components/IconChip';
import { isIos } from '@/components/IosUnavailable';
import { Card } from '@/components/Screen';
import { proOffer } from '@/features/onboarding/pro';
import { spacing } from '@/theme';
import { HuaweiWear } from '@/wear';

/** utm convention: docs/utm.md in the joyorogo repo. */
const PRICING_URL = 'https://joyorogo.com/harga?from=joyofit&utm_source=joyofit&utm_medium=app&utm_campaign=evergreen-social-detail';
const PLAY_URL =
  'https://play.google.com/store/apps/details?id=com.joyodigitama.joyorogo&referrer=utm_source%3Djoyofit%26utm_medium%3Dapp%26utm_campaign%3Devergreen-social-detail';

/** The store's rules for pointing at a purchase, see `proOffer`: a web link outside Google Play, the JoyoRogo Play listing on Play, text only on iOS. */
const OFFER = proOffer(isIos ? 'ios' : 'android', HuaweiWear.distribution);

/** Shown in place of another person's heart-rate chart and route when the viewer is not on JoyoRogo Pro. */
export function ProUpsell() {
  return (
    <Card>
      <View style={styles.head}>
        <IconChip icon="lock-closed" tint="heart" />
        <AppText variant="heading" style={styles.title}>
          Heart rate and route are for Pro
        </AppText>
      </View>
      <AppText variant="caption" muted>
        Seeing the heart-rate chart and the route of someone else&apos;s workout is part of JoyoRogo Pro. Your own are always free to see, and
        sharing them is free too.
      </AppText>
      {OFFER === 'web' ? (
        <Button label="See JoyoRogo Pro" variant="primary" icon="open-outline" onPress={() => void Linking.openURL(PRICING_URL)} />
      ) : null}
      {OFFER === 'store' ? (
        <Button label="Open JoyoRogo" variant="primary" icon="open-outline" onPress={() => void Linking.openURL(PLAY_URL)} />
      ) : null}
      {OFFER === 'mention' ? (
        <AppText variant="caption" muted>
          JoyoRogo Pro is available in JoyoRogo.
        </AppText>
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  title: { flex: 1 },
});
