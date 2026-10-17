import { Linking } from 'react-native';

import { Button } from '@/components/Button';

const GUIDE_URL = 'https://fit.joyorogo.com/panduan';

/** The install, pairing and troubleshooting guide on the website (Indonesian, with an English section). */
export function GuideLink() {
  return <Button label="Open the setup guide" variant="ghost" icon="book-outline" onPress={() => void Linking.openURL(GUIDE_URL)} />;
}
