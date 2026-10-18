import * as Linking from 'expo-linking';
import { Text } from 'react-native';

import { useTranslation } from 'react-i18next';

import { stravaActivityUrl } from '@/cloud/strava';
import { fontSize, useTheme } from '@/theme';

/** Strava's brand orange, the color its guidelines allow for a "View on Strava" link. */
export const STRAVA_ORANGE = '#FC5200';

/** The only wording Strava's brand guidelines allow for a link back to Strava data. Bold, orange, underlined. */
export function ViewOnStrava({ activityId }: { activityId: number }) {
  const { fonts } = useTheme();
  const { t } = useTranslation('sharing');
  return (
    <Text
      accessibilityRole="link"
      accessibilityLabel={t('strava.viewOn')}
      onPress={() => void Linking.openURL(stravaActivityUrl(activityId))}
      style={{ color: STRAVA_ORANGE, fontFamily: fonts.bold, fontSize: fontSize.base, textDecorationLine: 'underline' }}>
      {t('strava.viewOn')}
    </Text>
  );
}
