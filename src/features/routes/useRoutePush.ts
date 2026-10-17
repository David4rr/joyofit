import { useEventListener } from 'expo';
import { useCallback, useRef, useState } from 'react';

import { useNativeRefresh } from '@/features/settings/useNativeRefresh';
import { errorMessage } from '@/format';
import { useWatch } from '@/state/WatchProvider';
import { HuaweiWear, type RoutesStatus, type UploadProgressEvent } from '@/wear';

import { copy } from './copy';
import { outcomeFromError, outcomeFromResult, type PushOutcome } from './pushOutcome';
import type { RoutePoint, SavedRoute } from './routeModel';
import { markRouteSent } from './routeStore';
import { buildWatchRoute } from './watchRoute';

/** `preparing`: the route is being built and the watch asked; `sending`: bytes are going over; `waiting`: all sent, the watch has not answered yet. */
export type PushPhase = 'idle' | 'preparing' | 'sending' | 'waiting';

interface RoutePushOptions {
  route: SavedRoute | null;
  points: readonly RoutePoint[];
  /** Renames the saved route and returns it; null when it no longer exists. Used by "rename and send again". */
  rename: (name: string) => Promise<SavedRoute | null>;
  /** The route reached the watch: its current record (with the new `lastSentAt` when that could be saved), so the screen can update its copy. */
  onSent: (route: SavedRoute) => void;
}

const NO_ROUTES: RoutesStatus = { p2p: false, deliver: false, altitude: false, image: false, sceneTypes: false, climb: false };

/** An older native build has no `getRoutes` / `pushRoute` at all; calling them would throw a TypeError. */
const nativeRoutesAvailable = typeof HuaweiWear.getRoutes === 'function' && typeof HuaweiWear.pushRoute === 'function';

function readRoutesStatus(): RoutesStatus {
  return nativeRoutesAvailable ? HuaweiWear.getRoutes() : NO_ROUTES;
}

/** What `useRoutePush` hands the screen. */
export interface RoutePush {
  /** A watch is connected (or syncing). */
  connected: boolean;
  /** What the watch lists for routes; all false while no watch is connected. */
  status: RoutesStatus;
  phase: PushPhase;
  /** Share of the file the watch has acknowledged, 0 to 100. */
  percent: number;
  /** The result of the last send; null before the first and while one is running. */
  outcome: PushOutcome | null;
  /** The route was sent but the "last sent" note could not be saved. */
  recordError: string | null;
  /** The native module of this build has no route calls (an older dev build); the screen says the app needs an update. */
  appOutdated: boolean;
  sending: boolean;
  /** Sends the route; `newName` renames it first (the watch refuses a second route with the same name). */
  send: (newName?: string) => Promise<void>;
}

/**
 * Sending a saved route to the watch: whether the watch is connected and lists route support, the push itself with its
 * progress (`onUploadProgress`), and what the outcome means in words. Every failure ends up in `outcome`; nothing is
 * swallowed.
 */
export function useRoutePush({ route, points, rename, onSent }: RoutePushOptions): RoutePush {
  const { linkState } = useWatch();
  const connected = linkState === 'connected' || linkState === 'syncing';
  const [, setRefreshes] = useState(0);
  const [phase, setPhase] = useState<PushPhase>('idle');
  const [progress, setProgress] = useState<UploadProgressEvent | null>(null);
  const [outcome, setOutcome] = useState<PushOutcome | null>(null);
  const [recordError, setRecordError] = useState<string | null>(null);
  const running = useRef(false);

  useNativeRefresh(useCallback(() => setRefreshes((n) => n + 1), []));
  // The watch's route gates arrive with the connection: read them on every render (a link change re-renders through useWatch)
  // and again, by forcing a render, whenever the screen gets focus or the app comes back.
  const status: RoutesStatus = readRoutesStatus();

  useEventListener(HuaweiWear, 'onUploadProgress', (event) => {
    if (!running.current) return;
    setProgress(event);
    setPhase(event.total > 0 && event.bytes >= event.total ? 'waiting' : 'sending');
  });

  /** Sends the route; `newName` renames it first (the watch refuses a second route with the same name). */
  const send = useCallback(
    async (newName?: string) => {
      if (route === null || running.current) return;
      running.current = true;
      setOutcome(null);
      setRecordError(null);
      setProgress(null);
      setPhase('preparing');
      try {
        let current = route;
        if (newName !== undefined) {
          const renamed = await rename(newName);
          if (renamed === null) throw new Error(copy.detail.notFound);
          current = renamed;
        }
        if (!nativeRoutesAvailable) throw new Error(copy.push.appOutdated);
        const result = await HuaweiWear.pushRoute(buildWatchRoute(current.name, points));
        const next = outcomeFromResult(result, points.length);
        if (next.kind === 'sent') {
          let marked: SavedRoute | null = null;
          try {
            marked = await markRouteSent(current.id);
          } catch (e) {
            setRecordError(copy.push.recordFailed(errorMessage(e)));
          }
          onSent(marked ?? current);
        }
        setOutcome(next);
      } catch (e) {
        setOutcome(outcomeFromError(e));
      } finally {
        running.current = false;
        setPhase('idle');
        setProgress(null);
      }
    },
    [route, points, rename, onSent],
  );

  const percent = progress && progress.total > 0 ? Math.min(100, Math.round((progress.bytes / progress.total) * 100)) : 0;
  return { connected, status, appOutdated: !nativeRoutesAvailable, phase, percent, outcome, recordError, sending: phase !== 'idle', send };
}
