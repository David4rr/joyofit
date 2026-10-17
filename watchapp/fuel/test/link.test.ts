import { describe, expect, it } from 'bun:test';

import { createLink, parseMessage } from '../entry/src/main/js/default/common/link.js';
import { fromPhone, defaults } from '../entry/src/main/js/default/common/profile.js';
import * as placeholderSdk from '../entry/src/main/js/default/common/wearengine.js';
import { PEER_FINGERPRINT, PEER_FINGERPRINT_PLACEHOLDER, PEER_PKG } from '../entry/src/main/js/default/common/config.js';

const GOOD_FP = 'AB'.repeat(32);

/** A fake of wearengine.js: records what the link does and lets the test play the phone. */
function fakeSdk(opts: { sendOk?: boolean; registerOk?: boolean; throwOn?: string } = {}) {
  const log = {
    peerPkg: '',
    peerFp: '',
    sent: [] as unknown[],
    receiver: null as null | { onSuccess: () => void; onFailure: () => void; onReceiveMessage: (d: unknown) => void },
    unregistered: false,
    constructed: 0,
  };
  class P2pClient {
    constructor() {
      log.constructed++;
      if (opts.throwOn === 'ctor') throw new Error('no service');
    }
    setPeerPkgName(p: string) {
      log.peerPkg = p;
    }
    setPeerFingerPrint(f: string) {
      log.peerFp = f;
      if (opts.throwOn === 'fp') throw new Error('boom');
    }
    registerReceiver(r: NonNullable<typeof log.receiver>) {
      log.receiver = r;
      if (opts.registerOk === false) r.onFailure();
      else r.onSuccess();
    }
    send(message: { getData(): string }, cb: { onSuccess(): void; onFailure(): void; onSendResult(r: unknown): void; onSendProgress(p: unknown): void }) {
      if (opts.throwOn === 'send') throw new Error('send boom');
      log.sent.push(JSON.parse(message.getData()));
      if (opts.sendOk === false) cb.onFailure();
      else cb.onSuccess();
    }
    unregisterReceiver(r: { onSuccess(): void }) {
      log.unregistered = true;
      r.onSuccess();
    }
  }
  class Builder {
    messageInfo = '';
    setDescription(d: string) {
      this.messageInfo = d;
    }
  }
  class Message {
    builder: Builder | null = null;
    getData() {
      return this.builder!.messageInfo;
    }
  }
  return { sdk: { P2pClient, Message, Builder }, log };
}

function harness(sdk: unknown, over: Record<string, unknown> = {}) {
  const statuses: string[][] = [];
  const stored: unknown[] = [];
  let profile = defaults();
  const link = createLink(sdk as never, {
    peerPkg: PEER_PKG,
    fingerprint: GOOD_FP,
    placeholder: PEER_FINGERPRINT_PLACEHOLDER,
    version: '1.0.0',
    delayMs: 800,
    setTimer: (fn: () => void) => fn(),
    getProfileAt: () => profile.at,
    onProfile: (msg: unknown) => {
      const r = fromPhone(profile, msg as never);
      if (!r.stored) return null;
      profile = r.profile!;
      stored.push(profile);
      return profile;
    },
    onStatus: (state: string, text: string) => statuses.push([state, text]),
    ...over,
  });
  return { link, statuses, stored, get profile() { return profile; } };
}

describe('parseMessage', () => {
  it('reads a JSON string, an object with message, and ignores bytes around the braces', () => {
    expect(parseMessage('{"v":1,"t":"profile"}')).toEqual({ v: 1, t: 'profile' });
    expect(parseMessage({ message: '{"v":1,"t":"x"}' })).toEqual({ v: 1, t: 'x' });
    expect(parseMessage('\u0001\u0002{"v":1}\n')).toEqual({ v: 1 });
    expect(parseMessage({ v: 1, t: 'x' })).toEqual({ v: 1, t: 'x' });
  });

  it('gives null for anything else', () => {
    expect(parseMessage('')).toBeNull();
    expect(parseMessage('no braces')).toBeNull();
    expect(parseMessage('{broken')).toBeNull();
    expect(parseMessage('}{')).toBeNull();
    expect(parseMessage(null)).toBeNull();
    expect(parseMessage(42)).toBeNull();
    expect(parseMessage({ isFileType: true, name: 'x' })).toBeNull();
  });
});

