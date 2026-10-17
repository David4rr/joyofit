import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Animated, Easing, type StyleProp, type ViewStyle } from 'react-native';

import { AppText, type AppTextProps } from '@/components/AppText';
import { countUpValue } from '@/components/motionMath';
import { useReducedMotion } from '@/hooks/useReducedMotion';

/** Strong ease-out: movement starts at once and settles softly. */
export const EASE_OUT = Easing.bezier(0.23, 1, 0.32, 1);
/** Ring fills and number count-ups share this, so the arc and the digits land together. */
export const FILL_MS = 500;

interface FadeInProps {
  children: ReactNode;
  /** Wait before starting, for staggering a list; keep steps to 30-60 ms. */
  delay?: number;
  /** How far it rises while fading in. Under reduced motion it only fades. */
  distance?: number;
  duration?: number;
  style?: StyleProp<ViewStyle>;
}

/** Enters once on mount: fades in while rising a few dp. Transform and opacity only, on the native thread. */
export function FadeIn({ children, delay = 0, distance = 8, duration = 240, style }: FadeInProps) {
  const reduced = useReducedMotion();
  const [progress] = useState(() => new Animated.Value(0));

  useEffect(() => {
    const run = Animated.timing(progress, {
      toValue: 1,
      duration: reduced ? 120 : duration,
      delay: reduced ? 0 : delay,
      easing: EASE_OUT,
      useNativeDriver: true,
    });
    run.start();
    return () => run.stop();
    // Mount only: a later reduced-motion flip must not replay the entrance.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <Animated.View
      style={[
        style,
        {
          opacity: progress,
          transform: [{ translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [reduced ? 0 : distance, 0] }) }],
        },
      ]}>
      {children}
    </Animated.View>
  );
}

/** A glyph that appears with a short scale-up and fade, for a state that just resolved (a check after a spinner). */
export function PopIn({ children }: { children: ReactNode }) {
  const reduced = useReducedMotion();
  const [progress] = useState(() => new Animated.Value(0));
  useEffect(() => {
    const run = Animated.timing(progress, { toValue: 1, duration: reduced ? 120 : 200, easing: EASE_OUT, useNativeDriver: true });
    run.start();
    return () => run.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <Animated.View
      style={{
        opacity: progress,
        transform: [{ scale: progress.interpolate({ inputRange: [0, 1], outputRange: [reduced ? 1 : 0.6, 1] }) }],
      }}>
      {children}
    </Animated.View>
  );
}

/**
 * Text of `value` that counts up from 0 on mount and between values after that, ending on the exact figure. Null gives null.
 * Only the component using it re-renders while it counts; it shows the figure at once under reduced motion.
 */
export function useCountUp(value: number | null, decimals: number, suffix: string, duration: number = FILL_MS): string | null {
  const reduced = useReducedMotion();
  const start = reduced && value !== null ? value : 0;
  const shown = useRef(start);
  const [text, setText] = useState(() => `${start.toFixed(decimals)}${suffix}`);

  useEffect(() => {
    if (value === null) return;
    if (reduced) {
      shown.current = value;
      return;
    }
    const from = shown.current;
    const started = Date.now();
    let frame = 0;
    const tick = () => {
      const now = countUpValue(from, value, Date.now() - started, duration);
      shown.current = now;
      const next = `${now.toFixed(decimals)}${suffix}`;
      setText((prev) => (prev === next ? prev : next));
      if (now !== value) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [value, decimals, suffix, duration, reduced]);

  if (value === null) return null;
  return reduced ? `${value.toFixed(decimals)}${suffix}` : text;
}

interface CountUpTextProps extends Omit<AppTextProps, 'children'> {
  value: number | null;
  decimals?: number;
  suffix?: string;
  /** Shown while `value` is null. */
  fallback?: string;
}

/** `AppText` that counts to `value`; digits are tabular so the width does not jitter. */
export function CountUpText({ value, decimals = 0, suffix = '', fallback = '--', style, ...rest }: CountUpTextProps) {
  const text = useCountUp(value, decimals, suffix);
  return (
    <AppText {...rest} style={[{ fontVariant: ['tabular-nums'] }, style]}>
      {text ?? fallback}
    </AppText>
  );
}

/**
 * A scale for a quick bump (up, then back) each time `trigger` changes, but not on the first render. Pass `enabled` false to skip
 * a change, e.g. a kudos taken back. Native thread; no bump under reduced motion.
 */
export function useBump(trigger: unknown, enabled = true, peak = 1.22): Animated.Value {
  const reduced = useReducedMotion();
  const [scale] = useState(() => new Animated.Value(1));
  const first = useRef(true);

  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    if (!enabled || reduced) return;
    const run = Animated.sequence([
      Animated.timing(scale, { toValue: peak, duration: 100, easing: EASE_OUT, useNativeDriver: true }),
      Animated.timing(scale, { toValue: 1, duration: 160, easing: EASE_OUT, useNativeDriver: true }),
    ]);
    run.start();
    return () => run.stop();
    // `enabled` is read at the moment `trigger` changes; flipping it alone must not bump.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trigger]);

  return scale;
}

/** 0 or 1, eased between them over 160 ms whenever `on` flips, for the colors of a toggled control. JS-driven: colors cannot use the native driver. */
export function useToggleMix(on: boolean): Animated.Value {
  const reduced = useReducedMotion();
  const [mix] = useState(() => new Animated.Value(on ? 1 : 0));
  useEffect(() => {
    const run = Animated.timing(mix, { toValue: on ? 1 : 0, duration: reduced ? 0 : 160, easing: EASE_OUT, useNativeDriver: false });
    run.start();
    return () => run.stop();
  }, [mix, on, reduced]);
  return mix;
}

/** `true` for `ms` after `flash()` is called, for a confirmation that clears itself. */
export function useFlash(ms: number): [boolean, () => void] {
  const [on, setOn] = useState(false);
  // Each call bumps the stamp, which restarts the clear-after timer; `on` itself is set by the call.
  const [stamp, setStamp] = useState(0);
  useEffect(() => {
    if (stamp === 0) return;
    const timer = setTimeout(() => setOn(false), ms);
    return () => clearTimeout(timer);
  }, [stamp, ms]);
  return [
    on,
    () => {
      setOn(true);
      setStamp((n) => n + 1);
    },
  ];
}
