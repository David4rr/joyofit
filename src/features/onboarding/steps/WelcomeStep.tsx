import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { isIos } from '@/components/IosUnavailable';
import { Card } from '@/components/Screen';
import { Bullet, StepIntro } from '@/features/onboarding/StepIntro';
import { spacing } from '@/theme';

export function WelcomeStep() {
  return (
    <>
      <StepIntro icon="watch" tint="link" title="Set up JoyoFit">
        JoyoFit works with your Huawei or Honor watch directly, without Huawei Health. This guide takes a few minutes and you can skip any
        step.
      </StepIntro>
      <Card>
        <AppText variant="heading">Before you start</AppText>
        <View style={styles.list}>
          <Bullet label="1">Have the watch next to you, charged and awake.</Bullet>
          <Bullet label="2">Bluetooth on{isIos ? ' this iPhone' : ' this phone'}.</Bullet>
          <Bullet label="3">
            Know which phone or app the watch is paired with now. A watch accepts one app at a time, so it has to be released there first.
          </Bullet>
        </View>
      </Card>
      <Card>
        <AppText variant="heading">What this covers</AppText>
        <View style={styles.list}>
          <Bullet label="1">Releasing the watch from Huawei Health, and keeping your old history.</Bullet>
          <Bullet label="2">Pairing, then the first sync.</Bullet>
          <Bullet label="3">
            {isIos
              ? 'Permissions: notifications, Apple Health, weather.'
              : 'Permissions: notifications, Health Connect, weather, staying connected.'}
          </Bullet>
          <Bullet label="4">Signing in with JoyoRogo, which is optional.</Bullet>
        </View>
      </Card>
      <AppText variant="caption" muted>
        You can open this guide again any time from Settings, Setup guide.
      </AppText>
    </>
  );
}

const styles = StyleSheet.create({
  list: { gap: spacing.sm },
});
