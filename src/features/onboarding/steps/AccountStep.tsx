import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Card } from '@/components/Screen';
import { Notice } from '@/components/States';
import { Bullet, StepIntro } from '@/features/onboarding/StepIntro';
import { SignInButtons } from '@/features/settings/SignInButtons';
import { useCloud } from '@/state/CloudProvider';
import { spacing } from '@/theme';

/** Optional JoyoRogo sign-in through the same provider and buttons Settings uses. */
export function AccountStep() {
  const cloud = useCloud();
  return (
    <>
      <StepIntro icon="restaurant" tint="steps" title="Sign in with JoyoRogo" badge="Optional">
        JoyoRogo is our food diary: photograph a meal and it counts the calories. Signing in connects the two apps. JoyoFit works fully
        without an account.
      </StepIntro>
      <Card>
        <AppText variant="heading">What it gives you</AppText>
        <View style={styles.bullets}>
          <Bullet label={'\u2022'}>
            Your daily Recovery, Strain and Sleep scores appear next to what you ate in the JoyoRogo diary, with a short food tip for a day
            like this.
          </Bullet>
          <Bullet label={'\u2022'}>What you log in JoyoRogo can show on the watch&apos;s calorie card.</Bullet>
          <Bullet label={'\u2022'}>
            The option of a cloud backup of your watch data, which is part of JoyoRogo Pro (the next step).
          </Bullet>
        </View>
        <AppText variant="caption" muted>
          While you are signed in, JoyoFit sends your daily scores to JoyoRogo and exchanges meals and weight with it. Your watch data
          stays on this phone unless you turn on the Pro cloud backup. Sign out any time in Settings, Health and cloud.
        </AppText>
      </Card>
      {cloud.error ? <Notice tone="danger">{cloud.error}</Notice> : null}
      {cloud.signedIn ? (
        <Notice icon="checkmark-circle">Signed in{cloud.email ? ` as ${cloud.email}` : ''}.</Notice>
      ) : (
        <SignInButtons />
      )}
    </>
  );
}

const styles = StyleSheet.create({
  bullets: { gap: spacing.sm },
});
