import { Screen } from '@/components/Screen';
import { AppearanceSection } from '@/features/settings/AppearanceSection';
import { LanguageSection } from '@/features/settings/LanguageSection';

export default function AppearanceScreen() {
  return (
    <Screen>
      <LanguageSection />
      <AppearanceSection />
    </Screen>
  );
}
