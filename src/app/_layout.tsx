import { Ionicons } from '@expo/vector-icons';
import {
  PlusJakartaSans_500Medium,
  PlusJakartaSans_600SemiBold,
  PlusJakartaSans_700Bold,
  PlusJakartaSans_800ExtraBold,
  useFonts,
} from '@expo-google-fonts/plus-jakarta-sans';
import { Tabs } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { SQLiteProvider, type SQLiteDatabase } from 'expo-sqlite';
import { StatusBar } from 'expo-status-bar';
import { Suspense, useEffect } from 'react';
import { View } from 'react-native';

import { TabIcon } from '@/components/TabIcon';
import { migrate } from '@/db/migrations';
import { serializeQueries } from '@/db/serialize';
import { FamilyProvider } from '@/features/family/FamilyProvider';
import { UpdateBanner } from '@/features/updates/UpdateBanner';
import { CloudProvider } from '@/state/CloudProvider';
import { LiveWorkoutProvider } from '@/state/LiveWorkoutProvider';
import { OnboardingProvider } from '@/state/OnboardingProvider';
import { MealsProvider } from '@/state/MealsProvider';
import { StravaProvider } from '@/state/StravaProvider';
import { WatchProvider } from '@/state/WatchProvider';
import { ThemeProvider, useTheme } from '@/theme';

const DATABASE_NAME = 'joyofit.db';

/** Schema first, then one query at a time on the shared handle (see `serialize.ts`). */
async function initDatabase(db: SQLiteDatabase): Promise<void> {
  await migrate(db);
  serializeQueries(db);
}

// Hold the splash until the fonts and tab icons are ready, so the first frame is already typeset.
void SplashScreen.preventAutoHideAsync().catch(() => {});

export default function RootLayout() {
  return (
    <ThemeProvider>
      <RootNavigator />
    </ThemeProvider>
  );
}

function RootNavigator() {
  const { colors, fonts, scheme } = useTheme();
  const [fontsReady, fontError] = useFonts({
    PlusJakartaSans_500Medium,
    PlusJakartaSans_600SemiBold,
    PlusJakartaSans_700Bold,
    PlusJakartaSans_800ExtraBold,
    ...Ionicons.font,
  });
  const ready = fontsReady || fontError !== null;

  useEffect(() => {
    if (ready) void SplashScreen.hideAsync().catch(() => {});
  }, [ready]);

  if (!ready) return null;

  return (
    <Suspense fallback={null}>
      <SQLiteProvider databaseName={DATABASE_NAME} onInit={initDatabase} useSuspense>
        <WatchProvider>
          <CloudProvider>
            <StravaProvider>
              <MealsProvider>
                <LiveWorkoutProvider>
                  <OnboardingProvider>
                  <FamilyProvider>
                  <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />
                  <View style={{ flex: 1 }}>
                  <Tabs
                    screenOptions={{
                      headerShown: false,
                      sceneStyle: { backgroundColor: colors.background },
                      tabBarStyle: { backgroundColor: colors.card, borderTopColor: colors.hairline },
                      tabBarActiveTintColor: colors.primary,
                      tabBarInactiveTintColor: colors.mutedForeground,
                      tabBarLabelStyle: { fontFamily: fonts.medium, fontSize: 12 },
                    }}>
                    <Tabs.Screen
                      name="index"
                      options={{
                        title: 'Today',
                        tabBarIcon: ({ focused, color, size }) => (
                          <TabIcon on="today" off="today-outline" focused={focused} size={size} color={color} />
                        ),
                      }}
                    />
                    <Tabs.Screen
                      name="workouts"
                      options={{
                        title: 'Workouts',
                        tabBarIcon: ({ focused, color, size }) => (
                          <TabIcon on="fitness" off="fitness-outline" focused={focused} size={size} color={color} />
                        ),
                      }}
                    />
                    <Tabs.Screen
                      name="social"
                      options={{
                        title: 'Social',
                        tabBarIcon: ({ focused, color, size }) => (
                          <TabIcon on="people" off="people-outline" focused={focused} size={size} color={color} />
                        ),
                      }}
                    />
                    <Tabs.Screen
                      name="watch"
                      options={{
                        title: 'Watch',
                        tabBarIcon: ({ focused, color, size }) => (
                          <TabIcon on="watch" off="watch-outline" focused={focused} size={size} color={color} />
                        ),
                      }}
                    />
                    <Tabs.Screen
                      name="settings"
                      options={{
                        title: 'Settings',
                        tabBarIcon: ({ focused, color, size }) => (
                          <TabIcon on="settings" off="settings-outline" focused={focused} size={size} color={color} />
                        ),
                      }}
                    />
                    {/* Old deep links; each redirects to where the screen lives now. */}
                    <Tabs.Screen name="today" options={{ href: null }} />
                    <Tabs.Screen name="log" options={{ href: null }} />
                    <Tabs.Screen name="alarms" options={{ href: null }} />
                    <Tabs.Screen name="watchfaces" options={{ href: null }} />
                    {/* Pushed from Today (or Settings, for hrv); each draws its own header (HiddenTabHeader). */}
                    <Tabs.Screen name="health" options={{ href: null }} />
                    <Tabs.Screen name="hrv" options={{ href: null }} />
                    <Tabs.Screen name="sleep" options={{ href: null }} />
                    <Tabs.Screen name="readiness" options={{ href: null }} />
                    <Tabs.Screen name="trends" options={{ href: null }} />
                    {/* Opens by itself when a workout starts on the watch (LiveWorkoutProvider). */}
                    <Tabs.Screen name="workout-live" options={{ href: null }} />
                    {/* Family monitoring: opened from Today, Settings and notifications; its stack draws its own headers. */}
                    <Tabs.Screen name="family" options={{ href: null }} />
                    {/* Watch routes: opened from the Watch tab and by shared GPX/TCX files; its stack draws its own headers. */}
                    <Tabs.Screen name="routes" options={{ href: null }} />
                    {/* The setup guide: opened by OnboardingProvider on a first run and from Settings; full screen, no tab bar. */}
                    <Tabs.Screen name="onboarding" options={{ href: null, tabBarStyle: { display: 'none' } }} />
                  </Tabs>
                  {/* Android installs from Google Play only: flexible in-app update. */}
                  <UpdateBanner />
                  </View>
                  </FamilyProvider>
                  </OnboardingProvider>
                </LiveWorkoutProvider>
              </MealsProvider>
            </StravaProvider>
          </CloudProvider>
        </WatchProvider>
      </SQLiteProvider>
    </Suspense>
  );
}
