import { useMemo, useSyncExternalStore } from 'react';

import { useLiveWorkout } from '@/state/LiveWorkoutProvider';

import { deriveSession, type LiveSession, type SportKind } from './liveSession';

/** The kind the person picked for a workout the band did not name, by session id (`setSportKind`). Lives as long as the app does. */
let picked: ReadonlyMap<number, SportKind> = new Map();
const listeners = new Set<() => void>();

/** Lets the person say what an outdoor workout the band did not name is (run, walk, ride, hike). It is no longer a guess then. */
export function setSportKind(id: number, kind: SportKind): void {
  picked = new Map(picked).set(id, kind);
  for (const l of listeners) l();
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
const snapshot = () => picked;

/** The workout followed on the watch, in the shape the live screens read (`liveSession.ts`); null when none. */
export function useLiveSession(): LiveSession | null {
  const live = useLiveWorkout();
  const choices = useSyncExternalStore(subscribe, snapshot);
  return useMemo(() => (live ? deriveSession(live, choices.get(live.id) ?? null, Date.now()) : null), [live, choices]);
}
