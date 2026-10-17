import { Stack } from 'expo-router';

import { HeaderBackButton } from '@/components/HiddenTabHeader';
import { useStackOptions } from '@/components/navigation';

export const unstable_settings = { initialRouteName: 'index' };

export default function FamilyLayout() {
  return (
    <Stack screenOptions={useStackOptions()}>
      {/* The first screen of a hidden tab has no back button of its own. */}
      <Stack.Screen name="index" options={{ title: 'Keluarga', headerLeft: () => <HeaderBackButton /> }} />
      <Stack.Screen name="[id]" options={{ title: 'Kabar' }} />
      <Stack.Screen name="rules/[id]" options={{ title: 'Pemberitahuan' }} />
      <Stack.Screen name="invite" options={{ title: 'Undang' }} />
      <Stack.Screen name="accept" options={{ title: 'Terima undangan' }} />
      <Stack.Screen name="consent/[id]" options={{ title: 'Izin' }} />
      <Stack.Screen name="me" options={{ title: 'Dipantau' }} />
    </Stack>
  );
}
