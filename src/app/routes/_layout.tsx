import { Stack } from 'expo-router';

import { HeaderBackButton } from '@/components/HiddenTabHeader';
import { useStackOptions } from '@/components/navigation';
import { copy } from '@/features/routes/copy';

export const unstable_settings = { initialRouteName: 'index' };

export default function RoutesLayout() {
  return (
    <Stack screenOptions={useStackOptions()}>
      {/* The first screen of a hidden tab has no back button of its own. */}
      <Stack.Screen name="index" options={{ title: copy.titles.library, headerLeft: () => <HeaderBackButton /> }} />
      <Stack.Screen name="[id]" options={{ title: copy.titles.detail }} />
      <Stack.Screen name="import" options={{ title: copy.titles.import }} />
      <Stack.Screen name="draw" options={{ title: copy.titles.draw }} />
    </Stack>
  );
}
