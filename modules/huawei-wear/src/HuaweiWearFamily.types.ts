/**
 * Family monitoring, phone side of the monitored person. Native code builds the small daily summary from the local
 * database and posts it to the JoyoFit cloud Worker (`PUT /v1/family/ingest`, docs/family-monitoring.md section 10), both from
 * JS (`familyUploadNow`) and on its own after every background watch sync, so the feed moves while JoyoFit is closed.
 */

/** What the monitored person agreed to share, per category. `sync` (watch seen time and battery) is required. */
export interface FamilyScopes {
  sync: boolean;
  steps: boolean;
  sleep: boolean;
  restingHr: boolean;
  spo2: boolean;
}

/** Stored natively (Android SharedPreferences, iOS UserDefaults) so a background run has it without JS. */
export interface FamilyConfig {
  /** Cloud Worker origin without a trailing slash, e.g. `https://api.fit.joyorogo.com`. */
  baseUrl: string;
  /** Revocable per-device bearer token minted by `POST /v1/family/device-token`. */
  token: string;
  /** Union of the scopes of every active, not paused link. A category not set here is never read or sent. */
  scopes: FamilyScopes;
  /** False while every link is paused or none is active: nothing is uploaded. */
  enabled: boolean;
}

export interface FamilyUploadResult {
  /** `sent` = the server accepted it; `skipped` = disabled, no config or nothing to send; `rejected` = the server said the token is revoked or no link is active (native clears its config); `failed` = network or server error (retried on the next sync). */
  outcome: 'sent' | 'skipped' | 'rejected' | 'failed';
  /** HTTP status when a request was made. */
  status: number | null;
  /** Unix ms of the attempt. */
  at: number;
}

export interface FamilyUploadStatus {
  configured: boolean;
  enabled: boolean;
  /** Result of the last attempt (foreground or background), or null when none yet. */
  last: FamilyUploadResult | null;
  /** The exact JSON body of the last successful upload, for "Lihat data yang terkirim"; null when none. */
  lastPayload: string | null;
}
