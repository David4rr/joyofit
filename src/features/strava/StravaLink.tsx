import * as Linking from 'expo-linking';
import { Text } from 'react-native';

import { stravaActivityUrl } from '@/cloud/strava';
import { fontSize, fonts } from '@/theme';

/** Strava's brand orange, the color its guidelines allow for a "View on Strava" link. */
export const STRAVA_ORANGE = '#FC5200';

/** The only wording Strava's brand guidelines allow for a link back to Strava data. Bold, orange, underlined. */
export function ViewOnStrava({ activityId }: { activityId: number }) {
  return (
    <Text
      accessibilityRole="link"
      accessibilityLabel="View on Strava"
      onPress={() => void Linking.openURL(stravaActivityUrl(activityId))}
      style={{ color: STRAVA_ORANGE, fontFamily: fonts.bold, fontSize: fontSize.base, textDecorationLine: 'underline' }}>
      View on Strava
    </Text>
  );
}
