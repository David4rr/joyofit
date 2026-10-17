import { useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';

import { family, type FamilyLink } from '@/cloud/family';
import { CLOUD_URL } from '@/cloud/config';
import {
  clearLocalFamily,
  configureNative,
  ensureDeviceToken,
  familyDeviceId,
  forgetDeviceToken,
  hasDeviceToken,
  uploadNative,
} from '@/features/family/device';
import { nextPauseEnd } from '@/features/family/format';
import { useWatch } from '@/state/WatchProvider';

/** After a watch sync, wait this long so a burst of events is one upload (same as the cloud backup). */
const UPLOAD_DEBOUNCE_MS = 2_000;
/** The longest delay `setTimeout` takes. */
const MAX_TIMER_MS = 2 ** 31 - 1;

interface Options {
  /** The JoyoRogo session is read and there is none: forget everything this phone kept for family monitoring. */
  signedOut: boolean;
  /** The links where this account is watched (null until they are read). Only a consented link ever turns uploading on. */
  watchedBy: readonly FamilyLink[] | null;
}

/**
 * The monitored side's upload, kept in step with what the person agreed to. While some link is consented (active or
 * paused) it asks the Worker what to share (`GET /config`), makes sure the phone has a device token, and gives the native
 * module its config; after every watch sync, when the app comes to the foreground and after each consent, pause or
 * scope change it asks the native side to upload now. Nothing is configured from a pending link, and with no consented
 * link the native config and the token are dropped. Android also uploads by itself after each background watch sync.
 */
export function useFamilyUploader({ signedOut, watchedBy }: Options): void {
  const { dataVersion } = useWatch();
  /** Bumped when the app returns or a timed pause ends: the config is read again. */
  const [wake, setWake] = useState(0);
  const [uploading, setUploading] = useState(false);
  /** A rejected token is replaced once per change of the links; a second rejection waits for the next change. */
  const remintedRef = useRef(false);

  const consented = watchedBy === null ? null : watchedBy.some((link) => link.status === 'active' || link.status === 'paused');
  /** What the effects depend on: the consents, their scopes and pauses. */
  const linksKey = JSON.stringify(watchedBy?.map((link) => [link.id, link.status, link.pausedUntil, link.scopes]) ?? null);

  useEffect(() => {
    if (signedOut) void clearLocalFamily();
  }, [signedOut]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') setWake((n) => n + 1);
    });
    return () => subscription.remove();
  }, []);

  // A timed pause ends by itself: read the config again then, so uploading resumes while the app is open.
  useEffect(() => {
    if (!watchedBy) return;
    const end = nextPauseEnd(watchedBy, Date.now());
    if (end === null) return;
    const timer = setTimeout(() => setWake((n) => n + 1), Math.min(MAX_TIMER_MS, end - Date.now() + 1_000));
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `linksKey` carries every `pausedUntil` of `watchedBy`
  }, [linksKey]);

  useEffect(() => {
    remintedRef.current = false;
  }, [linksKey]);

  useEffect(() => {
    if (consented === null) return;
    let cancelled = false;

    const retire = async () => {
      setUploading(false);
      if (await hasDeviceToken()) {
        await Promise.allSettled([family.deviceToken.revoke(await familyDeviceId()), forgetDeviceToken()]);
      }
      await configureNative(null);
    };

    const apply = async () => {
      const config = await family.config();
      if (cancelled) return;
      const enabled = config.enabled && config.links.some((link) => link.status === 'active');
      const token = await ensureDeviceToken();
      if (cancelled) return;
      await configureNative({ baseUrl: CLOUD_URL, token, scopes: config.scopes, enabled });
      setUploading(enabled);
      if (!enabled || cancelled) return;
      const result = await uploadNative();
      if (result?.outcome === 'rejected' && result.status === 401 && !remintedRef.current && !cancelled) {
        // The Worker no longer knows this token: mint another and try again.
        remintedRef.current = true;
        await forgetDeviceToken();
        setWake((n) => n + 1);
      }
    };

    (consented ? apply() : retire()).catch(() => {
      // Offline or the Worker is down: the next foreground, sync or change tries again.
    });
    return () => {
      cancelled = true;
    };
  }, [consented, linksKey, wake]);

  useEffect(() => {
    if (!uploading) return;
    const timer = setTimeout(() => void uploadNative().catch(() => {}), UPLOAD_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [uploading, dataVersion]);
}
