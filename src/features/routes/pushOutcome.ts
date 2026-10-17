/** What a `pushRoute` result or error means for the person, as Indonesian copy. Pure; native types are imported as types only. */
import { errorCode } from '@/features/device/connectFailure';
import { errorMessage } from '@/format';
import type { RoutePushResult } from '@/wear';

import { copy } from './copy';

export type PushOutcome =
  /** The route is on the watch. `confirmed`: the watch also sent its final "saved" answer. */
  | { kind: 'sent'; sentPoints: number; totalPoints: number; confirmed: boolean }
  /** A route with this name is already on the watch; nothing was uploaded. */
  | { kind: 'already' }
  /** Not sent. `canRename`: a different name would help. */
  | { kind: 'failed'; message: string; canRename: boolean };

/** Handshake answers of the watch (`RoutePushResult.handshakeCode`) that say why it refused. */
const HANDSHAKE_FULL = 2;
const HANDSHAKE_NAME_TOO_LONG = 5;

/** The outcome of a `pushRoute` that resolved; `totalPoints` is how many points the saved route has. */
export function outcomeFromResult(result: RoutePushResult, totalPoints: number): PushOutcome {
  if (result.alreadyOnWatch) return { kind: 'already' };
  if (!result.ok) {
    if (result.handshakeCode === HANDSHAKE_FULL) return { kind: 'failed', message: copy.push.errors.ERR_ROUTE_FULL, canRename: false };
    if (result.handshakeCode === HANDSHAKE_NAME_TOO_LONG) {
      return { kind: 'failed', message: copy.push.errors.ERR_ROUTE_NAME, canRename: true };
    }
    return { kind: 'failed', message: copy.push.notAccepted(result.answerCode ?? result.handshakeCode), canRename: false };
  }
  return { kind: 'sent', sentPoints: result.sentPoints, totalPoints, confirmed: result.answerCode === 1 };
}

/** The outcome of a `pushRoute` that threw: the exception's `code` picks the copy, anything unknown shows its own message. */
export function outcomeFromError(e: unknown): PushOutcome {
  const code = errorCode(e);
  const message = errorMessage(e);
  switch (code) {
    case 'ERR_NOT_CONNECTED':
    case 'ERR_UNSUPPORTED':
    case 'ERR_ROUTE_FULL':
    case 'ERR_TIMEOUT':
    case 'ERR_BUSY':
    case 'ERR_DISCONNECTED':
      return { kind: 'failed', message: copy.push.errors[code], canRename: false };
    case 'ERR_ROUTE_NAME':
      return { kind: 'failed', message: copy.push.errors[code], canRename: true };
    case 'ERR_INVALID_ARGUMENT':
      return { kind: 'failed', message: copy.push.errors[code](message), canRename: false };
    case 'ERR_UPLOAD_REJECTED':
      return { kind: 'failed', message: copy.push.errors[code](message), canRename: false };
    default:
      return { kind: 'failed', message: copy.push.failedUnknown(message, code), canRename: false };
  }
}
