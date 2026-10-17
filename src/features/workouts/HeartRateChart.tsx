import { useEffect, useMemo, useState } from 'react';
import { Animated, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { EASE_OUT } from '@/components/motion';
import { sweepRange } from '@/components/motionMath';
import type { WorkoutPointRow } from '@/db/queries';
import { heartRateBuckets } from '@/features/workouts/summary';
import { formatClock } from '@/format';
import { useReducedMotion } from '@/hooks/useReducedMotion';
import { useColors } from '@/theme';

const BAR_AREA_HEIGHT = 96;
const BUCKETS = 60;
const BAR_RADIUS = 3;
/** The bars grow from the baseline, left to right, in this long. */
const DRAW_MS = 520;
/** Share of that time spent on the stagger between the first and the last bar. */
const DRAW_SPREAD = 0.55;

/** Heart rate over the workout as 60 bars of averaged readings. Plain Views, no chart library. */
export function HeartRateChart({
  points,
  start,
  end,
}: {
  points: readonly WorkoutPointRow[];
  start: number;
  end: number;
}) {
  const colors = useColors();
  const reduced = useReducedMotion();
  const buckets = useMemo(() => heartRateBuckets(points, start, end, BUCKETS), [points, start, end]);
  const [draw] = useState(() => new Animated.Value(0));
  // The baseline sits below the lowest reading so a steady heart rate still shows its shape.
  const lo = buckets ? Math.max(30, buckets.min - 10) : 0;
  // Built once per set of readings so a re-render does not rebuild the native animation graph.
  const bars = useMemo(() => {
    if (!buckets) return [];
    const hi = Math.max(buckets.max, lo + 1);
    return buckets.values.map((value, i) => {
      if (value === null) return null;
      const height = Math.max(2, ((value - lo) / (hi - lo)) * BAR_AREA_HEIGHT);
      const [from, to] = sweepRange(i, buckets.values.length, DRAW_SPREAD);
      const grown = draw.interpolate({ inputRange: [from, to], outputRange: [0, 1], extrapolate: 'clamp' });
      return {
        height,
        opacity: grown,
        // Scales about its middle, so it slides down by the missing half to keep its foot on the baseline.
        transform: [{ translateY: grown.interpolate({ inputRange: [0, 1], outputRange: [height / 2, 0] }) }, { scaleY: grown }],
      };
    });
  }, [buckets, lo, draw]);

  // Draws in once per set of readings; one value on the native thread drives every bar.
  useEffect(() => {
    if (!buckets) return;
    if (reduced) {
      draw.setValue(1);
      return;
    }
    draw.setValue(0);
    const run = Animated.timing(draw, { toValue: 1, duration: DRAW_MS, easing: EASE_OUT, useNativeDriver: true });
    run.start();
    return () => run.stop();
  }, [buckets, draw, reduced]);

  if (!buckets) {
    return (
      <AppText variant="caption" muted>
        No heart-rate readings stored for this workout.
      </AppText>
    );
  }
  return (
    <View
      accessible
      accessibilityLabel={`Heart rate from ${buckets.min} to ${buckets.max} bpm`}
      style={styles.wrap}>
      <View style={styles.row}>
        <View style={styles.bars}>
          {bars.map((bar, i) => (
            <View key={i} style={styles.slot}>
              {bar ? (
                <Animated.View
                  style={[
                    { height: bar.height, backgroundColor: colors.heart, borderTopLeftRadius: BAR_RADIUS, borderTopRightRadius: BAR_RADIUS },
                    { opacity: bar.opacity, transform: bar.transform },
                  ]}
                />
              ) : null}
            </View>
          ))}
        </View>
        <View style={styles.scale}>
          <AppText variant="caption" muted>
            {buckets.max}
          </AppText>
          <AppText variant="caption" muted>
            {lo}
          </AppText>
        </View>
      </View>
      <View style={[styles.axis, { borderTopColor: colors.hairline }]}>
        <AppText variant="caption" muted>
          {formatClock(start)}
        </AppText>
        <AppText variant="caption" muted>
          {formatClock(end)}
        </AppText>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 6 },
  row: { flexDirection: 'row', gap: 8 },
  bars: { flex: 1, flexDirection: 'row', height: BAR_AREA_HEIGHT, alignItems: 'flex-end', gap: 1 },
  slot: { flex: 1, justifyContent: 'flex-end' },
  scale: { height: BAR_AREA_HEIGHT, justifyContent: 'space-between', alignItems: 'flex-end' },
  axis: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: 4,
  },
});
