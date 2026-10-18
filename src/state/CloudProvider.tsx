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
import { APP_BUILD } from '@/cloud/build';
import { CLOUD_CONFIGURED } from '@/cloud/config';
import { loadOverview, type CloudOverview } from '@/cloud/overview';
import { onUnmeteredNetwork, readSyncSettings, writeAutoSync, writeWifiOnly, type SyncSettings } from '@/cloud/syncSettings';
import { runUpload } from '@/cloud/uploader';
import {
  bindAccount,
  fetchCloudWorkoutStatus,
  pullWorkouts,
  pushWorkouts,
  wipeCloudData,
  type CloudWorkoutStatus,
  type UploadProgress,
} from '@/cloud/workoutSync';
import { releaseFamilyDevice } from '@/features/family/device';
import { cloudLog } from '@/cloud/log';
import { syncGear } from '@/features/gear/sync';
import { syncCoach } from '@/features/coach/sync';
import { forgetCloudWorkouts, resetCloudCursors, setCloudState } from '@/db/cloud';
import { errorMessage } from '@/format';
import { t } from '@/i18n';
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
  /** A sync (pull, upload) is running. */
  uploading: boolean;
  /** Workouts uploaded so far in the running sync, out of the ones it started with; null between syncs. */
  progress: UploadProgress | null;
  /**
   * The server refused uploads because the account is not JoyoRogo Pro. Nothing is wrong: automatic uploads stop,
   * and coming back to the app or "Sync now" asks again, so a fresh purchase is picked up.
   */
  locked: boolean;
  /** Last sign-in or sync failure. */
  error: string | null;
  /** Unix seconds of the last finished sync. */
  lastSyncAt: number | null;
  /** Step and sleep rows stored on the phone that the cloud does not have yet. */
  pendingRows: number | null;
  /** Workouts that the cloud does not have yet (or has with older numbers), and the size they will take. */
  pendingWorkouts: number | null;
  pendingBytes: number | null;
  /** Workouts the cloud refused as a document, and the last reason; retried after an app update. */
  refusedWorkouts: number;
  refusedError: string | null;
  /** The account's workouts in JoyoRogo; null until known (offline, or not asked yet). */
  cloudWorkouts: Pick<CloudWorkoutStatus, 'unlocked' | 'count' | 'bytes' | 'quotaBytes'> | null;
  /** Automatic runs wait for Wi-Fi or Ethernet. */
  wifiOnly: boolean;
  setWifiOnly: (value: boolean) => void;
  /** Runs start on their own after a local sync and when the app comes back. */
  autoSync: boolean;
  setAutoSync: (value: boolean) => void;
  /** "Delete cloud data" is running. */
  wiping: boolean;
  /**
   * Deletes the account's workouts, steps and sleep from the cloud, keeps this phone's data and the account, and turns
   * automatic sync off. Resolves false when it failed (`error` says why).
   */
  wipeCloud: () => Promise<boolean>;
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
  /** Runs a sync now, whatever the Wi-Fi only setting says (the caller has asked the person). */
  syncNow: () => Promise<void>;
}

const CloudContext = createContext<CloudContextValue | null>(null);

export function useCloud(): CloudContextValue {
  const value = useContext(CloudContext);
  if (!value) throw new Error('useCloud must be used inside <CloudProvider>');
  return value;
}

/**
 * JoyoRogo sign-in plus the sync of the local database with the cloud. A sync pulls the workouts this phone does not have
 * from JoyoRogo, uploads the phone's workouts (one document each, JoyoRogo Pro) and sends steps and sleep to the JoyoFit
 * cloud Worker. It runs after every local sync the app sees (`dataVersion`), when the app comes to the foreground, and
 * on "Sync now"; automatic runs honour the "Automatic sync" and "Wi-Fi only" settings. Rows the background service
 * stored while the app was closed go up on the next of those. Syncs never overlap: a request made during one is served by
 * one more run right after it. Uploads are a Pro benefit: once the server says the account is not Pro, local syncs
 * stop triggering runs (no retry loop); only returning to the foreground and "Sync now" check again.
 */
