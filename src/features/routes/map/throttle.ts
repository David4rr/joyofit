/**
 * A serial queue that starts tasks at least `minIntervalMs` apart: the way the public routing and place-search services want
 * to be called (one request per second, here with a 10% margin). Pure: the clock and the sleep are injected.
 */
import { RequestError } from '@/features/routes/map/http';

export type Throttle = <T>(task: () => Promise<T>, signal?: AbortSignal) => Promise<T>;

export interface ThrottleOptions {
  minIntervalMs: number;
  now?: () => number;
  /** Resolves after `ms`; rejects with an `aborted` RequestError when `signal` aborts first. */
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
}

function defaultSleep(ms: number, signal?: AbortSignal): Promise<void> {
  const { promise, resolve, reject } = Promise.withResolvers<void>();
  if (signal?.aborted) {
    reject(new RequestError('aborted', 'aborted'));
    return promise;
  }
  const onAbort = () => {
    clearTimeout(timer);
    reject(new RequestError('aborted', 'aborted'));
  };
  const timer = setTimeout(() => {
    signal?.removeEventListener('abort', onAbort);
    resolve();
  }, ms);
  signal?.addEventListener('abort', onAbort);
  return promise;
}

export function createThrottle({ minIntervalMs, now = Date.now, sleep = defaultSleep }: ThrottleOptions): Throttle {
  let tail: Promise<unknown> = Promise.resolve();
  let lastStart = Number.NEGATIVE_INFINITY;
  return <T>(task: () => Promise<T>, signal?: AbortSignal): Promise<T> => {
    const run = async (): Promise<T> => {
      // A task that was aborted while it waited for its turn does not use up the slot.
      if (signal?.aborted) throw new RequestError('aborted', 'aborted');
      const wait = lastStart + minIntervalMs - now();
      if (wait > 0) await sleep(wait, signal);
      if (signal?.aborted) throw new RequestError('aborted', 'aborted');
      lastStart = now();
      return task();
    };
    const result = tail.then(run);
    tail = result.catch(() => {});
    if (!signal) return result;

    // An abort rejects at once, not when the queue reaches the task.
    const { promise, resolve, reject } = Promise.withResolvers<T>();
    const onAbort = () => reject(new RequestError('aborted', 'aborted'));
    if (signal.aborted) onAbort();
    else signal.addEventListener('abort', onAbort);
    result.then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort));
    return promise;
  };
}
