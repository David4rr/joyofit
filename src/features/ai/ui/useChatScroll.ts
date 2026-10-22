import { useCallback, useMemo, useRef, useState } from 'react';
import type { FlatList, NativeScrollEvent, NativeSyntheticEvent } from 'react-native';

import { AWAY_PX } from './chatState';

/**
 * Scrolling of the chat list, an inverted `FlatList` (offset 0 is the newest message). Nothing here moves the list while text streams:
 * the list keeps the person at the end by itself (`maintainVisibleContentPosition` with an auto-scroll threshold, native), and keeps
 * what they are reading in place when they have scrolled up. This hook only knows whether they are away from the end (for the "Ke
 * terbaru" button) and how to jump back. The `away` state flips at most when the person crosses the threshold, never per token.
 */
export function useChatScroll() {
  const ref = useRef<FlatList>(null);
  const [away, setAway] = useState(false);
  const awayRef = useRef(false);

  const onScroll = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const next = e.nativeEvent.contentOffset.y > AWAY_PX;
    if (next !== awayRef.current) {
      awayRef.current = next;
      setAway(next);
    }
  }, []);

  const scrollProps = useMemo(() => ({ onScroll, scrollEventThrottle: 64 }), [onScroll]);

  /** The person sent something, opened a chat or pressed "Ke terbaru": show the newest message. */
  const follow = useCallback(() => {
    awayRef.current = false;
    setAway(false);
    ref.current?.scrollToOffset({ offset: 0, animated: false });
  }, []);

  return { ref, away, scrollProps, follow };
}
