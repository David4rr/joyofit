import { CloudHttpError, CloudLockedError, NotSignedInError, withRetry } from '@/cloud/api';
import { authClient } from '@/cloud/auth';
import { JOYOROGO_URL } from '@/cloud/config';

/**
 * The binary side of JoyoRogo's cloud workouts (`apps/server/src/watch-workout.ts` in the joyorogo repo): a workout
 * document is gzip bytes, so it travels as the raw body instead of oRPC's JSON. Same session cookie and fetch
 * conventions as `rogoCall`; failures are `CloudHttpError`s (`code` is the server's `error`), a 402 from the Pro gate is
 * a `CloudLockedError`, and transient failures are retried like every other cloud call.
 */

/** A document is up to 6 MB over a mobile connection. */
const TIMEOUT_MS = 90_000;

export interface PutWorkoutResult {
  start: number;
  /** The server's version of the document; a changed document makes it one higher. */
  version: number;
  status: 'created' | 'updated' | 'unchanged';
  /** Gzip bytes the server stores. */
  bytes: number;
}

async function rogoRequest<T>(
  method: 'PUT' | 'GET',
  path: string,
  body: Uint8Array<ArrayBuffer> | undefined,
  read: (response: Response) => Promise<T>,
): Promise<T> {
  const cookie = await authClient.getCookie();
  if (!cookie) throw new NotSignedInError();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(`${JOYOROGO_URL}${path}`, {
      method,
      headers: { Cookie: cookie, ...(body ? { 'Content-Type': 'application/gzip' } : {}) },
      body,
      credentials: 'omit',
      signal: controller.signal,
    });
    if (!response.ok) {
      const json = (await response.json().catch(() => null)) as { error?: unknown; message?: unknown; paywall?: unknown } | null;
      if (response.status === 402 && json?.paywall === true) throw new CloudLockedError();
      const retryAfter = Number(response.headers.get('retry-after'));
      const error = new CloudHttpError(
        response.status,
        typeof json?.error === 'string' ? json.error : null,
        Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : null,
      );
      if (response.status !== 401 && typeof json?.message === 'string') error.message = json.message;
      throw error;
    }
    return await read(response);
  } finally {
    clearTimeout(timer);
  }
}

/** Uploads the gzip document of the workout that started at `start` (unix seconds). */
export function putWorkout(start: number, gzip: Uint8Array<ArrayBuffer>): Promise<PutWorkoutResult> {
  return withRetry(() => rogoRequest('PUT', `/api/watch-workouts/${start}`, gzip, (response) => response.json() as Promise<PutWorkoutResult>));
}

/** The stored gzip document, or null when the cloud has none (never uploaded, or deleted). Open to accounts without Pro. */
export async function getWorkoutBlob(start: number): Promise<Uint8Array<ArrayBuffer> | null> {
  try {
    return await withRetry(() =>
      rogoRequest('GET', `/api/watch-workouts/${start}/blob`, undefined, async (response) => new Uint8Array(await response.arrayBuffer())),
    );
  } catch (error) {
    if (error instanceof CloudHttpError && error.status === 404) return null;
    throw error;
  }
}
