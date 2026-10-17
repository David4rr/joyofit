import * as Linking from 'expo-linking';
import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { Card } from '@/components/Screen';
import { useCloud } from '@/state/CloudProvider';
import { spacing } from '@/theme';
import { HuaweiWear } from '@/wear';

const DIARY_URL = 'https://joyorogo.com/makan?utm_source=joyofit&utm_medium=app&utm_campaign=evergreen-today-card';
// The website sells Founder; a Play build must not lead to an outside checkout, so it points at JoyoRogo on Google Play.
const ABOUT_URL =
  HuaweiWear.distribution === 'play'
    ? 'https://play.google.com/store/apps/details?id=com.joyodigitama.joyorogo&referrer=utm_source%3Djoyofit%26utm_medium%3Dapp%26utm_campaign%3Devergreen-today-card'
    : 'https://joyorogo.com/?utm_source=joyofit&utm_medium=app&utm_campaign=evergreen-today-card';

/**
 * The one place JoyoFit points at JoyoRogo outside Settings: under the readiness details, where "what should I eat on a day
 * like this" is the natural next question. Signed in, it opens the diary that already shows these scores; otherwise it
 * offers the same JoyoRogo sign-in Settings uses.
 */
export function JoyoRogoCard() {
  const cloud = useCloud();
  if (cloud.sessionPending) return null;

  return (
    <Card>
      <View style={styles.body}>
        <AppText variant="bodyStrong">{"Eat for today's strain"}</AppText>
        {cloud.signedIn ? (
          <>
            <AppText variant="caption" muted>
              {"Today's Recovery, Strain and Sleep are in your JoyoRogo food diary, with a short food tip for a day like this."}
            </AppText>
            <View style={styles.actions}>
              <Button label="Open JoyoRogo diary" icon="restaurant" onPress={() => void Linking.openURL(DIARY_URL)} />
            </View>
          </>
        ) : (
          <>
            <AppText variant="caption" muted>
              {
                "JoyoRogo is our food diary: snap a photo of your meal and it counts the calories. Sign in and these scores appear next to what you ate, with a tip on what to eat after a hard or easy day. Your intake also shows on the watch's calorie card."
              }
            </AppText>
            <View style={styles.actions}>
              <Button label="Sign in with JoyoRogo" icon="log-in" onPress={() => void cloud.signIn()} />
              <Button label="What's JoyoRogo?" variant="ghost" onPress={() => void Linking.openURL(ABOUT_URL)} />
            </View>
            {cloud.error ? (
              <AppText variant="caption" muted>
                {cloud.error}
              </AppText>
            ) : null}
          </>
        )}
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  body: { gap: spacing.xs },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.xs },
});
