import { useRouter, type Href } from 'expo-router';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { SectionList, StyleSheet } from 'react-native';

import { AppText } from '@/components/AppText';
import type { IconName } from '@/components/IconChip';
import { isIos } from '@/components/IosUnavailable';
import { groupedRowStyle, NavRow } from '@/components/NavRow';
import { PageHeader, useContentPadding } from '@/components/Screen';
import { useFamily } from '@/features/family/FamilyProvider';
import { familySettingsSubtitle } from '@/features/family/format';
import type { TFunction } from '@/i18n';
import { useOnboarding } from '@/state/OnboardingProvider';
import { spacing, useTheme, type Tint } from '@/theme';

interface SettingsRow {
  title: string;
  subtitle?: string;
  icon: IconName;
  tint?: Tint;
  /** Where the row goes; a row with no `href` opens the setup guide. */
  href?: Href;
}

interface SettingsGroup {
  title: string;
  data: readonly SettingsRow[];
}

/** The family row's destination; its subtitle follows the family state, so the screen finds the row by it. */
const FAMILY_HREF = '/family';

function buildGroups(t: TFunction<'settings'>): readonly SettingsGroup[] {
  return [
    {
      title: t('index.groups.watch'),
      data: [
        {
          title: t('index.rows.sync.title'),
          subtitle: t('index.rows.sync.subtitle'),
          icon: 'sync',
          href: '/settings/sync',
        },
        {
          title: t('index.rows.notifications.title'),
          subtitle: isIos ? t('index.rows.notifications.subtitleIos') : t('index.rows.notifications.subtitle'),
          icon: 'notifications',
          href: '/settings/notifications',
        },
        {
          title: t('index.rows.notificationApps.title'),
          subtitle: isIos ? t('index.rows.notificationApps.subtitleIos') : t('index.rows.notificationApps.subtitle'),
          icon: 'apps',
          href: '/settings/notification-apps',
        },
        {
          title: t('index.rows.weather.title'),
          subtitle: t('index.rows.weather.subtitle'),
          icon: 'partly-sunny',
          href: '/settings/weather',
        },
        {
          title: t('index.rows.safety.title'),
          subtitle: t('index.rows.safety.subtitle'),
          icon: 'shield-checkmark',
          tint: 'heart',
          href: '/settings/safety',
        },
        {
          title: t('index.rows.meals.title'),
          subtitle: t('index.rows.meals.subtitle'),
          icon: 'restaurant',
          href: '/settings/meals',
        },
        {
          title: t('index.rows.goals.title'),
          subtitle: t('index.rows.goals.subtitle'),
          icon: 'flag',
          href: '/settings/goals',
        },
      ],
    },
    {
      title: t('index.groups.you'),
      data: [
        {
          title: isIos ? t('index.rows.health.titleIos') : t('index.rows.health.title'),
          subtitle: t('index.rows.health.subtitle'),
          icon: 'heart',
          tint: 'heart',
          href: '/settings/health',
        },
        {
          title: t('index.rows.strava.title'),
          subtitle: t('index.rows.strava.subtitle'),
          icon: 'fitness',
          tint: 'workouts',
          href: '/settings/strava',
        },
        {
          title: t('index.rows.importHuawei.title'),
          subtitle: t('index.rows.importHuawei.subtitle'),
          icon: 'cloud-download',
          tint: 'heart',
          href: '/settings/import-huawei',
        },
        ...(isIos
          ? [
              {
                title: t('index.rows.importAppleHealth.title'),
                subtitle: t('index.rows.importAppleHealth.subtitle'),
                icon: 'heart' as const,
                tint: 'heart' as const,
                href: '/settings/import-apple-health' as const,
              },
            ]
          : []),
        {
          title: t('index.rows.importFit.title'),
          subtitle: t('index.rows.importFit.subtitle'),
          icon: 'bicycle',
          tint: 'workouts',
          href: '/settings/import-fit',
        },
        {
          title: t('index.rows.profile.title'),
          subtitle: t('index.rows.profile.subtitle'),
          icon: 'person',
          href: '/settings/profile',
        },
        {
          title: t('index.rows.cycle.title'),
          subtitle: t('index.rows.cycle.subtitle'),
          icon: 'calendar',
          tint: 'heart',
          href: '/settings/cycle',
        },
        {
          title: t('index.rows.family.title'),
          subtitle: familySettingsSubtitle(0, 0),
          icon: 'people',
          tint: 'link',
          href: FAMILY_HREF,
        },
      ],
    },
    {
      title: t('index.groups.app'),
      data: [
        {
          title: t('index.rows.guide.title'),
          subtitle: t('index.rows.guide.subtitle'),
          icon: 'compass',
        },
        {
          title: t('index.rows.appearance.title'),
          subtitle: t('index.rows.appearance.subtitle'),
          icon: 'color-palette',
          href: '/settings/appearance',
        },
      ],
    },
    {
      title: t('index.groups.advanced'),
      data: [
        { title: t('index.rows.log.title'), subtitle: t('index.rows.log.subtitle'), icon: 'terminal', href: '/settings/log' },
        {
          title: t('index.rows.advanced.title'),
          subtitle: t('index.rows.advanced.subtitle'),
          icon: 'flask',
          tint: 'workouts',
          href: '/settings/advanced',
        },
        { title: t('index.rows.about.title'), icon: 'information-circle', href: '/settings/about' },
      ],
    },
  ];
}

export default function SettingsScreen() {
  const { t, i18n } = useTranslation('settings');
  const theme = useTheme();
  const { colors } = theme;
  const router = useRouter();
  const padding = useContentPadding(true);
  const guide = useOnboarding();
  const family = useFamily();
  const groups = useMemo(() => buildGroups(t), [t, i18n.language]);
  const familySubtitle = familySettingsSubtitle(family.watching.length, family.watchedBy.length);

  return (
    <SectionList
      sections={groups}
      keyExtractor={(row) => row.title}
      style={{ backgroundColor: colors.background }}
      contentContainerStyle={padding}
      stickySectionHeadersEnabled
      showsVerticalScrollIndicator={false}
      ListHeaderComponent={<PageHeader title={t('index.title')} />}
      renderSectionHeader={({ section }) => (
        <AppText
          variant="heading"
          accessibilityRole="header"
          style={[styles.groupTitle, { backgroundColor: colors.background }]}>
          {section.title}
        </AppText>
      )}
      renderItem={({ item, index, section }) => (
        <NavRow
          icon={item.icon}
          tint={item.tint}
          title={item.title}
          subtitle={item.href === FAMILY_HREF ? familySubtitle : item.subtitle}
          onPress={() => (item.href ? router.push(item.href) : guide.open())}
          style={groupedRowStyle(theme, index, section.data.length)}
        />
      )}
    />
  );
}

const styles = StyleSheet.create({
  groupTitle: { paddingTop: spacing.lg, paddingBottom: spacing.sm },
});
