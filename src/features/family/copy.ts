import type { FamilyScopes } from '@/cloud/family';
import { t } from '@/i18n';

/** Text the family screens share. Wording of the disclaimer and the consent follows docs/family-monitoring.md section 7. */

/** Shown first on the consent screen, then as a card on every family screen. */
export const disclaimerText = () => t('family:disclaimer');

export const consentTitle = (name: string) => t('family:consent.title', { name });

export const consentIntro = (name: string) => t('family:consent.intro', { name });

export const neverSharedText = () => t('family:consent.neverShared');

export const consentAlerts = (name: string) => t('family:consent.alerts', { name });

export const consentRevoke = (name: string) => t('family:consent.revoke', { name });

export interface ScopeRow {
  key: keyof FamilyScopes;
  label: string;
  hint?: string;
}

/**
 * What a monitored person can share, worded in the current language (call it while rendering). `sync` is required:
 * without the watch's last sync time the watcher could not tell a quiet day from a silent phone.
 */
export function scopeRows(): ScopeRow[] {
  return [
    { key: 'sync', label: t('family:scope.sync.label'), hint: t('family:scope.sync.hint') },
    { key: 'steps', label: t('family:scope.steps.label') },
    { key: 'sleep', label: t('family:scope.sleep.label') },
    { key: 'restingHr', label: t('family:scope.restingHr.label') },
    { key: 'spo2', label: t('family:scope.spo2.label'), hint: t('family:scope.spo2.hint') },
  ];
}

/** Nothing shared except the required sync time and battery: where every consent starts. */
export const CONSENT_DEFAULT_SCOPES: FamilyScopes = { sync: true, steps: false, sleep: false, restingHr: false, spo2: false };

export const platformNote = (os: 'android' | 'ios') => t(os === 'ios' ? 'family:platform.ios' : 'family:platform.android');

/** The message that goes with an invite. `role` is the inviter's own side. The link opens the app (or the store); the code works by hand. */
export function inviteShareMessage(role: 'watcher' | 'monitored', url: string, code: string): string {
  const ask = t(role === 'watcher' ? 'family:invite.shareWatcherAsk' : 'family:invite.shareMonitoredAsk');
  return t('family:invite.shareBody', { ask, url, code });
}

/** Before the system prompt on the watcher's phone. */
export const prePermissionBody = (label: string) => t('family:push.preWatcher', { label, late: t('family:push.late') });

/** Before the system prompt on the monitored person's phone, where "Tanya kabar" arrives. */
export const prePermissionMonitoredBody = (name: string) => t('family:push.preMonitored', { name, late: t('family:push.late') });

/** What a push's `data` can say: `family_alert` and `family_poke`, both with the link they are about. */
const LINK_ID = /^[A-Za-z0-9_-]+$/;

/** Where tapping a family notification goes; null for any other notification or a payload that does not name a link. */
export function notificationHref(data: unknown): `/family/${string}` | null {
  if (typeof data !== 'object' || data === null) return null;
  const { type, linkId } = data as { type?: unknown; linkId?: unknown };
  if (type !== 'family_alert' && type !== 'family_poke') return null;
  return typeof linkId === 'string' && LINK_ID.test(linkId) ? `/family/${linkId}` : null;
}

const ERROR_CODES = {
  invite_invalid: 'inviteInvalid',
  own_invite: 'ownInvite',
  limit_reached: 'limitReached',
  poke_throttled: 'pokeThrottled',
  pro_required: 'proRequired',
  already_linked: 'alreadyLinked',
  not_active: 'notActive',
  not_pending: 'notPending',
} as const;

/** The person-facing sentence for an error answer of the Worker: its HTTP status (null = no answer) and `{error: code}`. */
export function familyErrorText(status: number | null, code: string | null): string {
  if (code !== null && Object.hasOwn(ERROR_CODES, code)) return t(`family:errors.${ERROR_CODES[code as keyof typeof ERROR_CODES]}`);
  if (status === null) return t('family:errors.offline');
  if (status === 401) return t('family:errors.session');
  if (status === 403) return t('family:errors.forbidden');
  if (status === 404) return t('family:errors.notFound');
  if (status >= 500) return t('family:errors.server');
  return t('family:errors.generic');
}
