import { useFocusEffect } from 'expo-router';
import { useCallback } from 'react';

import { Screen } from '@/components/Screen';
import { StravaSection } from '@/features/settings/StravaSection';
import { useStrava } from '@/state/StravaProvider';

/** Also where `joyofit://settings/strava` lands after Strava's authorization page; coming back re-reads the connection. */
export default function StravaSettingsScreen() {
  const { refresh } = useStrava();
  useFocusEffect(
    useCallback(() => {
      void refresh().catch(() => {});
    }, [refresh]),
  );
  return (
    <Screen>
      <StravaSection />
    </Screen>
  );
}
