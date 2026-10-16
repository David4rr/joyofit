import type { SQLiteDatabase } from 'expo-sqlite';

import { CloudHttpError, cloudRequest } from '@/cloud/api';
import {
  applyStravaConnection,
  getStravaSettings,
  getStravaUpload,
  listAutoUploadCandidates,
  saveStravaUpload,
  type StravaUploadRow,
} from '@/db/strava';
import { getWorkout, listWorkoutPoints } from '@/db/queries';
import { buildTcx, buildUploadForm, duplicateOf } from '@/features/strava/tcx';
import { errorMessage } from '@/format';
import { pushLog } from '@/state/logStore';

/**
 * Strava for JoyoFit. The Worker keeps the Strava tokens and the client secret (`server/src/strava.ts`); this file
 * asks it for the connection status, the authorize URL and a short-lived access token, then uploads straight from
 * the phone to Strava. Strava sync is free: nothing here checks JoyoRogo Pro. A workout is only ever sent to the
 * Strava account of the person whose phone it is; no Strava data is read back except the upload's own status.
 */

const STRAVA_API = 'https://www.strava.com/api/v3';
const REQUEST_TIMEOUT_MS = 60_000;
const POLL_INTERVAL_MS = 2_000;
const POLL_TIMEOUT_MS = 90_000;
/** Token refetched when it expires within this many seconds. */
const TOKEN_MARGIN_S = 120;

export interface StravaStatus {
  /** The Worker has the Strava client secret. */
  configured: boolean;
  connected: boolean;
  athleteId?: number;
  /** Unix seconds. */
  connectedAt?: number;
}

/** The Worker has no Strava connection for this account (never connected, revoked, or deauthorized on strava.com). */
export class StravaNotConnectedError extends Error {
  constructor() {
    super('Strava is not connected. Connect it again in Settings.');
  }
}

const log = (message: string, direction: 'info' | 'error' = 'info') =>
  pushLog({ ts: Date.now(), direction, serviceId: null, commandId: null, hex: null, message: `strava: ${message}` });

export const fetchStravaStatus = () => cloudRequest<StravaStatus>('GET', '/v1/strava');

/** The Strava OAuth page to open in a browser; its redirect lands on the Worker, which sends the user back to the app. */
export async function fetchStravaAuthorizeUrl(): Promise<string> {
  return (await cloudRequest<{ url: string }>('GET', '/v1/strava/authorize')).url;
}

/** Revokes the grant at Strava (through the Worker) and forgets everything local. */
export async function disconnectStrava(db: SQLiteDatabase): Promise<void> {
  await cloudRequest('POST', '/v1/strava/disconnect');
  token = null;
  await applyStravaConnection(db, { connected: false });
}

/**
 * Reads the Worker's status into the local database. Returns the status, or null when the Worker cannot be reached
 * (the local state stays as it was, so being offline never disconnects anything).
 */
export async function syncStravaStatus(db: SQLiteDatabase): Promise<StravaStatus | null> {
  try {
    const status = await fetchStravaStatus();
    await applyStravaConnection(db, status);
    if (!status.connected) token = null;
    return status;
  } catch (error) {
    log(`status check failed: ${errorMessage(error)}`, 'error');
    return null;
  }
}

let token: { value: string; expiresAt: number } | null = null;

async function accessToken(): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  if (token && token.expiresAt - now > TOKEN_MARGIN_S) return token.value;
  try {
    const fresh = await cloudRequest<{ accessToken: string; expiresAt: number }>('POST', '/v1/strava/token');
    token = { value: fresh.accessToken, expiresAt: fresh.expiresAt };
    return fresh.accessToken;
  } catch (error) {
    if (error instanceof CloudHttpError && error.status === 409) throw new StravaNotConnectedError();
    throw error;
  }
}

/** A failure that is Strava's verdict on this file, not a hiccup: retrying the same file will not help. */
class StravaRefusedError extends Error {}

interface UploadStatus {
  id: number;
  activity_id: number | null;
  error: string | null;
  status: string;
}

async function stravaFetch(
  path: string,
  init: { method: 'GET' | 'POST'; headers?: Record<string, string>; body?: string },
): Promise<UploadStatus> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(`${STRAVA_API}${path}`, {
      ...init,
      headers: { ...init.headers, Authorization: `Bearer ${await accessToken()}`, Accept: 'application/json' },
      signal: controller.signal,
    });
    if (response.ok) return (await response.json()) as UploadStatus;
    const text = await response.text().catch(() => '');
    // Strava answers a duplicate external_id with 400 and the existing upload's error text (parsed by the caller).
    if (response.status === 400 || response.status === 413 || response.status === 422) {
      throw new StravaRefusedError(duplicateOf(text) !== null ? text : `Strava refused the file (${response.status}).`);
    }
    if (response.status === 401 || response.status === 403) {
      token = null;
      throw new StravaNotConnectedError();
    }
    throw new Error(response.status === 429 ? 'Strava rate limit reached; will retry later.' : `Strava answered ${response.status}.`);
  } finally {
    clearTimeout(timer);
  }
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Polls `GET /uploads/{id}` until Strava has made the activity, refused the file, or POLL_TIMEOUT_MS pass. */
async function pollUpload(uploadId: number): Promise<UploadStatus> {
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  let status: UploadStatus = { id: uploadId, activity_id: null, error: null, status: '' };
  while (Date.now() < deadline) {
    await sleep(POLL_INTERVAL_MS);
    status = await stravaFetch(`/uploads/${uploadId}`, { method: 'GET' });
    if (status.activity_id || status.error) break;
  }
  return status;
}

