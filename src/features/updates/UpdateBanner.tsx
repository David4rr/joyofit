import { Ionicons } from '@expo/vector-icons';
import { useEffect, useState } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { useReducedMotion } from '@/hooks/useReducedMotion';
import { useAppUpdate, type UpdateBannerModel } from '@/features/updates/useAppUpdate';
import { radius, spacing, useTheme } from '@/theme';

/**
 * Banner for a newer JoyoFit build on installs made by Google Play: Play's flexible in-app update
 * (download in the background, then "Restart to update"). Renders nothing on iOS, sideloaded APKs, or
 * when there is no update.
 */
export function UpdateBanner() {
  const { banner, update, restart, dismiss } = useAppUpdate();
  if (banner === null) return null;
  return <BannerCard banner={banner} onUpdate={() => void update()} onRestart={restart} onDismiss={dismiss} />;
}

function bannerText(banner: UpdateBannerModel): { title: string; body: string | null } {
  if (banner.kind === 'available') {
    return {
      title: 'New version available',
      body: banner.failed ? "Couldn't start the update. Try again." : 'A JoyoFit update is ready to download.',
    };
  }
  if (banner.kind === 'downloading') {
    return { title: 'Downloading update…', body: banner.percent === null ? null : `${banner.percent}%` };
  }
  return { title: 'Update ready to install', body: 'Restart JoyoFit to use the new version.' };
}

function BannerCard({
  banner,
  onUpdate,
  onRestart,
  onDismiss,
}: {
  banner: UpdateBannerModel;
  onUpdate: () => void;
  onRestart: () => void;
  onDismiss: () => void;
}) {
  const { colors, radius: radii } = useTheme();
  const insets = useSafeAreaInsets();
  const reduced = useReducedMotion();
  const [enter] = useState(() => new Animated.Value(0));

  useEffect(() => {
    Animated.timing(enter, {
      toValue: 1,
      duration: reduced ? 0 : 220,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [enter, reduced]);

  const { title, body } = bannerText(banner);

  return (
    <View pointerEvents="box-none" style={[styles.anchor, { paddingTop: insets.top + spacing.sm }]}>
      <Animated.View
        accessibilityRole="alert"
        accessibilityLiveRegion="polite"
        style={[
          styles.card,
          {
            backgroundColor: colors.card,
            borderColor: colors.hairline,
            borderRadius: radii.tile,
            opacity: enter,
            transform: [{ translateY: enter.interpolate({ inputRange: [0, 1], outputRange: [-12, 0] }) }],
          },
        ]}>
        <View style={styles.row}>
          <View style={[styles.chip, { backgroundColor: colors.stepsSoft }]}>
            <Ionicons
              name={banner.kind === 'ready' ? 'refresh-circle' : 'arrow-down-circle'}
              size={22}
              color={colors.stepsText}
            />
          </View>
          <View style={styles.texts}>
            <AppText variant="bodyStrong" numberOfLines={1}>
              {title}
            </AppText>
            {body ? (
              <AppText variant="caption" muted numberOfLines={2}>
                {body}
              </AppText>
            ) : null}
          </View>
        </View>

        {banner.kind === 'downloading' ? (
          <View style={[styles.track, { backgroundColor: colors.muted }]}>
            <View style={[styles.fill, { width: `${banner.percent ?? 4}%`, backgroundColor: colors.primary }]} />
          </View>
        ) : (
          <View style={styles.actions}>
            <Button label="Later" variant="ghost" onPress={onDismiss} />
            <Button
              label={banner.kind === 'ready' ? 'Restart to update' : 'Update'}
              variant="primary"
              onPress={banner.kind === 'ready' ? onRestart : onUpdate}
            />
          </View>
        )}
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  anchor: { position: 'absolute', top: 0, left: 0, right: 0, zIndex: 90, elevation: 90, paddingHorizontal: spacing.lg },
  card: {
    borderWidth: StyleSheet.hairlineWidth,
    padding: spacing.md,
    gap: spacing.md,
    shadowColor: '#000000',
    shadowOpacity: 0.14,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
    elevation: 12,
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  chip: { width: 40, height: 40, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
  texts: { flex: 1, gap: 2 },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', gap: spacing.sm },
  track: { height: 6, borderRadius: 3, overflow: 'hidden' },
  fill: { height: 6, borderRadius: 3 },
});
