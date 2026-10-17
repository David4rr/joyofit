import { cloudRequest } from '@/cloud/api';
import type { FamilyScopes } from '@/wear';

/**
 * Client of the family monitoring routes of the Worker (`server/src/family/`, docs/family-monitoring.md section 10). The viewer
 * is always the signed-in JoyoRogo account; which side of a link it is on decides what each route allows. Times are Unix
 * milliseconds. A `date` is `YYYY-MM-DD` in the monitored person's own calendar. Errors surface as `CloudHttpError`
 * with the server's `{error: code}` as `code`.
 */

const BASE = '/v1/family';

/** Mirrors `FamilyScopes` of the native module so the same object goes to `familyConfigure`. */
export type { FamilyScopes };

export type FamilyChip = 'ok' | 'check' | 'nosync';
export type FamilyLinkStatus = 'pending' | 'active' | 'paused' | 'revoked';

export interface FamilyLink {
  id: string;
  /** `watching`: you watch this person. `watchedBy`: this person watches you. */
  role: 'watching' | 'watchedBy';
  /** What the watcher calls the monitored person ("Ibu"). */
  label: string;
  otherName: string;
  status: FamilyLinkStatus;
  scopes: FamilyScopes;
  /** Unix ms the pause ends; -1 = until the monitored person turns it on. */
  pausedUntil: number | null;
  acceptedAt: number | null;
  lastViewedAt: number | null;
  /** The watcher is over the free limit: this link is kept but not live. */
  frozen: boolean;
}

export interface FamilyToday {
  steps: number | null;
  restingHr: number | null;
  sleepMin: number | null;
}

export interface FamilyWatchingItem extends FamilyLink {
  dataAt: number | null;
  chip: FamilyChip;
  /** Masked by the scopes; null when nothing has arrived. */
  today: FamilyToday | null;
  /** Median resting HR of the last 14 days (needs 7 days of data); null before that or without the resting HR scope. */
  baselineHr: number | null;
}

export interface FamilyLimits {
  pro: boolean;
  maxWatching: number;
  maxWatchers: number;
  historyDays: number;
}

export interface FamilyLinks {
  watching: FamilyWatchingItem[];
  watchedBy: FamilyLink[];
  limits: FamilyLimits;
}

export type FamilyInviteRole = 'watcher' | 'monitored';

export interface FamilyInvite {
  code: string;
  url: string;
  expiresAt: number;
}

export interface FamilyInvitePreview {
  inviterName: string;
  inviterRole: FamilyInviteRole;
  label: string;
  expiresAt: number;
}

export interface FamilyRules {
  noSync: { on: boolean; hours: number };
  restingHr: { on: boolean };
  noSteps: { on: boolean; hour: number };
  sleep: { on: boolean };
  spo2: { on: boolean };
  push: boolean;
  email: boolean;
  /** `HH:MM` in the monitored person's time zone. */
  quietStart: string;
  quietEnd: string;
}

export interface FamilyDay {
  date: string;
  steps: number | null;
  restingHr: number | null;
  sleepMin: number | null;
  spo2Min: number | null;
}

export interface FamilyAlert {
  id: string;
  rule: string;
  at: number;
  level: 'push' | 'digest';
  body: string;
}

export interface FamilyState {
  phoneSeenAt: number | null;
  watchSyncAt: number | null;
  battery: number | null;
}

export interface FamilySummary {
  link: FamilyLink;
  state: FamilyState | null;
  chip: FamilyChip;
  dataAt: number | null;
  days: FamilyDay[];
  baseline: { restingHr: number | null; days: number };
  alerts: FamilyAlert[];
  rules: FamilyRules;
  snoozeUntil: number | null;
  /** Whether the viewer's account is Pro. */
  pro: boolean;
}

export interface FamilyConfigAnswer {
  scopes: FamilyScopes;
  enabled: boolean;
  links: { id: string; scopes: FamilyScopes; status: FamilyLinkStatus }[];
}

