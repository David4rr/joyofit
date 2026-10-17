import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { IconChip, type IconName } from '@/components/IconChip';
import { isIos } from '@/components/IosUnavailable';
import { Card } from '@/components/Screen';
import { Notice } from '@/components/States';
import { openSteps, type StepId } from '@/features/onboarding/flow';
import { StepIntro } from '@/features/onboarding/StepIntro';
import { useOnboarding } from '@/state/OnboardingProvider';
import { spacing, type Tint } from '@/theme';

const HEALTH_SETTINGS = isIos ? 'Apple Health and cloud' : 'Health Connect and cloud';

/** Where a step the person skipped lives afterwards. */
const WHERE_TO_FINISH: Partial<Record<StepId, string>> = {
  unbind: 'Settings, Import from Huawei Health',
  pair: 'the Watch tab',
  sync: 'the Watch tab, or pull down on Today',
  notifications: 'Settings, Notifications and calls',
  health: `Settings, ${HEALTH_SETTINGS}`,
  weather: 'Settings, Weather',
  background: 'Settings, Background and sync',
  account: `Settings, ${HEALTH_SETTINGS}`,
};

const STEP_NAME: Partial<Record<StepId, string>> = {
  unbind: 'Huawei Health history',
  pair: 'Pairing',
  sync: 'First sync',
  notifications: 'Notifications',
  health: HEALTH_SETTINGS.replace(' and cloud', ''),
  weather: 'Weather',
  background: 'Background connection',
  account: 'JoyoRogo sign-in',
};

interface Tip {
  icon: IconName;
  tint?: Tint | 'neutral';
  title: string;
  text: string;
}

const TIPS: readonly Tip[] = [
  { icon: 'today', tint: 'steps', title: 'Today', text: 'Steps, heart rate, sleep and your Recovery, Strain and Readiness scores. Pull down to sync.' },
  { icon: 'fitness', tint: 'workouts', title: 'Workouts', text: 'Every workout recorded on the watch, with its route and a card to share.' },
  { icon: 'fitness', tint: 'workouts', title: 'Strava', text: 'Settings, Strava: send watch workouts to Strava, free.' },
  { icon: 'watch', tint: 'link', title: 'Find my watch', text: 'Watch tab: make the watch ring when it is lost in the house.' },
];

export function DoneStep() {
  const { state, ctx } = useOnboarding();
  const open = state ? openSteps(state, ctx).filter((id) => WHERE_TO_FINISH[id]) : [];
  return (
    <>
      <StepIntro icon="checkmark-circle" tint="link" title="You are set up">
        JoyoFit keeps syncing on its own from here. A few places worth knowing:
      </StepIntro>
      <Card>
        <View style={styles.tips}>
          {TIPS.map((tip) => (
            <View key={tip.title} style={styles.tip}>
              <IconChip icon={tip.icon} tint={tip.tint} size="sm" />
              <View style={styles.tipText}>
                <AppText variant="bodyStrong">{tip.title}</AppText>
                <AppText variant="caption" muted>
                  {tip.text}
                </AppText>
              </View>
            </View>
          ))}
        </View>
      </Card>
      {open.length > 0 ? (
        <Notice icon="list">
          Still open: {open.map((id) => `${STEP_NAME[id]} (${WHERE_TO_FINISH[id]})`).join('; ')}.
        </Notice>
      ) : null}
      <AppText variant="caption" muted>
        Open this guide again from Settings, Setup guide.
      </AppText>
    </>
  );
}

const styles = StyleSheet.create({
  tips: { gap: spacing.md },
  tip: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  tipText: { flex: 1, gap: 2 },
});
