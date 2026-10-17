import { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Circle, Polyline } from 'react-native-svg';

import { projectRoute } from '@/features/workouts/summary';
import { useTheme } from '@/theme';

interface RouteThumbnailProps {
  points: readonly { lat: number; lon: number }[];
  /** Side of the square, dp. */
  size?: number;
}

/** The shape of a route as a small SVG line, north up: no map, no network. Start is a filled dot, end a ring. */
export function RouteThumbnail({ points, size = 64 }: RouteThumbnailProps) {
  const { colors, radius } = useTheme();
  const padding = Math.max(6, Math.round(size / 8));
  const projected = useMemo(() => projectRoute(points, size, size, padding), [points, size, padding]);
  return (
    <View
      importantForAccessibility="no-hide-descendants"
      accessibilityElementsHidden
      style={[styles.box, { width: size, height: size, backgroundColor: colors.muted, borderRadius: radius.tile }]}>
      {projected ? (
        <Svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
          <Polyline points={projected.polyline} fill="none" stroke={colors.workouts} strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round" />
          <Circle cx={projected.start.x} cy={projected.start.y} r={3} fill={colors.workouts} />
          <Circle cx={projected.end.x} cy={projected.end.y} r={3.5} fill={colors.muted} stroke={colors.workouts} strokeWidth={2} />
        </Svg>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { overflow: 'hidden' },
});
