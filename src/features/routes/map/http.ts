/**
 * One JSON GET with a timeout and an abort signal, shared by the routing, elevation and place-search clients. Pure: `fetch`
 * is injected, so everything here runs under `bun test`.
 */

/** The part of `fetch` the clients use; the global `fetch` satisfies it. */
export type FetchLike = (
  url: string,
  init: { headers: Record<string, string>; signal: AbortSignal },
) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

export type RequestFailure =
  /** The caller aborted (a leg that was undone, a screen that closed). */
  | 'aborted'
  | 'timeout'
  | 'network'
  /** A non-2xx answer; `status` has the code. */
  | 'http'
  /** The answer is not JSON, or JSON of a shape the client does not know. */
  | 'parse'
  /** The service answered but says no result (OSRM `code` other than `Ok`). */
  | 'code';

export class RequestError extends Error {
  readonly kind: RequestFailure;
  readonly status?: number;

  constructor(kind: RequestFailure, message: string, status?: number) {
    super(message);
    this.name = 'RequestError';
    this.kind = kind;
    this.status = status;
  }
}

export function isAborted(error: unknown): boolean {
  return error instanceof RequestError && error.kind === 'aborted';
}

export interface GetJsonOptions {
  headers: Record<string, string>;
  timeoutMs: number;
  signal?: AbortSignal;
}

/** Rejects when `signal` aborts, for a `fetch` that does not watch the signal itself. */
function whenAborted(signal: AbortSignal): { promise: Promise<never>; dispose: () => void } {
  const { promise, reject } = Promise.withResolvers<never>();
  // Nobody awaits it after dispose: keep an abort that lands later from becoming an unhandled rejection.
  promise.catch(() => {});
  const onAbort = () => reject(new RequestError('aborted', 'aborted'));
  if (signal.aborted) onAbort();
  else signal.addEventListener('abort', onAbort);
  return { promise, dispose: () => signal.removeEventListener('abort', onAbort) };
}

export async function getJson(fetchFn: FetchLike, url: string, options: GetJsonOptions): Promise<unknown> {
  const { headers, timeoutMs, signal } = options;
  if (signal?.aborted) throw new RequestError('aborted', 'aborted');

  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  const onCallerAbort = () => controller.abort();
  signal?.addEventListener('abort', onCallerAbort);
  const stop = whenAborted(controller.signal);

  try {
    const response = await Promise.race([fetchFn(url, { headers, signal: controller.signal }), stop.promise]);
    if (!response.ok) throw new RequestError('http', `HTTP ${response.status}`, response.status);
    try {
      return await Promise.race([response.json(), stop.promise]);
    } catch (e) {
      if (e instanceof RequestError) throw e;
      if (controller.signal.aborted) throw e;
      throw new RequestError('parse', 'The answer is not JSON.');
    }
  } catch (e) {
    if (timedOut) throw new RequestError('timeout', `No answer in ${Math.round(timeoutMs / 1000)} s.`);
    if (signal?.aborted) throw new RequestError('aborted', 'aborted');
    if (e instanceof RequestError) throw e;
    throw new RequestError('network', e instanceof Error ? e.message : 'The request failed.');
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onCallerAbort);
    stop.dispose();
  }
}
