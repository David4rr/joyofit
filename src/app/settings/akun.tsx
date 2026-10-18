import { Screen } from '@/components/Screen';
import { CloudSection } from '@/features/settings/CloudSection';

/** The JoyoRogo account and its cloud sync. Signing out and deleting the account are the last rows of the Settings hub. */
export default function AccountSettingsScreen() {
  return (
    <Screen>
      <CloudSection />
    </Screen>
  );
}