export function CloudProvider({ children }: { children: ReactNode }) {
  const db = useSQLiteContext();
  const { dataVersion } = useWatch();
  const session = authClient.useSession();
  const signedIn = session.data?.user != null;
  const user = session.data?.user;
  const userRef = useRef(user);
  userRef.current = user;

  const [overview, setOverview] = useState<CloudOverview | null>(null);
  const [cloudWorkouts, setCloudWorkouts] = useState<CloudWorkoutStatus | null>(null);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState<UploadProgress | null>(null);
  const [locked, setLocked] = useState(false);
  const lockedRef = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [appleAvailable, setAppleAvailable] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [wiping, setWiping] = useState(false);
  const [settings, setSettings] = useState<SyncSettings>(readSyncSettings);
  const settingsRef = useRef(settings);
  const running = useRef<Promise<void> | null>(null);
  const again = useRef(false);

  const refresh = useCallback(async () => {
    setOverview(await loadOverview(db, APP_BUILD));
  }, [db]);

  const refreshStatus = useCallback(async () => {
    try {
      setCloudWorkouts(await fetchCloudWorkoutStatus());
    } catch {
      // offline or not signed in: the last known figures stay
    }
  }, []);

  // Re-read after every local sync: new rows may be waiting.
  useEffect(() => {
    let live = true;
    loadOverview(db, APP_BUILD).then(
      (value) => live && setOverview(value),
      () => {},
    );
    return () => {
      live = false;
    };
  }, [db, dataVersion]);

  useEffect(() => {
    if (signedIn) void refreshStatus();
    else setCloudWorkouts(null);
  }, [signedIn, refreshStatus]);

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
      setError(t('common:errors.cloudUrlMissing'));
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
          const account = userRef.current;
          if (!account) return;
          await bindAccount(db, account.id, account.email);
          await pullWorkouts(db);
          // Gear is small and a free account only reads it; a failure here must not fail the workouts' sync.
          await syncGear(db).catch((e) => cloudLog(`gear sync failed: ${errorMessage(e)}`, 'error'));
          // The Coach plan: read by every signed-in account, written by Pro; same rule, same isolation.
          await syncCoach(db).catch((e) => cloudLog(`coach sync failed: ${errorMessage(e)}`, 'error'));
          const pushed = await pushWorkouts(db, setProgress);
          await runUpload(db);
          if (pushed.quota) setError(pushed.quota);
        } while (again.current);
        markLocked(false);
      } catch (e) {
        if (e instanceof CloudLockedError) {
          markLocked(true);
          await setCloudState(db, { last_error: null }).catch(() => {});
        } else setError(errorMessage(e));
      } finally {
        setUploading(false);
        setProgress(null);
        running.current = null;
        await refresh().catch(() => {});
        void refreshStatus();
      }
    })();
    running.current = run;
    return run;
  }, [db, refresh, refreshStatus, markLocked]);

  /** A run nobody asked for: only when automatic sync is on, and on Wi-Fi or Ethernet when "Wi-Fi only" is. */
  const autoSyncNow = useCallback(async () => {
    const { autoSync, wifiOnly } = settingsRef.current;
    if (!autoSync || (wifiOnly && !(await onUnmeteredNetwork()))) return;
    await syncNow();
  }, [syncNow]);

  // Sync after each local sync, and once at start, as soon as there is a session.
  useEffect(() => {
    if (!signedIn || !CLOUD_CONFIGURED || lockedRef.current) return;
    const timer = setTimeout(() => void autoSyncNow(), UPLOAD_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [signedIn, dataVersion, autoSyncNow]);

  // Rows from the background service arrive while the app is closed; pick them up on return.
  useEffect(() => {
    if (!signedIn || !CLOUD_CONFIGURED) return;
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') void autoSyncNow();
    });
    return () => subscription.remove();
  }, [signedIn, autoSyncNow]);

  const changeSettings = useCallback((next: SyncSettings) => {
    settingsRef.current = next;
    setSettings(next);
  }, []);

  const setWifiOnly = useCallback(
    (wifiOnly: boolean) => {
      writeWifiOnly(wifiOnly);
      changeSettings({ ...settingsRef.current, wifiOnly });
    },
    [changeSettings],
  );

  const setAutoSync = useCallback(
    (autoSync: boolean) => {
      writeAutoSync(autoSync);
      changeSettings({ ...settingsRef.current, autoSync });
      if (autoSync && signedIn) void autoSyncNow();
    },
    [changeSettings, signedIn, autoSyncNow],
  );

  const wipeCloud = useCallback(async () => {
    setError(null);
    setWiping(true);
    // Off first, so nothing is uploaded again while the cloud is being emptied; it goes back on only if the wipe fails.
    const before = settingsRef.current.autoSync;
    writeAutoSync(false);
    changeSettings({ ...settingsRef.current, autoSync: false });
    try {
      if (running.current) await running.current;
      await wipeCloudData(db);
      return true;
    } catch (e) {
      setError(errorMessage(e));
      writeAutoSync(before);
      changeSettings({ ...settingsRef.current, autoSync: before });
      return false;
    } finally {
      setWiping(false);
      await refresh().catch(() => {});
      void refreshStatus();
    }
  }, [db, changeSettings, refresh, refreshStatus]);

  const signIn = useCallback(async () => {
    setError(null);
    try {
      const result = await authClient.signIn.social({ provider: 'google', callbackURL: Linking.createURL('/') });
      if (result.error) setError(result.error.message ?? t('common:errors.signInFailed'));
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
      await forgetCloudWorkouts(db);
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
      // Family monitoring needs the session to revoke this phone's tokens, so it goes first; it never blocks signing out.
      await releaseFamilyDevice().catch(() => {});
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
      email: session.data?.user.email ?? overview?.state.email ?? null,
      uploading,
      progress,
      locked,
      error: error ?? overview?.state.lastError ?? null,
      lastSyncAt: overview?.state.lastSyncAt ?? null,
      pendingRows: overview?.pendingRows ?? null,
      pendingWorkouts: overview?.pendingWorkouts ?? null,
      pendingBytes: overview?.pendingBytes ?? null,
      refusedWorkouts: overview?.refusedWorkouts ?? 0,
      refusedError: overview?.refusedError ?? null,
      cloudWorkouts,
      wifiOnly: settings.wifiOnly,
      setWifiOnly,
      autoSync: settings.autoSync,
      setAutoSync,
      wiping,
      wipeCloud,
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
      overview,
      uploading,
      progress,
      locked,
      error,
      cloudWorkouts,
      settings,
      setWifiOnly,
      setAutoSync,
      wiping,
      wipeCloud,
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
