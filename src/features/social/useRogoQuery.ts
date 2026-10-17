import { useFocusEffect } from 'expo-router';
import { useCallback, useRef, useState } from 'react';

import { errorMessage } from '@/format';

export interface RogoQuery<T> {
  data: T | null;
  /** Last failure; cleared by the next success. `data` keeps the previous answer meanwhile. */
  error: string | null;
  /** Pull-to-refresh is running. */
  refreshing: boolean;
  /** Reads again without blanking the screen. */
  refresh: () => Promise<void>;
  /** Replaces the answer, for a change the server has just confirmed. */
  setData: (data: T) => void;
}

/**
 * One JoyoRogo read, run every time the screen gains focus while `enabled` (a signed-in session). `load` must be stable
 * (`useCallback`); a new one reads again. An answer that arrives after a newer read started is dropped.
 */
export function useRogoQuery<T>(load: () => Promise<T>, enabled: boolean): RogoQuery<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const generation = useRef(0);

  const read = useCallback(async () => {
    const mine = ++generation.current;
    try {
      const answer = await load();
      if (mine !== generation.current) return;
      setData(answer);
      setError(null);
    } catch (e) {
      if (mine === generation.current) setError(errorMessage(e));
    }
  }, [load]);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    await read();
    setRefreshing(false);
  }, [read]);

  useFocusEffect(
    useCallback(() => {
      if (enabled) void read();
    }, [enabled, read]),
  );

  return { data, error, refreshing, refresh, setData };
}
