import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Details } from '@/components/Details';
import { Section } from '@/components/Screen';
import { Segmented } from '@/components/Segmented';
import { LOCALE_PREFS, type LocalePref } from '@/i18n';
import { getLocalePref, setLocalePref } from '@/i18n/native';

/** "Bahasa": follow the phone (Otomatis) or pin Indonesia / English. Applies at once and is remembered. */
export function LanguageSection() {
  const { t } = useTranslation('common');
  const [pref, setPref] = useState<LocalePref>(getLocalePref);
  return (
    <Section title={t('language.title')} icon="language">
      <Segmented
        options={LOCALE_PREFS.map((value) => ({ value, label: t(`language.${value}`) }))}
        value={pref}
        onChange={(next) => {
          setPref(next);
          setLocalePref(next);
        }}
      />
      <Details title={t('language.title')}>{t('language.hint')}</Details>
    </Section>
  );
}
