import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { boundsOf, lineCollection, pointCollection } from '@/features/routes/map/geometry';
import { FIT_PADDING, MAP_STYLE_URL } from '@/features/routes/map/mapConfig';
import { MapAttribution } from '@/features/routes/map/MapAttribution';
import { loadMapLibre } from '@/features/routes/map/maplibre';
import { RouteLayers } from '@/features/routes/map/RouteLayers';
import { formatRouteDistance, routeStats, type RoutePoint } from '@/features/routes/routeModel';
import { RouteView } from '@/features/workouts/RouteView';
import { spacing, useTheme } from '@/theme';

interface RouteMapProps {
  points: readonly RoutePoint[];
  /** Height of the map in dp; the width is the parent's. */
  height?: number;
}

/**
 * A saved route on the OpenFreeMap street map: the line with a white casing, a filled dot at the start and a ring at the end,
 * fitted to the screen. Read-only (pan and zoom, no rotation). Where MapLibre is not in the build, or the map cannot load,
 * the plain SVG line takes its place with a short note.
 */
export function RouteMap({ points, height = 260 }: RouteMapProps) {
  const { t } = useTranslation('routes');
  const { colors, radius } = useTheme();
  const maplibre = loadMapLibre();
  const [loadFailed, setLoadFailed] = useState(false);

  const shape = useMemo(() => {
    const bounds = boundsOf(points);
    if (!bounds || points.length < 2) return null;
    return {
      bounds,
      line: lineCollection([points]),
      start: pointCollection([points[0]]),
      end: pointCollection([points[points.length - 1]]),
      distanceM: routeStats(points).distanceM,
    };
  }, [points]);

  if (!maplibre || !shape || loadFailed) {
    return (
      <View style={styles.fallback}>
        <RouteView route={points} />
        {shape ? (
          <AppText variant="caption" muted>
            {maplibre ? t('map.loadFailedCaption') : t('map.unavailableCaption')}
          </AppText>
        ) : null}
      </View>
    );
  }

  const { Map: MapView, Camera } = maplibre;
  return (
    <View
      accessible
      accessibilityLabel={t('map.mapLabel', { distance: formatRouteDistance(shape.distanceM) })}
      style={[styles.frame, { height, borderRadius: radius.tile, backgroundColor: colors.muted }]}>
      {/* A new route is a new map: the camera only fits the box it starts with. */}
      <MapView
        key={shape.bounds.join(',')}
        mapStyle={MAP_STYLE_URL}
        logo={false}
        compass={false}
        touchRotate={false}
        touchPitch={false}
        attribution
        attributionPosition={{ bottom: 6, right: 6 }}
        onDidFailLoadingMap={() => setLoadFailed(true)}>
        <Camera initialViewState={{ bounds: shape.bounds, padding: FIT_PADDING }} />
        <RouteLayers maplibre={maplibre} color={colors.workouts} line={shape.line} start={shape.start} end={shape.end} />
      </MapView>
      <MapAttribution />
    </View>
  );
}

const styles = StyleSheet.create({
  frame: { overflow: 'hidden' },
  fallback: { gap: spacing.sm },
});
