import { afterAll, beforeEach, describe, expect, it, mock } from 'bun:test';

/**
 * Drives pages/index/index.js with the watch modules replaced: @system.storage answers only when the test says so, and the
 * Wear Engine SDK is a recording fake. Checks that a page replaced before storage answered never starts a link.
 */
const pendingGets: { key: string; success: (v: unknown) => void }[] = [];
const registered = { receivers: 0, unregistered: 0 };

mock.module('@system.storage', () => ({
  default: {
    get: (o: { key: string; success: (v: unknown) => void }) => pendingGets.push({ key: o.key, success: o.success }),
    set: (o: { success?: () => void }) => o.success?.(),
    delete: (o: { success?: () => void }) => o.success?.(),
  },
}));
mock.module('@system.router', () => ({ default: { replace: () => {} } }));
mock.module('@system.app', () => ({ default: { terminate: () => {} } }));
mock.module('../entry/src/main/js/default/common/config.js', () => ({
  BUNDLE_NAME: 'com.joyodigitama.joyofit.fuel',
  APP_VERSION: '1.0.0',
  PEER_PKG: 'com.joyodigitama.joyofit',
  PEER_FINGERPRINT_PLACEHOLDER: 'PASTE_JOYOFIT_SHA256_HERE',
  PEER_FINGERPRINT: 'AB'.repeat(32),
}));
mock.module('../entry/src/main/js/default/common/wearengine.js', () => {
  class P2pClient {
    setPeerPkgName() {}
    setPeerFingerPrint() {}
    registerReceiver() {
      registered.receivers++;
    }
    send() {}
    unregisterReceiver(r: { onSuccess(): void }) {
      registered.unregistered++;
      r.onSuccess();
    }
  }
  class Builder {
    setDescription() {}
  }
  class Message {}
  return { P2pClient, Message, Builder };
});
const realSetTimeout = globalThis.setTimeout;
(globalThis as { setTimeout: unknown }).setTimeout = ((fn: () => void) => {
  fn();
  return 0;
}) as never;
afterAll(() => {
  globalThis.setTimeout = realSetTimeout;
});

const page = (await import('../entry/src/main/js/default/pages/index/index.js')).default as unknown as {
  data: Record<string, unknown>;
  onInit(): void;
  onDestroy(): void;
  [k: string]: unknown;
};

function instance() {
  const self = Object.create(page) as typeof page;
  self.data = {};
  Object.assign(self, JSON.parse(JSON.stringify(page.data)));
  return self;
}

beforeEach(() => {
  pendingGets.length = 0;
  registered.receivers = 0;
  registered.unregistered = 0;
});

describe('home page link lifecycle', () => {
  it('starts the link once storage answered', () => {
    const p = instance();
    p.onInit();
    for (const g of pendingGets) g.success('');
    expect(registered.receivers).toBe(1);
    p.onDestroy();
    expect(registered.unregistered).toBe(1);
  });

  it('does not start a link when the page was replaced before storage answered', () => {
    const p = instance();
    p.onInit();
    p.onDestroy(); // Start or Profile tapped
    for (const g of pendingGets) g.success('');
    expect(registered.receivers).toBe(0);
  });

  it('drops the answer for an earlier instance even when a new one already started', () => {
    const first = instance();
    first.onInit();
    const firstGets = pendingGets.splice(0);
    first.onDestroy();
    const second = instance();
    second.onInit();
    for (const g of firstGets) g.success('');
    expect(registered.receivers).toBe(0);
    for (const g of pendingGets) g.success('');
    expect(registered.receivers).toBe(1);
    second.onDestroy();
    expect(registered.unregistered).toBe(1);
  });
});
