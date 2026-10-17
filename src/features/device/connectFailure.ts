import { errorMessage } from '@/format';

/** What the Watch tab does with a rejected `HuaweiWear.connect`. */
export type ConnectFailure =
  /** The watch does not know this phone: ask the user before a bind replaces its current phone pairing. */
  | { kind: 'bind' }
  /** The watch could not be reached or refused the link: say what to check, offer Retry. */
  | { kind: 'unreachable'; message: string }
  /** Anything else (Bluetooth off, not allowed, unsupported model, ...): the plain message. */
  | { kind: 'other'; message: string };

export const BIND_CONFIRMATION = 'ERR_BIND_CONFIRMATION';

/** The one place that tells the person what usually blocks a connect: the watch's single link is held elsewhere. */
export const WATCH_BUSY_HINT =
  'Could not connect to the watch. If it is still connected to another phone or app (Huawei Health, or JoyoFit on another phone), ' +
  'disconnect it there first. Keep the watch awake and close to this phone, then tap Retry.';

const UNREACHABLE_CODES: Record<string, true> = {
  ERR_CONNECT_FAILED: true,
  ERR_TIMEOUT: true,
  ERR_DISCONNECTED: true,
  ERR_AUTH_FAILED: true,
};

export function errorCode(e: unknown): string | null {
  if (typeof e === 'object' && e !== null && 'code' in e && typeof e.code === 'string') return e.code;
  return null;
}

export function describeConnectFailure(e: unknown): ConnectFailure {
  const code = errorCode(e);
  if (code === BIND_CONFIRMATION) return { kind: 'bind' };
  if (code !== null && UNREACHABLE_CODES[code]) return { kind: 'unreachable', message: WATCH_BUSY_HINT };
  return { kind: 'other', message: errorMessage(e) };
}

/** Shown when the list has no watch that is in reach on iOS (a watch linked to another phone does not advertise). */
export const NO_WATCH_FOUND_HINT =
  'Watch not found. If it is still connected to another phone, disconnect it there first. Make sure the watch is on and close to this phone, then tap Refresh.';
