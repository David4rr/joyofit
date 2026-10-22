import { useEffect, useId, useState, type ReactNode } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';
import Svg, { Circle, Defs, Mask } from 'react-native-svg';

import { FILL_MS } from '@/components/motion';
import { useReducedMotion } from '@/hooks/useReducedMotion';
import { useTheme } from '@/theme';

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

interface RingProps {
  size: number;
  stroke: number;
  value: number;
  max: number;
  color: string;
  track: string;
  accessibilityLabel: string;
  /** Centered inside the ring. */
  children?: ReactNode;
}

/** Gap between dots of a dotted ring, in stroke widths from center to center. */
const DOT_PITCH = 2;

/** Progress ring. Fills once on mount and when the value changes (`FILL_MS`); static under reduced motion. A dotted theme draws it as dots. */
export function Ring({ size, stroke, value, max, color, track, accessibilityLabel, children }: RingProps) {
  const reduced = useReducedMotion();
  const dotted = useTheme().theme.dottedRings === true;
  const maskId = useId();
  const ratio = max > 0 ? Math.min(1, Math.max(0, value / max)) : 0;
  const [progress] = useState(() => new Animated.Value(0));

  useEffect(() => {
    if (reduced) {
      progress.setValue(ratio);
      return;
    }
    Animated.timing(progress, {
      toValue: ratio,
      duration: FILL_MS,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false,
    }).start();
  }, [progress, ratio, reduced]);

  const r = (size - stroke) / 2;
  const circumference = 2 * Math.PI * r;
  const half = size / 2;
  // Whole number of dots around the ring so the pattern closes without a short gap. A near-zero dash with a round cap is one dot.
  const dotCount = Math.max(12, Math.round(circumference / (stroke * DOT_PITCH)));
  const dotDash = [0.01, circumference / dotCount - 0.01];

  return (
    <View
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={accessibilityLabel}
      accessibilityValue={{ min: 0, max: Math.round(max), now: Math.round(Math.min(value, max)) }}
      style={{ width: size, height: size }}>
      <Svg width={size} height={size}>
        {dotted ? (
          <>
            <Defs>
              <Mask id={maskId} x={0} y={0} width={size} height={size} maskUnits="userSpaceOnUse">
                <Circle
                  cx={half}
                  cy={half}
                  r={r}
                  stroke="#FFFFFF"
                  strokeWidth={stroke}
                  strokeLinecap="round"
                  fill="none"
                  strokeDasharray={dotDash}
                  transform={`rotate(-90 ${half} ${half})`}
                />
              </Mask>
            </Defs>
            <Circle
              cx={half}
              cy={half}
              r={r}
              stroke={track}
              strokeWidth={stroke}
              strokeLinecap="round"
              fill="none"
              strokeDasharray={dotDash}
              transform={`rotate(-90 ${half} ${half})`}
            />
            <AnimatedCircle
              cx={half}
              cy={half}
              r={r}
              stroke={color}
              strokeWidth={stroke}
              fill="none"
              mask={`url(#${maskId})`}
              strokeDasharray={circumference}
              strokeDashoffset={progress.interpolate({ inputRange: [0, 1], outputRange: [circumference, 0] })}
              transform={`rotate(-90 ${half} ${half})`}
            />
          </>
        ) : (
          <>
            <Circle cx={half} cy={half} r={r} stroke={track} strokeWidth={stroke} fill="none" />
            <AnimatedCircle
              cx={half}
              cy={half}
              r={r}
              stroke={color}
              strokeWidth={stroke}
              strokeLinecap="round"
              fill="none"
              strokeDasharray={circumference}
              strokeDashoffset={progress.interpolate({ inputRange: [0, 1], outputRange: [circumference, 0] })}
              transform={`rotate(-90 ${half} ${half})`}
            />
          </>
        )}
      </Svg>
      {children ? (
        <View style={[StyleSheet.absoluteFill, styles.center]} pointerEvents="none">
          {children}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  center: { alignItems: 'center', justifyContent: 'center' },
});