describe('phone link', () => {
  it('sends hello with the profile time once the receiver is registered', () => {
    const { sdk, log } = fakeSdk();
    const h = harness(sdk);
    h.link.start();
    expect(log.peerPkg).toBe('com.joyodigitama.joyofit');
    expect(log.peerFp).toBe(GOOD_FP);
    expect(log.sent).toEqual([{ v: 1, t: 'hello', ver: '1.0.0', profileAt: 0 }]);
    expect(h.statuses.map((s) => s[0])).toEqual(['connecting', 'linked']);
  });

  it('stores a newer phone profile and acknowledges it with the stored at', () => {
    const { sdk, log } = fakeSdk();
    const h = harness(sdk);
    h.link.start();
    log.sent.length = 0;
    const msg = '{"v":1,"t":"profile","weightKg":72.5,"age":34,"sex":"male","maxHr":186,"restHr":58,"at":1800000000000}';
    log.receiver!.onReceiveMessage(msg);
    expect(h.stored.length).toBe(1);
    expect(h.profile.weightKg).toBe(72.5);
    expect(log.sent).toEqual([{ v: 1, t: 'ack', at: 1800000000000 }]);
    // the same message again is not newer: no store, no ack
    log.receiver!.onReceiveMessage(msg);
    expect(h.stored.length).toBe(1);
    expect(log.sent.length).toBe(1);
  });

  it('acknowledges a profile at 0 for a watch that holds none', () => {
    const { sdk, log } = fakeSdk();
    const h = harness(sdk);
    h.link.start();
    log.sent.length = 0;
    log.receiver!.onReceiveMessage('{"v":1,"t":"profile","weightKg":70.0,"age":35,"sex":"unknown","maxHr":185,"restHr":null,"at":0}');
    expect(log.sent).toEqual([{ v: 1, t: 'ack', at: 0 }]);
  });

  it('ignores files, other versions, other types and garbage', () => {
    const { sdk, log } = fakeSdk();
    const h = harness(sdk);
    h.link.start();
    log.sent.length = 0;
    for (const data of [{ isFileType: true, name: 'f' }, '{"v":2,"t":"profile"}', '{"v":1,"t":"ping"}', 'zzz', null, undefined]) {
      log.receiver!.onReceiveMessage(data);
    }
    expect(h.stored.length).toBe(0);
    expect(log.sent.length).toBe(0);
  });

  it('is off, without throwing, when the SDK file is still the placeholder', () => {
    const h = harness(placeholderSdk);
    h.link.start();
    expect(h.statuses).toEqual([['off', 'Phone link off: Wear Engine SDK not installed']]);
    h.link.stop();
  });

  it('is off when the fingerprint was never pasted', () => {
    const { sdk, log } = fakeSdk();
    for (const fingerprint of [PEER_FINGERPRINT_PLACEHOLDER, '', undefined]) {
      const h = harness(sdk, { fingerprint });
      h.link.start();
      expect(h.statuses).toEqual([['off', 'Phone link off: JoyoFit fingerprint not set']]);
    }
    expect(log.constructed).toBe(0);
  });

  it('shipped config.js still has the placeholder, which link.js treats as not set', () => {
    expect(PEER_FINGERPRINT === PEER_FINGERPRINT_PLACEHOLDER || /^[0-9A-F]{64}$/.test(PEER_FINGERPRINT)).toBe(true);
  });

  it('is off when the SDK throws or refuses the receiver', () => {
    for (const throwOn of ['ctor', 'fp']) {
      const { sdk } = fakeSdk({ throwOn });
      const h = harness(sdk);
      expect(() => h.link.start()).not.toThrow();
      expect(h.statuses[h.statuses.length - 1][0]).toBe('off');
    }
    const refused = fakeSdk({ registerOk: false });
    const h = harness(refused.sdk);
    h.link.start();
    expect(h.statuses[h.statuses.length - 1]).toEqual(['off', 'Phone link off: receiver not registered']);
  });

  it('reports no-reply when the phone cannot be reached, and survives a throwing send', () => {
    const down = fakeSdk({ sendOk: false });
    const h = harness(down.sdk);
    h.link.start();
    expect(h.statuses[h.statuses.length - 1]).toEqual(['no-reply', 'Phone link: phone not reachable']);
    const boom = fakeSdk({ throwOn: 'send' });
    const g = harness(boom.sdk);
    expect(() => g.link.start()).not.toThrow();
    expect(g.statuses[g.statuses.length - 1][0]).toBe('no-reply');
  });

  it('waits delayMs before registering, and not at all after stop', () => {
    const { sdk, log } = fakeSdk();
    let pending: (() => void) | null = null;
    let waited = -1;
    const h = harness(sdk, {
      setTimer: (fn: () => void, ms: number) => {
        pending = fn;
        waited = ms;
      },
    });
    h.link.start();
    expect(waited).toBe(800);
    expect(log.receiver).toBeNull();
    h.link.stop();
    pending!();
    expect(log.receiver).toBeNull();
    expect(log.unregistered).toBe(true);
  });

  it('keeps every message under the 1 KB Wear Engine limit', () => {
    const { sdk, log } = fakeSdk();
    const h = harness(sdk);
    h.link.start();
    log.receiver!.onReceiveMessage('{"v":1,"t":"profile","weightKg":72.5,"age":34,"sex":"male","maxHr":186,"restHr":58,"at":1800000000000}');
    for (const m of log.sent) expect(JSON.stringify(m).length).toBeLessThan(1024);
  });
});
