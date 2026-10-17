import Constants from 'expo-constants';

import { Details } from '@/components/Details';
import { GuideLink } from '@/features/device/GuideLink';
import { Pair, PairGrid } from '@/features/settings/PairGrid';
import { Section, Screen } from '@/components/Screen';

export default function AboutScreen() {
  return (
    <Screen>
      <Section title="JoyoFit" icon="information-circle">
        <PairGrid>
          <Pair label="App" value="JoyoFit" />
          <Pair label="Version" value={Constants.expoConfig?.version ?? null} />
          <Pair label="License" value="AGPL-3.0-or-later" />
        </PairGrid>
        <GuideLink />
        <Details title="Privacy">
          Watch data stays on this phone in joyofit.db until you sign in to the cloud. Weather, if switched on, sends
          rounded coordinates to Open-Meteo. Privacy policy: fit.joyorogo.com/privasi
        </Details>
      </Section>
    </Screen>
  );
}
