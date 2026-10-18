import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Animated, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { EASE_OUT } from '@/components/motion';
import { useReducedMotion } from '@/hooks/useReducedMotion';
import { radius, spacing, useColors } from '@/theme';

interface StepProgressProps {
  /** 1-based position of the step on screen. */
  index: number;
  total: number;
}

/** "Step 3 of 10" over a bar that fills as the guide goes on, sliding to each new step in 250 ms. */
export function StepProgress({ index, total }: StepProgressProps) {
  const { t } = useTranslation('onboarding');
  const colors = useColors();
  const reduced = useReducedMotion();
  const share = index / total;
  const [trackWidth, setTrackWidth] = useState(0);
  const [fill] = useState(() => new Animated.Value(share));

  // The fill is always full width and slides in from the left, so only a transform moves.
  useEffect(() => {
    const run = Animated.timing(fill, { toValue: share, duration: reduced ? 0 : 250, easing: EASE_OUT, useNativeDriver: true });
    run.start();
    return () => run.stop();
  }, [fill, share, reduced]);

  return (
    <View style={styles.wrap}>
      <AppText variant="label" muted>
        {t('progress.stepOf', { index, total })}
      </AppText>
      <View
        accessibilityRole="progressbar"
        accessibilityLabel={t('progress.label')}
        accessibilityValue={{ min: 1, max: total, now: index }}
        onLayout={(event) => setTrackWidth(event.nativeEvent.layout.width)}
        style={[styles.track, { backgroundColor: colors.muted }]}>
        <Animated.View
          style={[
            styles.fill,
            {
              backgroundColor: colors.primary,
              transform: [{ translateX: fill.interpolate({ inputRange: [0, 1], outputRange: [-trackWidth, 0] }) }],
            },
          ]}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.sm },
  track: { height: 6, borderRadius: radius.pill, overflow: 'hidden' },
  fill: { height: 6, width: '100%', borderRadius: radius.pill },
});
