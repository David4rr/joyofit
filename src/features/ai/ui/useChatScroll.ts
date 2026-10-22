import { useCallback, useMemo, useRef, useState } from 'react';
import type { FlatList, NativeScrollEvent, NativeSyntheticEvent } from 'react-native';

import { AWAY_PX, BACK_PX, nextAway, shiftOnGrowth } from './chatState';

/** How long after a change to the newest message a growth of the content is still the person's reading position moving (ms). */
const COMPENSATE_MS = 600;

/**
 * Scrolling of the chat list, an inverted `FlatList` (offset 0 is the newest message). The rule: the list never moves by itself
 * unless the person is at the newest message (then growing text keeps them there, because the newest cell grows away from offset 0)
 * or presses "Ke terbaru" or sends something. Nothing is anchored by the native list (`maintainVisibleContentPosition` pulled the view
 * back to the newest message while someone read older text during an answer).
 *
 * While the person is away from the newest message the answer being written is not drawn (`away` is read by the screen to hold its
 * updates back); when the answer is finished the content grows below what they read, and `expectGrowth` moves the offset by exactly
 * that growth once, so what they were reading stays where it was.
 */
export function useChatScroll() {
  const ref = useRef<FlatList>(null);
  const [away, setAway] = useState(false);
  const awayRef = useRef(false);
  const offset = useRef(0);
  const contentH = useRef(0);
  const compensateUntil = useRef(0);
  const afterAway = useRef<(() => void) | null>(null);
  const lastLogged = useRef(0);

  const onScroll = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    offset.current = e.nativeEvent.contentOffset.y;
    if (Math.abs(offset.current - lastLogged.current) > 300) {
      lastLogged.current = offset.current;
      console.log(`[joyoai-scroll] offset ${Math.round(offset.current)} away=${awayRef.current ? 1 : 0}`);
    }
    const next = nextAway(awayRef.current, offset.current);
    if (next !== awayRef.current) {
      awayRef.current = next;
      setAway(next);
      // Back near the newest message: the screen draws the answer as it is now.
      if (!next) afterAway.current?.();
    }
  }, []);

  const onContentSizeChange = useCallback((_w: number, h: number) => {
    const delta = shiftOnGrowth({ prev: contentH.current, next: h, offset: offset.current, away: awayRef.current, windowOpen: Date.now() < compensateUntil.current });
    contentH.current = h;
    console.log(`[joyoai-scroll] content ${Math.round(h)} delta ${delta}`);
    if (delta > 0) {
      offset.current += delta;
      ref.current?.scrollToOffset({ offset: offset.current, animated: false });
    }
  }, []);

  const scrollProps = useMemo(() => ({ onScroll, onContentSizeChange, scrollEventThrottle: 64 }), [onScroll, onContentSizeChange]);

  /** The newest message is about to change height (an answer finishes, a note is decided): keep a reading position in place. */
  const expectGrowth = useCallback(() => {
    compensateUntil.current = Date.now() + COMPENSATE_MS;
  }, []);

  /** The person sent something, opened a chat or pressed "Ke terbaru": show the newest message. */
  const follow = useCallback(() => {
    console.log('[joyoai-scroll] follow()');
    awayRef.current = false;
    offset.current = 0;
    compensateUntil.current = 0;
    setAway(false);
    ref.current?.scrollToOffset({ offset: 0, animated: false });
    afterAway.current?.();
  }, []);

  /** Called when the person comes back near the newest message (by scrolling or by "Ke terbaru"). */
  const onBack = useCallback((fn: () => void) => {
    afterAway.current = fn;
  }, []);

  return { ref, away, awayRef, scrollProps, follow, expectGrowth, onBack };
}
