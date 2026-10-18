import { useTranslation } from 'react-i18next';
import { Linking } from 'react-native';

import { Button } from '@/components/Button';

const GUIDE_URL = 'https://fit.joyorogo.com/panduan';

/** The install, pairing and troubleshooting guide on the website (Indonesian, with an English section). */
export function GuideLink() {
  const { t } = useTranslation('watch');
  return <Button label={t('device.guide')} variant="ghost" icon="book-outline" onPress={() => void Linking.openURL(GUIDE_URL)} />;
}
