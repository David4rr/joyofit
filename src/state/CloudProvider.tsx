import * as Linking from 'expo-linking';
import { useSQLiteContext } from 'expo-sqlite';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { AppState } from 'react-native';

import { appleSignInAvailable, deleteJoyoRogoAccount, signInWithApple } from '@/cloud/account';
import { CloudLockedError } from '@/cloud/api';
import { authClient } from '@/cloud/auth';
import { CLOUD_CONFIGURED } from '@/cloud/config';
import { runUpload } from '@/cloud/uploader';
import { countPending, getCloudState, resetCloudCursors, setCloudState, type CloudState } from '@/db/cloud';
import { errorMessage } from '@/format';
import { useWatch } from '@/state/WatchProvider';

/** Wait this long after a local sync (or app start) so bursts of events become one upload. */
const UPLOAD_DEBOUNCE_MS = 2_000;

export interface CloudContextValue {
  /** The cloud server URL is set in this build. */
  configured: boolean;
  signedIn: boolean;
  /** The session is still being read from secure storage. */
  sessionPending: boolean;
  /** JoyoRogo account email, from the session or the last upload. */
  email: string | null;
  uploading: boolean;
  /**
   * The server refused uploads because the account is not JoyoRogo Founder. Nothing is wrong: automatic uploads stop,
   * and coming back to the app or "Sync now" asks again, so a fresh purchase is picked up.
   */
  locked: boolean;
  /** Last sign-in or upload failure. */
  error: string | null;
  /** Unix seconds of the last finished upload. */
  lastSyncAt: number | null;
  /** Rows stored on the phone that the cloud does not have yet. */
  pending: number | null;
  /** Sign in with Apple can run on this phone (iOS only). */
  appleAvailable: boolean;
  /** Sign in with Google. */
  signIn: () => Promise<void>;
  signInApple: () => Promise<void>;
  /** The JoyoRogo account is being deleted. */
  deleting: boolean;
  /**
   * Deletes the shared JoyoRogo account and its cloud data, then signs out here. Resolves false when nothing was
   * deleted (the Apple sheet was closed, or it failed: `error` says why).
   */
  deleteAccount: () => Promise<boolean>;
  signOut: () => Promise<void>;
  syncNow: () => Promise<void>;
}

const CloudContext = createContext<CloudContextValue | null>(null);

export function useCloud(): CloudContextValue {
  const value = useContext(CloudContext);
  if (!value) throw new Error('useCloud must be used inside <CloudProvider>');
  return value;
}

/**
 * JoyoRogo sign-in plus the upload of the local database to the JoyoFit cloud Worker. An upload runs
 * after every local sync the app sees (`dataVersion`), when the app comes to the foreground, and on
 * "Sync now". Rows the background service stored while the app was closed go up on the next of those.
 * Uploads never overlap: a request made during one is served by one more run right after it. Backup is a JoyoRogo
 * Founder benefit: once the server says the account is not Founder, local syncs stop triggering uploads (no retry
 * loop); only returning to the foreground and "Sync now" check again.
 */
