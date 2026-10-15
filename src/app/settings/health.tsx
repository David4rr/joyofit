import { Screen } from '@/components/Screen';
import { PrivacySection } from '@/features/settings/PrivacySection';
import { HealthConnectSection } from '@/features/settings/HealthConnectSection';
import { HealthyLivingSection } from '@/features/settings/HealthyLivingSection';

export default function HealthSettingsScreen() {
  return (
    <Screen>
      <HealthConnectSection />
      <HealthyLivingSection />
      <PrivacySection />
    </Screen>
  );
}
