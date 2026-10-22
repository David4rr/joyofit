import { useCallback, useMemo, useRef, useState } from 'react';
import type { LayoutChangeEvent, NativeScrollEvent, NativeSyntheticEvent, ScrollView } from 'react-native';

import { isNearBottom, type ScrollMetrics } from './chatState';

/**
 * Keeps a chat at its end while it grows, but only for a person who is at the end: scrolling up stops the following and shows
 * `away` (for the "Ke terbaru" button) until they come back to the bottom or jump there. Feed `scrollProps` to `Screen`.
 * Scrolls are not animated: a smooth scroll reports positions far from the end on its way and would read as "scrolled away".
 */
export function useChatScroll() {
  const ref = useRef<ScrollView>(null);
  const metrics = useRef<ScrollMetrics>({ offsetY: 0, viewportH: 0, contentH: 0 });
  const following = useRef(true);
  const [away, setAway] = useState(false);

  const sync = useCallback(() => {
    const near = isNearBottom(metrics.current);
    following.current = near;
    setAway((prev) => (prev === !near ? prev : !near));
  }, []);

  const toEnd = useCallback(() => ref.current?.scrollToEnd({ animated: false }), []);

  const scrollProps = useMemo(
    () => ({
      scrollEventThrottle: 16,
      onScroll: (e: NativeSyntheticEvent<NativeScrollEvent>) => {
        const { contentOffset, layoutMeasurement, contentSize } = e.nativeEvent;
        metrics.current = { offsetY: contentOffset.y, viewportH: layoutMeasurement.height, contentH: contentSize.height };
        sync();
      },
      onContentSizeChange: (_w: number, h: number) => {
        metrics.current = { ...metrics.current, contentH: h };
        if (following.current) toEnd();
        else sync();
      },
      onLayout: (e: LayoutChangeEvent) => {
        metrics.current = { ...metrics.current, viewportH: e.nativeEvent.layout.height };
        if (following.current) toEnd();
        else sync();
      },
    }),
    [sync, toEnd],
  );

  /** The person sent something or opened a chat: show its end and follow again. */
  const follow = useCallback(() => {
    following.current = true;
    setAway(false);
    toEnd();
  }, [toEnd]);

  return { ref, away, scrollProps, follow };
}