export type FamilyPushPlatform = 'ios' | 'android';

export const family = {
  invites: {
    /** `role` is the inviter's own side: `watcher` invites a parent, `monitored` invites a watcher. */
    create: (role: FamilyInviteRole, label: string) => cloudRequest<FamilyInvite>('POST', `${BASE}/invites`, { role, label }),
    preview: (code: string) => cloudRequest<FamilyInvitePreview>('GET', `${BASE}/invites/${encodeURIComponent(code)}`),
    /** The new link is `pending`: nothing uploads until the monitored person agrees. */
    accept: (code: string, label?: string) =>
      cloudRequest<{ link: FamilyLink }>('POST', `${BASE}/invites/accept`, label === undefined ? { code } : { code, label }),
  },
  links: {
    list: () => cloudRequest<FamilyLinks>('GET', `${BASE}/links`),
    /** Monitored side. `consent: true` with `scopes` moves a pending link to active. */
    update: (id: string, patch: { scopes?: FamilyScopes; pausedUntil?: number | null; consent?: true }) =>
      cloudRequest<{ link: FamilyLink }>('PATCH', `${BASE}/links/${id}`, patch),
    /** Watcher side. */
    rename: (id: string, label: string) => cloudRequest<{ link: FamilyLink }>('PATCH', `${BASE}/links/${id}`, { label }),
    /** Either side. Revokes the link; the monitored person's stored days go when no other active link remains. */
    remove: (id: string) => cloudRequest<{ deleted: true }>('DELETE', `${BASE}/links/${id}`),
    /** Watcher side. Reading it marks the link as viewed. */
    summary: (id: string, days: 7 | 30 | 90) => cloudRequest<FamilySummary>('GET', `${BASE}/links/${id}/summary?days=${days}`),
    getRules: (id: string) => cloudRequest<{ rules: FamilyRules; pro: boolean }>('GET', `${BASE}/links/${id}/rules`),
    /** Free accounts may only change `noSync.on` and `noSync.hours`: anything else is 402 `pro_required`. */
    putRules: (id: string, rules: FamilyRules) => cloudRequest<{ rules: FamilyRules; pro: boolean }>('PUT', `${BASE}/links/${id}/rules`, rules),
    snooze: (id: string, days: 1 | 3 | 7) => cloudRequest<{ snoozeUntil: number }>('POST', `${BASE}/links/${id}/snooze`, { days }),
    /** 429 `poke_throttled` within an hour of the last one (not retried); `sent` is false when the monitored phone has no push token to deliver to. */
    poke: (id: string) => cloudRequest<{ sent: boolean }>('POST', `${BASE}/links/${id}/poke`, undefined, { retry: false }),
  },
  /** Monitored side. */
  config: () => cloudRequest<FamilyConfigAnswer>('GET', `${BASE}/config`),
  deviceToken: {
    /** The token is shown once; the same `deviceId` replaces the one before. */
    create: (deviceId: string, label?: string) =>
      cloudRequest<{ token: string }>('POST', `${BASE}/device-token`, label === undefined ? { deviceId } : { deviceId, label }),
    /** Cleanup that must not hold up signing out: no retries. */
    revoke: (deviceId: string) => cloudRequest<unknown>('DELETE', `${BASE}/device-token`, { deviceId }, { retry: false }),
  },
  pushToken: {
    put: (token: string, platform: FamilyPushPlatform, deviceId: string) =>
      cloudRequest<unknown>('PUT', `${BASE}/push-token`, { token, platform, deviceId }),
    /** Cleanup that must not hold up signing out: no retries. */
    remove: (deviceId: string) => cloudRequest<unknown>('DELETE', `${BASE}/push-token`, { deviceId }, { retry: false }),
  },
  /** The exact body of the last upload, as the server stored it. */
  lastPayload: () => cloudRequest<{ payload: string | null; at: number | null }>('GET', `${BASE}/me/last`),
};
