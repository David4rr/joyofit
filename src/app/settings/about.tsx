import Constants from 'expo-constants';
import { useTranslation } from 'react-i18next';

import { Details } from '@/components/Details';
import { GuideLink } from '@/features/device/GuideLink';
import { Pair, PairGrid } from '@/features/settings/PairGrid';
import { Section, Screen } from '@/components/Screen';
import { OtaSection } from '@/features/updates/OtaSection';

export default function AboutScreen() {
  const { t } = useTranslation('settings');
  return (
    <Screen>
      <Section title="JoyoFit" icon="information-circle">
        <PairGrid>
          <Pair label={t('about.app')} value="JoyoFit" />
          <Pair label={t('about.version')} value={Constants.expoConfig?.version ?? null} />
          <Pair label={t('about.license')} value="AGPL-3.0-or-later" />
        </PairGrid>
        <GuideLink />
        <Details title={t('about.privacyTitle')}>{t('about.privacy')}</Details>
      </Section>
      <OtaSection />
    </Screen>
  );
}
