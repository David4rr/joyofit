import { describe, expect, it } from 'bun:test';

import { BIND_CONFIRMATION, describeConnectFailure, WATCH_BUSY_HINT } from './connectFailure';

function coded(code: string, message = 'native detail'): Error {
  return Object.assign(new Error(message), { code });
}

describe('describeConnectFailure', () => {
  it('turns the bind stop into a question, not an error', () => {
    expect(describeConnectFailure(coded(BIND_CONFIRMATION))).toEqual({ kind: 'bind' });
  });

  it('explains every way a busy or unreachable watch fails with the same hint', () => {
    for (const code of ['ERR_CONNECT_FAILED', 'ERR_TIMEOUT', 'ERR_DISCONNECTED', 'ERR_AUTH_FAILED']) {
      expect(describeConnectFailure(coded(code))).toEqual({ kind: 'unreachable', message: WATCH_BUSY_HINT });
    }
  });

  it('keeps the plain message for Bluetooth and support errors', () => {
    expect(describeConnectFailure(coded('ERR_BLUETOOTH_OFF', 'Bluetooth is turned off'))).toEqual({
      kind: 'other',
      message: 'Bluetooth is turned off',
    });
    expect(describeConnectFailure(new Error('boom'))).toEqual({ kind: 'other', message: 'boom' });
    expect(describeConnectFailure('plain')).toEqual({ kind: 'other', message: 'plain' });
  });
});
