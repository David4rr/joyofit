import { Screen } from '@/components/Screen';
import { BackgroundSection } from '@/features/settings/BackgroundSection';
import { HeartRateSection } from '@/features/settings/HeartRateSection';
import { HistorySection } from '@/features/settings/HistorySection';

export default function SyncSettingsScreen() {
  return (
    <Screen>
      <BackgroundSection />
      <HeartRateSection />
      <HistorySection />
    </Screen>
  );
}
