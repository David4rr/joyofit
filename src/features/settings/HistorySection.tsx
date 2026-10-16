import { Platform } from 'react-native';

import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { Section } from '@/components/Screen';
import { Notice } from '@/components/States';
import { useWatch } from '@/state/WatchProvider';

/**
 * The first sync after binding already pulls everything the watch still holds; this re-runs that pull, for a watch
 * that was bound before or a pull that was cut short. Stored rows are kept and updated, never duplicated.
 */
export function HistorySection() {
  const { linkState, device, error, syncFullHistory } = useWatch();
  if (Platform.OS !== 'android') return null;
  const syncing = linkState === 'syncing';
  const canSync = linkState === 'connected' && device !== null;

  return (
    <Section title="Watch history" icon="time" tint="heart">
      <AppText variant="caption" muted>
        Pulls every day of steps, heart rate, sleep, HRV and workouts the watch still holds, not only what is new since
        the last sync. It can take a few minutes. Data already on the phone is kept.
      </AppText>
      {error ? <Notice tone="danger">{error}</Notice> : null}
      <Button
        label={syncing ? 'Fetching' : 'Fetch all history from watch'}
        variant="secondary"
        icon="cloud-download-outline"
        onPress={() => void syncFullHistory()}
        disabled={!canSync}
        loading={syncing}
      />
      {!canSync && !syncing ? (
        <AppText variant="caption" muted>
          Connect your watch first.
        </AppText>
      ) : null}
    </Section>
  );
}
