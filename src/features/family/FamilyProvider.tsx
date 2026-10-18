import * as Notifications from 'expo-notifications';
import { useFocusEffect, useRootNavigationState, useRouter } from 'expo-router';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AppState } from 'react-native';

import { family, type FamilyLink, type FamilyLimits, type FamilyLinks, type FamilyWatchingItem } from '@/cloud/family';
import { notificationHref } from '@/features/family/copy';
import { describeFamilyError, isProRequired } from '@/features/family/errors';
import { ProUpsellDialog } from '@/features/family/ProUpsellDialog';
import { refreshPushToken } from '@/features/family/push';
import { useFamilyUploader } from '@/features/family/useFamilyUploader';
import { useLocale } from '@/i18n';
import { useCloud } from '@/state/CloudProvider';

interface FamilyContextValue {
  /** The cloud server is set in this build and a JoyoRogo account is signed in: the family routes can be called. */
  available: boolean;
  /** People this account watches. */
  watching: readonly FamilyWatchingItem[];
  /** People who watch this account. */
  watchedBy: readonly FamilyLink[];
  /** Null until the first answer. */
  limits: FamilyLimits | null;
  /** The links have not been read yet. */
  loading: boolean;
  /** Last failure to read the links, in words; cleared by the next success. */
  error: string | null;
  /** Reads the links again without blanking the screens. */
  refresh: () => Promise<void>;
  /** A failed call in words for the screen. A 402 opens the Pro offer instead and gives null. */
  fail: (error: unknown) => string | null;
  /** Opens the Pro offer. */
  showUpsell: () => void;
}

const NONE: readonly never[] = [];

const FamilyContext = createContext<FamilyContextValue | null>(null);

export function useFamily(): FamilyContextValue {
  const value = useContext(FamilyContext);
  if (!value) throw new Error('useFamily must be used inside <FamilyProvider>');
  return value;
}

/** `useFamily` for a screen: reads the links again each time the screen gains focus. */
export function useFamilyLinks(): FamilyContextValue {
  const value = useFamily();
  const { available, refresh } = value;
  useFocusEffect(
    useCallback(() => {
      if (available) void refresh();
    }, [available, refresh]),
  );
  return value;
}

/**
 * The family monitoring state of the signed-in account: who it watches and who watches it (`GET /v1/family/links`), read
 * on sign-in, on returning to the app and by every family screen on focus. It also runs the monitored side's upload
 * (`useFamilyUploader`), keeps the watcher's push token current, routes a tap on a family notification to its person, and
 * hosts the Pro offer that any family call can open.
 */
export function FamilyProvider({ children }: { children: ReactNode }) {
  const cloud = useCloud();
  const locale = useLocale();
  const router = useRouter();
  const navigationReady = useRootNavigationState()?.key != null;
  const available = cloud.configured && cloud.signedIn;
  const signedOut = cloud.configured && !cloud.sessionPending && !cloud.signedIn;

  const [links, setLinks] = useState<FamilyLinks | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [upsell, setUpsell] = useState(false);
  const generation = useRef(0);

  const refresh = useCallback(async () => {
    const mine = ++generation.current;
    try {
      const answer = await family.links.list();
      if (mine !== generation.current) return;
      setLinks(answer);
      setError(null);
    } catch (e) {
      if (mine === generation.current) setError(describeFamilyError(e));
    }
  }, []);

  useEffect(() => {
    // The links belong to a signed-in account: read on sign-in, dropped on sign-out.
    /* eslint-disable react-hooks/set-state-in-effect */
    if (available) {
      void refresh();
      return;
    }
    generation.current++;
    setLinks(null);
    setError(null);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [available, refresh]);

  useEffect(() => {
    if (!available) return;
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') void refresh();
    });
    return () => subscription.remove();
  }, [available, refresh]);

  useFamilyUploader({ signedOut, watchedBy: links?.watchedBy ?? null });

  // An Expo push token can change; the Worker only pushes to the one it has. Only for people with a link: on Android before 13
  // notifications are allowed from the start, which says nothing about wanting these.
  const hasLinks = links !== null && (links.watching.length > 0 || links.watchedBy.length > 0);
  // The locale is a dependency: the Android notification channel carries a translated name that is rewritten on a switch.
  useEffect(() => {
    if (hasLinks) void refreshPushToken();
  }, [hasLinks, locale]);

  const lastResponse = Notifications.useLastNotificationResponse();
  useEffect(() => {
    if (!navigationReady || !lastResponse || lastResponse.actionIdentifier !== Notifications.DEFAULT_ACTION_IDENTIFIER) return;
    const href = notificationHref(lastResponse.notification.request.content.data);
    if (href) router.push(href);
  }, [lastResponse, navigationReady, router]);

  const showUpsell = useCallback(() => setUpsell(true), []);

  const fail = useCallback(
    (e: unknown): string | null => {
      if (isProRequired(e)) {
        setUpsell(true);
        return null;
      }
      return describeFamilyError(e);
    },
    [],
  );

  const value = useMemo<FamilyContextValue>(
    () => ({
      available,
      watching: links?.watching ?? NONE,
      watchedBy: links?.watchedBy ?? NONE,
      limits: links?.limits ?? null,
      loading: available && links === null && error === null,
      error,
      refresh,
      fail,
      showUpsell,
    }),
    [available, links, error, refresh, fail, showUpsell],
  );

  return (
    <FamilyContext.Provider value={value}>
      {children}
      <ProUpsellDialog visible={upsell} onClose={() => setUpsell(false)} />
    </FamilyContext.Provider>
  );
}