const inFlight = new Map<number, Promise<StravaUploadRow>>();

/**
 * Sends one workout to Strava and records the outcome in `strava_upload`. A workout Strava already has (done, or a
 * duplicate external_id) is not sent twice; one still processing is polled again instead of uploaded again. Calls for
 * the same workout share one run. Never throws for Strava's own refusal: that is the returned row (`rejected`).
 * Connection problems (`StravaNotConnectedError`) and a missing workout throw.
 */
export function sendWorkoutToStrava(db: SQLiteDatabase, workoutId: number): Promise<StravaUploadRow> {
  const running = inFlight.get(workoutId);
  if (running) return running;
  const run = doSend(db, workoutId).finally(() => inFlight.delete(workoutId));
  inFlight.set(workoutId, run);
  return run;
}

async function doSend(db: SQLiteDatabase, workoutId: number): Promise<StravaUploadRow> {
  const found = await getWorkout(db, workoutId);
  if (!found) throw new Error('This workout is no longer stored.');
  const { workout } = found;
  const previous = await getStravaUpload(db, workout.start);
  if (previous?.status === 'done') return previous;
  const attempts = (previous?.attempts ?? 0) + 1;
  const base = { workoutStart: workout.start, attempts };

  try {
    let uploadId = previous?.status === 'processing' ? previous.uploadId : null;
    let status: UploadStatus;
    if (uploadId === null) {
      const points = await listWorkoutPoints(db, workoutId);
      const { addLink } = await getStravaSettings(db);
      const form = buildUploadForm(workout, buildTcx(workout, points).xml, { addLink });
      try {
        status = await stravaFetch('/uploads', { method: 'POST', headers: { 'Content-Type': form.contentType }, body: form.body });
      } catch (error) {
        const existing = error instanceof StravaRefusedError ? duplicateOf(error.message) : null;
        if (existing === null) throw error;
        log(`workout ${workout.start} is already on Strava (activity ${existing})`);
        return await saveStravaUpload(db, { ...base, status: 'done', uploadId: null, activityId: existing, error: null });
      }
      uploadId = status.id;
      await saveStravaUpload(db, { ...base, status: 'processing', uploadId, activityId: null, error: null });
    } else {
      status = { id: uploadId, activity_id: null, error: null, status: '' };
    }

    if (!status.activity_id && !status.error) status = await pollUpload(uploadId);
    if (status.activity_id) {
      log(`workout ${workout.start} is on Strava as activity ${status.activity_id}`);
      return await saveStravaUpload(db, { ...base, status: 'done', uploadId, activityId: status.activity_id, error: null });
    }
    if (status.error) {
      const existing = duplicateOf(status.error);
      if (existing !== null) return await saveStravaUpload(db, { ...base, status: 'done', uploadId, activityId: existing, error: null });
      log(`Strava refused workout ${workout.start}: ${status.error}`, 'error');
      return await saveStravaUpload(db, { ...base, status: 'rejected', uploadId, activityId: null, error: status.error });
    }
    // Still processing after the polling window: the next run polls the same upload again.
    return await saveStravaUpload(db, { ...base, status: 'processing', uploadId, activityId: null, error: null });
  } catch (error) {
    if (error instanceof StravaNotConnectedError) throw error;
    const message = errorMessage(error);
    log(`upload of workout ${workout.start} failed: ${message}`, 'error');
    const refused = error instanceof StravaRefusedError;
    return saveStravaUpload(db, { ...base, status: refused ? 'rejected' : 'failed', uploadId: null, activityId: null, error: message });
  }
}

let autoRunning: Promise<number> | null = null;

/**
 * Sends the workouts that finished since the account connected (and were not imported), oldest first. Returns how many
 * reached a final state. Runs nothing when not connected; overlapping calls share one run. Stops at the first
 * connection-level error (the next sync tries again).
 */
export function autoUploadNewWorkouts(db: SQLiteDatabase): Promise<number> {
  autoRunning ??= (async () => {
    const { connectedAt } = await getStravaSettings(db);
    if (connectedAt === null) return 0;
    let settled = 0;
    for (const candidate of await listAutoUploadCandidates(db, connectedAt)) {
      try {
        const row = await sendWorkoutToStrava(db, candidate.id);
        if (row.status === 'done' || row.status === 'rejected') settled += 1;
      } catch (error) {
        log(`automatic upload stopped: ${errorMessage(error)}`, 'error');
        if (error instanceof StravaNotConnectedError) await syncStravaStatus(db);
        break;
      }
    }
    return settled;
  })().finally(() => {
    autoRunning = null;
  });
  return autoRunning;
}

export function stravaActivityUrl(activityId: number): string {
  return `https://www.strava.com/activities/${activityId}`;
}
