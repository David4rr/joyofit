import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { BikeMap } from '@/features/bikecomputer/map/BikeMap';
import { ridePalette } from '@/features/bikecomputer/map/ridePalette';
import { useBikeMapStyle } from '@/features/bikecomputer/map/useBikeMapStyle';
import { GpsLine } from '@/features/record/ui/GpsLine';
import type { FixInfo } from '@/features/record/ui/format';
import { spacing, useTheme } from '@/theme';

import { useOverlayRoute } from '../overlayRoute';
import type { TrailPoint } from '../trail';
import { RouteOverlayButton } from './RouteOverlayButton';

const MAP_HEIGHT = 240;

interface LiveRunMapProps {
  /** Where the phone is (its GPS), with the direction of travel when known; null before the first fix. */
  position: { lat: number; lon: number; headingDeg: number | null } | null;
  /** The path covered so far. */
  trail: readonly TrailPoint[];
  /** The newest GPS fix for the line under the map; null while there is none (the line then says it is searching). */
  fix: FixInfo | null;
}

/**
 * The live map of a run, walk, ride or hike: it follows the phone's position, draws the path covered and, when one is chosen, a saved
 * route (GPX import) as a guide line. Under it: the GPS signal and the route choice.
 */
export function LiveRunMap({ position, trail, fix }: LiveRunMapProps) {
  const { t } = useTranslation('sharing');
  const { colors, scheme, radius } = useTheme();
  const overlay = useOverlayRoute();
  const [follow, setFollow] = useState(true);
  const variant = scheme === 'dark' ? 'night' : 'day';
  // The last place stays on the map while the GPS looks again.
  const [shown, setShown] = useState(position);
  if (position && position !== shown) setShown(position);
  const { style } = useBikeMapStyle({ variant, position: shown });
  const ground = ridePalette(variant === 'night' ? 'dark' : 'light').background;
  const guide = overlay.selected?.line ?? null;

  return (
    <View style={styles.wrap}>
      {shown || guide ? (
        <BikeMap
          style={style}
          route={guide}
          track={trail}
          position={shown}
          follow={follow}
          offCourse={false}
          height={MAP_HEIGHT}
          colors={{ route: colors.link, routeCasing: ground, puck: colors.primary, offCourse: colors.destructive, track: colors.primary }}
          onFollowChange={setFollow}
        />
      ) : (
        <View
          accessible
          accessibilityLabel={t('live.map.waiting')}
          style={[styles.waiting, { backgroundColor: colors.muted, borderRadius: radius.tile }]}>
          <Ionicons name="navigate-outline" size={32} color={colors.mutedForeground} />
          <AppText variant="caption" muted style={styles.waitingText}>
            {t('live.map.waiting')}
          </AppText>
        </View>
      )}
      <View style={styles.foot}>
        <View style={styles.gps}>
          <GpsLine fix={fix} />
        </View>
        <RouteOverlayButton overlay={overlay} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.sm },
  waiting: { height: MAP_HEIGHT, alignItems: 'center', justifyContent: 'center', gap: spacing.sm, padding: spacing.lg },
  waitingText: { textAlign: 'center' },
  foot: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  gps: { flex: 1 },
});
