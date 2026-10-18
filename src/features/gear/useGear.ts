import { useFocusEffect } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useState } from 'react';

import { allGearTotals, listDefaults, listGear } from './store';
import type { Gear, GearDefault, GearTotals } from './model';

export interface GearState {
  /** Gear not deleted: in use first, then retired. */
  gear: Gear[];
  totals: ReadonlyMap<string, GearTotals>;
  defaults: GearDefault[];
}

const EMPTY: GearState = { gear: [], totals: new Map(), defaults: [] };

/** The gear screens' data: read when the screen comes into focus and again on `reload()` (after an edit). `ready` is false until the first read. */
export function useGear(): GearState & { ready: boolean; reload: () => Promise<void> } {
  const db = useSQLiteContext();
  const [state, setState] = useState<GearState>(EMPTY);
  const [ready, setReady] = useState(false);

  const reload = useCallback(async () => {
    const [gear, totals, defaults] = await Promise.all([listGear(db), allGearTotals(db), listDefaults(db)]);
    setState({ gear, totals, defaults });
    setReady(true);
  }, [db]);

  useFocusEffect(
    useCallback(() => {
      void reload().catch(() => {});
    }, [reload]),
  );

  return { ...state, ready, reload };
}