export function CloudProvider({ children }: { children: ReactNode }) {
  const db = useSQLiteContext();
  const { dataVersion } = useWatch();
  const session = authClient.useSession();
  const signedIn = session.data?.user != null;

  const [stored, setStored] = useState<CloudState | null>(null);
  const [pending, setPending] = useState<number | null>(null);
  const [uploading, setUploading] = useState(false);
  const [locked, setLocked] = useState(false);
  const lockedRef = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [appleAvailable, setAppleAvailable] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const running = useRef<Promise<void> | null>(null);
  const again = useRef(false);

  const load = useCallback(
    () => Promise.all([getCloudState(db), countPending(db)]),
    [db],
  );

  const refresh = useCallback(async () => {
    const [state, count] = await load();
    setStored(state);
    setPending(count);
  }, [load]);

  // Re-read after every local sync: new rows may be waiting.
  useEffect(() => {
    let live = true;
    load().then(
      ([state, count]) => {
        if (!live) return;
        setStored(state);
        setPending(count);
      },
      () => {},
    );
    return () => {
      live = false;
    };
  }, [load, dataVersion]);

  const markLocked = useCallback((value: boolean) => {
    lockedRef.current = value;
    setLocked(value);
  }, []);

  // Signing out clears the lock; the next account is asked afresh.
  useEffect(() => {
    if (!signedIn) markLocked(false);
  }, [signedIn, markLocked]);

  const syncNow = useCallback((): Promise<void> => {
    if (!CLOUD_CONFIGURED) {
      setError('The cloud server URL is not set in this build.');
      return Promise.resolve();
    }
    if (running.current) {
      again.current = true;
      return running.current;
    }
    const run = (async () => {
      setUploading(true);
      setError(null);
      try {
        do {
          again.current = false;
          await runUpload(db);
        } while (again.current);
        markLocked(false);
      } catch (e) {
        if (e instanceof CloudLockedError) markLocked(true);
        else setError(errorMessage(e));
      } finally {
        setUploading(false);
        running.current = null;
        await refresh().catch(() => {});
      }
    })();
    running.current = run;
    return run;
  }, [db, refresh, markLocked]);

  // Upload after each local sync, and once at start, as soon as there is a session.
  useEffect(() => {
    if (!signedIn || !CLOUD_CONFIGURED || lockedRef.current) return;
    const timer = setTimeout(() => void syncNow(), UPLOAD_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [signedIn, dataVersion, syncNow]);

  // Rows from the background service arrive while the app is closed; pick them up on return.
  useEffect(() => {
    if (!signedIn || !CLOUD_CONFIGURED) return;
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') void syncNow();
    });
    return () => subscription.remove();
  }, [signedIn, syncNow]);

  const signIn = useCallback(async () => {
    setError(null);
    try {
      const result = await authClient.signIn.social({ provider: 'google', callbackURL: Linking.createURL('/') });
      if (result.error) setError(result.error.message ?? 'Sign-in failed.');
    } catch (e) {
      setError(errorMessage(e));
    }
  }, []);

  useEffect(() => {
    let live = true;
    void appleSignInAvailable().then((ok) => live && setAppleAvailable(ok));
    return () => {
      live = false;
    };
  }, []);

  const signInApple = useCallback(async () => {
    setError(null);
    try {
      await signInWithApple();
    } catch (e) {
      setError(errorMessage(e));
    }
  }, []);

  const deleteAccount = useCallback(async () => {
    setError(null);
    setDeleting(true);
    try {
      if (!(await deleteJoyoRogoAccount())) return false;
    } catch (e) {
      setError(errorMessage(e));
      return false;
    } finally {
      setDeleting(false);
    }
    // The server session is gone with the account; this only clears the cookies stored on the phone.
    try {
      await authClient.signOut();
    } catch {
      // the account is already gone on the server
    }
    // Forget the deleted account here too: its id, email and sync time, and what had been uploaded to it.
    try {
      await resetCloudCursors(db);
      await setCloudState(db, { user_id: null, email: null, last_sync_at: null, last_error: null });
      await refresh();
    } catch {
      // bookkeeping only; the next sign-in resets it again
    }
    return true;
  }, [db, refresh]);

  const signOut = useCallback(async () => {
    setError(null);
    try {
      await authClient.signOut();
    } catch (e) {
      setError(errorMessage(e));
    }
  }, []);

  const value = useMemo<CloudContextValue>(
    () => ({
      configured: CLOUD_CONFIGURED,
      signedIn,
      sessionPending: session.isPending,
      email: session.data?.user.email ?? stored?.email ?? null,
      uploading,
      locked,
      error: error ?? stored?.lastError ?? null,
      lastSyncAt: stored?.lastSyncAt ?? null,
      pending,
      appleAvailable,
      signIn,
      signInApple,
      deleting,
      deleteAccount,
      signOut,
      syncNow,
    }),
    [
      signedIn,
      session.isPending,
      session.data,
      stored,
      uploading,
      locked,
      error,
      pending,
      appleAvailable,
      signIn,
      signInApple,
      deleting,
      deleteAccount,
      signOut,
      syncNow,
    ],
  );

  return <CloudContext.Provider value={value}>{children}</CloudContext.Provider>;
}
