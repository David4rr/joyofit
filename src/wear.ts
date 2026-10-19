import RawHuaweiWear from '../modules/huawei-wear';

export * from '../modules/huawei-wear';

const callErrorListeners = new Set<(error: unknown) => void>();

/**
 * Hears every error a call into the native module throws or rejects with, without handling it (the caller still gets it). The
 * database repair listens here: the native writer (Kotlin, its own SQLite) is the one that meets a damaged file first, and its
 * error reaches JS only as the rejection of whatever call was running.
 */
export function onNativeCallError(listener: (error: unknown) => void): () => void {
  callErrorListeners.add(listener);
  return () => {
    callErrorListeners.delete(listener);
  };
}

function announce(error: unknown): void {
  for (const listener of callErrorListeners) {
    try {
      listener(error);
    } catch {
      // A listener must never change what the caller of the native function sees.
    }
  }
}

const isThenable = (value: unknown): value is PromiseLike<unknown> =>
  typeof value === 'object' && value !== null && typeof Reflect.get(value, 'then') === 'function';

/** The event-emitter methods of the module: not calls into the database, and `useEventListener` wants them as they are. */
const EMITTER: Record<string, true> = { addListener: true, removeListener: true, removeAllListeners: true, emit: true, listenerCount: true };

type NativeFunction = (...args: unknown[]) => unknown;

const guarded = new WeakMap<NativeFunction, NativeFunction>();

function guard(target: object, fn: NativeFunction): NativeFunction {
  const known = guarded.get(fn);
  if (known) return known;
  const wrapper: NativeFunction = (...args) => {
    let result: unknown;
    try {
      result = fn.apply(target, args);
    } catch (e) {
      announce(e);
      throw e;
    }
    if (!isThenable(result)) return result;
    return result.then(undefined, (e: unknown) => {
      announce(e);
      throw e;
    });
  };
  guarded.set(fn, wrapper);
  return wrapper;
}

/** The native module, every call of it watched by `onNativeCallError`. */
export const HuaweiWear: typeof RawHuaweiWear = new Proxy(RawHuaweiWear, {
  get(target, property) {
    const value: unknown = Reflect.get(target, property, target);
    if (typeof value !== 'function' || (typeof property === 'string' && property in EMITTER)) return value;
    return guard(target, value as NativeFunction);
  },
});

/**
 * OTA bundles can run on older installed binaries whose native module lacks newer functions.
 * Call sites for functions added after a release MUST gate on this.
 */
export function hasNative(name: string): boolean {
  try {
    return typeof (HuaweiWear as unknown as Record<string, unknown>)[name] === 'function';
  } catch {
    return false;
  }
}
