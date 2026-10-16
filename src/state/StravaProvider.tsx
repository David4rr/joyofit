import * as Linking from 'expo-linking';
import { useSQLiteContext } from 'expo-sqlite';
import * as WebBrowser from 'expo-web-browser';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { AppState } from 'react-native';

import { authClient } from '@/cloud/auth';
import { CLOUD_CONFIGURED } from '@/cloud/config';
import {
  autoUploadNewWorkouts,
  disconnectStrava,
  fetchStravaAuthorizeUrl,
  syncStravaStatus,
} from '@/cloud/strava';
import { getStravaSettings, setStravaAddLink, type StravaSettings } from '@/db/strava';
import { errorMessage } from '@/format';
import { useWatch } from '@/state/WatchProvider';

/** Same debounce as the cloud upload: a burst of sync events becomes one pass. */
const AUTO_UPLOAD_DEBOUNCE_MS = 3_000;
/** The deep link the Worker's callback redirects to (`server/src/strava.ts`). */
const RETURN_URL = 'joyofit://settings/strava';

export interface StravaContextValue {
  /** The cloud server URL is set in this build (the Worker owns the Strava connection). */
  configured: boolean;
  /** A JoyoRogo session exists; connecting Strava needs it, uploading does not need Pro. */
  signedIn: boolean;
  settings: StravaSettings;
  /** False when the Worker has no Strava client secret yet. Null until it has answered. */
  serverReady: boolean | null;
  busy: boolean;
  error: string | null;
  connect: () => Promise<void>;
  disconnect: () => Promise<void>;
  setAddLink: (on: boolean) => Promise<void>;
  /** Re-reads the connection from the Worker (after returning from Strava or the app coming to the foreground). */
  refresh: () => Promise<void>;
}

const EMPTY: StravaSettings = { connectedAt: null, athleteId: null, addLink: false };

const StravaContext = createContext<StravaContextValue | null>(null);

export function useStrava(): StravaContextValue {
  const value = useContext(StravaContext);
  if (!value) throw new Error('useStrava must be used inside StravaProvider');
  return value;
}

const FAILURES: Record<string, string> = {
  access_denied: 'Strava was not connected: access was declined.',
  scope_missing: 'Strava was not connected: JoyoFit needs the "upload your activities" permission. Connect again and keep it ticked.',
  invalid_state: 'The Strava connection took too long. Try again.',
};

/**
 * The Strava connection of this phone: connect and disconnect through the Worker, the "add link" choice, and the
 * automatic upload of workouts that finish after connecting. Strava sync is free, so unlike the cloud backup nothing
 * here depends on JoyoRogo Pro; it only needs the JoyoRogo sign-in the Worker identifies the user with.
 */
export function StravaProvider({ children }: { children: ReactNode }) {
  const db = useSQLiteContext();
  const { dataVersion } = useWatch();
  const session = authClient.useSession();
  const signedIn = session.data?.user != null;

  const [settings, setSettings] = useState<StravaSettings>(EMPTY);
  const [serverReady, setServerReady] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => setSettings(await getStravaSettings(db)), [db]);

  const refresh = useCallback(async () => {
    if (CLOUD_CONFIGURED && signedIn) {
      const status = await syncStravaStatus(db);
      if (status) setServerReady(status.configured);
    }
    await reload();
  }, [db, signedIn, reload]);

  // At start and when the session appears: read the connection (the effect itself sets nothing synchronously).
  useEffect(() => {
    let live = true;
    (async () => {
      const status = CLOUD_CONFIGURED && signedIn ? await syncStravaStatus(db) : null;
      const stored = await getStravaSettings(db);
      if (!live) return;
      if (status) setServerReady(status.configured);
      setSettings(stored);
    })().catch(() => {});
    return () => {
      live = false;
    };
  }, [db, signedIn]);

  // Come back to the foreground: Strava may have been connected in the browser, or revoked on strava.com.
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') void refresh().catch(() => {});
    });
    return () => subscription.remove();
  }, [refresh]);

  // New workouts arrive with each sync; send the ones that finished after connecting.
  useEffect(() => {
    if (!signedIn || !CLOUD_CONFIGURED || settings.connectedAt === null) return;
    const timer = setTimeout(() => {
      void autoUploadNewWorkouts(db)
        .then(() => reload())
        .catch(() => {});
    }, AUTO_UPLOAD_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [db, signedIn, settings.connectedAt, dataVersion, reload]);

  const connect = useCallback(async () => {
    setError(null);
    setBusy(true);
    try {
      const url = await fetchStravaAuthorizeUrl();
      const result = await WebBrowser.openAuthSessionAsync(url, RETURN_URL);
      if (result.type === 'success') {
        const { reason } = Linking.parse(result.url).queryParams ?? {};
        if (typeof reason === 'string') setError(FAILURES[reason] ?? 'Strava could not be connected. Try again.');
      }
      await refresh();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }, [refresh]);

  const disconnect = useCallback(async () => {
    setError(null);
    setBusy(true);
    try {
      await disconnectStrava(db);
      await reload();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }, [db, reload]);

  const setAddLink = useCallback(
    async (on: boolean) => {
      await setStravaAddLink(db, on);
      await reload();
    },
    [db, reload],
  );

  const value = useMemo<StravaContextValue>(
    () => ({ configured: CLOUD_CONFIGURED, signedIn, settings, serverReady, busy, error, connect, disconnect, setAddLink, refresh }),
    [signedIn, settings, serverReady, busy, error, connect, disconnect, setAddLink, refresh],
  );

  return <StravaContext.Provider value={value}>{children}</StravaContext.Provider>;
}
