import { Ionicons } from '@expo/vector-icons';
import { Tabs, useRouter } from 'expo-router';
import { Pressable, StyleSheet } from 'react-native';

import { HIT, spacing, useTheme } from '@/theme';

/** Back arrow (or Today when there is no history) for a header that has none of its own. */
export function HeaderBackButton() {
  const router = useRouter();
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Back"
      hitSlop={8}
      onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))}
      style={styles.back}>
      <Ionicons name="arrow-back" size={24} color={colors.foreground} />
    </Pressable>
  );
}

/**
 * Header for a screen pushed from Today. These routes are hidden tabs, and a tab header has no back
 * button of its own, so this draws one (back, or Today when there is no history).
 */
export function HiddenTabHeader({ title }: { title: string }) {
  const { colors, fonts } = useTheme();
  return (
    <Tabs.Screen
      options={{
        headerShown: true,
        title,
        headerLeft: () => <HeaderBackButton />,
        headerStyle: { backgroundColor: colors.background },
        headerTintColor: colors.foreground,
        headerShadowVisible: false,
        headerTitleStyle: { fontFamily: fonts.bold, fontSize: 18, color: colors.foreground },
      }}
    />
  );
}

const styles = StyleSheet.create({
  back: { width: HIT, height: HIT, alignItems: 'center', justifyContent: 'center', marginLeft: spacing.xs },
});
