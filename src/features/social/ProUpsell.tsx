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
const pricingUrl = (campaign: string) =>
  `https://joyorogo.com/harga?from=joyofit&utm_source=joyofit&utm_medium=app&utm_campaign=${campaign}`;
const playUrl = (campaign: string) =>
  `https://play.google.com/store/apps/details?id=com.joyodigitama.joyorogo&referrer=utm_source%3Djoyofit%26utm_medium%3Dapp%26utm_campaign%3D${campaign}`;

/** The store's rules for pointing at a purchase, see `proOffer`: a web link outside Google Play, the JoyoRogo Play listing on Play, text only on iOS. */
const OFFER = proOffer(isIos ? 'ios' : 'android', HuaweiWear.distribution);

export interface ProUpsellCopy {
  title: string;
  description: string;
  /** The button to the pricing page (outside Google Play). */
  seeLabel: string;
  /** The button to JoyoRogo on Google Play. */
  openLabel: string;
  /** The only line on iOS, where no purchase may be pointed at. */
  mention: string;
}

const HEART_RATE_COPY: ProUpsellCopy = {
  title: 'Heart rate and route are for Pro',
  description:
    "Seeing the heart-rate chart and the route of someone else's workout is part of JoyoRogo Pro. Your own are always free to see, and sharing them is free too.",
  seeLabel: 'See JoyoRogo Pro',
  openLabel: 'Open JoyoRogo',
  mention: 'JoyoRogo Pro is available in JoyoRogo.',
};

interface ProUpsellProps {
  /** What the card says; defaults to the heart-rate and route text of the Social tab. */
  copy?: ProUpsellCopy;
  /** The utm campaign of the links. */
  campaign?: string;
}

/** Shown in place of a Pro-only view, e.g. another person's heart-rate chart and route when the viewer is not on JoyoRogo Pro. */
export function ProUpsell({ copy = HEART_RATE_COPY, campaign = 'evergreen-social-detail' }: ProUpsellProps) {
  return (
    <Card>
      <View style={styles.head}>
        <IconChip icon="lock-closed" tint="heart" />
        <AppText variant="heading" style={styles.title}>
          {copy.title}
        </AppText>
      </View>
      <AppText variant="caption" muted>
        {copy.description}
      </AppText>
      {OFFER === 'web' ? (
        <Button label={copy.seeLabel} variant="primary" icon="open-outline" onPress={() => void Linking.openURL(pricingUrl(campaign))} />
      ) : null}
      {OFFER === 'store' ? (
        <Button label={copy.openLabel} variant="primary" icon="open-outline" onPress={() => void Linking.openURL(playUrl(campaign))} />
      ) : null}
      {OFFER === 'mention' ? (
        <AppText variant="caption" muted>
          {copy.mention}
        </AppText>
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  title: { flex: 1 },
});
