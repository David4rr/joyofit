import { useFocusEffect } from 'expo-router';
import { useCallback, useRef, useState } from 'react';

import type { RogoPost, RogoPostPage } from '@/cloud/rogo';
import { errorMessage } from '@/format';

interface Loaded<R> {
  key: string;
  /** What the first page's answer carried (the whole `publicProfile` for a profile screen). */
  head: R;
  items: RogoPost[];
  nextCursor: number | null;
}

export interface PagedPosts<R> {
  /** The first answer, null while it loads or after `key` changed. */
  head: R | null;
  /** Null until the first page is in; never null for a refresh of a list that is already showing. */
  items: RogoPost[] | null;
  error: string | null;
  refreshing: boolean;
  loadingMore: boolean;
  hasMore: boolean;
  refresh: () => Promise<void>;
  loadMore: () => Promise<void>;
  /** Swaps in a post the server has just changed (kudos). */
  replace: (post: RogoPost) => void;
}

/** For lists whose answer is the page itself (`social.feed`, `social.myPosts`). */
export const wholePage = (answer: RogoPostPage) => answer;

/**
 * A cursor-paged list of posts, read on focus while `enabled`. `key` names what is listed (the feed tab): a new key drops
 * the old items at once and reads from the start. `fetch` must be stable (`useCallback`) and change with `key`; `pageOf`
 * picks the page out of an answer and must be stable too. Answers of an older read are dropped.
 */
export function usePagedPosts<R>(
  key: string,
  fetch: (cursor?: number) => Promise<R>,
  pageOf: (answer: R) => RogoPostPage,
  enabled: boolean,
): PagedPosts<R> {
  const [loaded, setLoaded] = useState<Loaded<R> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const generation = useRef(0);
  const current = loaded?.key === key ? loaded : null;

  const read = useCallback(async () => {
    const mine = ++generation.current;
    try {
      const head = await fetch();
      if (mine !== generation.current) return;
      const page = pageOf(head);
      setLoaded({ key, head, items: page.items, nextCursor: page.nextCursor });
      setError(null);
    } catch (e) {
      if (mine === generation.current) setError(errorMessage(e));
    }
  }, [fetch, pageOf, key]);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    await read();
    setRefreshing(false);
  }, [read]);

  const loadMore = useCallback(async () => {
    if (!current || current.nextCursor === null || loadingMore) return;
    const mine = generation.current;
    setLoadingMore(true);
    try {
      const page = pageOf(await fetch(current.nextCursor));
      if (mine !== generation.current) return;
      setLoaded((prev) =>
        prev?.key === key ? { ...prev, items: [...prev.items, ...page.items], nextCursor: page.nextCursor } : prev,
      );
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setLoadingMore(false);
    }
  }, [current, loadingMore, fetch, pageOf, key]);

  const replace = useCallback(
    (post: RogoPost) =>
      setLoaded((prev) => (prev ? { ...prev, items: prev.items.map((p) => (p.id === post.id ? post : p)) } : prev)),
    [],
  );

  useFocusEffect(
    useCallback(() => {
      if (enabled) void read();
    }, [enabled, read]),
  );

  return {
    head: current?.head ?? null,
    items: current?.items ?? null,
    error,
    refreshing,
    loadingMore,
    hasMore: current?.nextCursor != null,
    refresh,
    loadMore,
    replace,
  };
}
