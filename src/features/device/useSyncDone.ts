import { useEffect, useState } from 'react';

import { IDLE_SYNC, trackSync } from '@/components/motionMath';

/** How long the "done" check stays up after a sync. */
const HOLD_MS = 1800;

/**
 * True for a moment after a sync finishes and moved the last-sync time on: the cue to show a check where the spinner was. A sync that
 * ends without a new last-sync time (it failed; the error shows elsewhere) shows no check. Background syncs, which never pass through
 * `syncing`, are not announced.
 */
export function useSyncDone(syncing: boolean, lastSync: number | null): boolean {
  const [track, setTrack] = useState(IDLE_SYNC);
  // Adjusted while rendering, the way React documents for state that follows props.
  const next = trackSync(track, syncing, lastSync);
  if (next !== track) setTrack(next);

  const done = next.done;
  useEffect(() => {
    if (!done) return;
    const timer = setTimeout(() => setTrack(IDLE_SYNC), HOLD_MS);
    return () => clearTimeout(timer);
  }, [done]);

  return done;
}
