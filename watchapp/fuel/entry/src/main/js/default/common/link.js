/**
 * Phone link: JoyoFit Fuel <-> JoyoFit over Huawei's Wear Engine P2P (the contract is in README.md).
 *
 *   watch -> phone  {"v":1,"t":"hello","ver":"1.0.0","profileAt":<ms>}   once the receiver is registered
 *   phone -> watch  {"v":1,"t":"profile",...}                           stored when `opts.onProfile` accepts it
 *   watch -> phone  {"v":1,"t":"ack","at":<stored at>}                  after a profile was stored
 *
 * Every call into the SDK is guarded. A missing SDK file (wearengine.js is still the placeholder), a fingerprint nobody
 * pasted, a thrown error or an unreachable phone all end the same way: status "off" or "no-reply", the app keeps
 * working on the profile on the watch. Nothing here throws to the caller.
 *
 * `sdk` is `{ P2pClient, Message, Builder }` (the exports of wearengine.js), injected so the logic runs under bun test.
 * The SDK's constructor asks Wear Engine for its service version through a callback, and registerReceiver picks its
 * message API from that version, so the receiver is registered `delayMs` after the constructor (UNVERIFIED that the
 * delay is needed; on Lite Wearable the callback may well run before the constructor returns).
 */

/**
 * The payload as the SDK hands it over (a string, or an object with `message`) to a message object, or null. Leading and
 * trailing bytes around the braces are ignored, as JoyoFit does with the watch's messages.
 */
export function parseMessage(data) {
  var text = null;
  if (typeof data === 'string') text = data;
  else if (data && typeof data.message === 'string') text = data.message;
  else if (data && typeof data === 'object' && data.v !== undefined) return data;
  if (text === null) return null;
  var first = text.indexOf('{');
  var last = text.lastIndexOf('}');
  if (first < 0 || last <= first) return null;
  try {
    var msg = JSON.parse(text.substring(first, last + 1));
    return msg && typeof msg === 'object' ? msg : null;
  } catch (e) {
    return null;
  }
}

/**
 * opts: peerPkg, fingerprint, placeholder, version, delayMs, setTimer(fn, ms),
 *       getProfileAt() -> number, onProfile(msg) -> the stored profile or null, onStatus(state, text).
 * States: "off", "connecting", "linked", "no-reply".
 */
export function createLink(sdk, opts) {
  var client = null;
  var started = false;
  var stopped = false;

  function status(state, text) {
    if (opts.onStatus) opts.onStatus(state, text);
  }

  function off(reason) {
    status('off', 'Phone link off: ' + reason);
  }

  function send(obj, cb) {
    var settled = false;
    function settle(ok) {
      if (settled) return;
      settled = true;
      if (cb) cb(ok);
    }
    try {
      var builder = new sdk.Builder();
      builder.setDescription(JSON.stringify(obj));
      var message = new sdk.Message();
      message.builder = builder;
      client.send(message, {
        onSuccess: function () {
          settle(true);
        },
        onFailure: function () {
          settle(false);
        },
        onSendResult: function () {},
        onSendProgress: function () {},
      });
    } catch (e) {
      console.error('fuel link send threw: ' + e);
      settle(false);
    }
  }

  function sendHello() {
    send({ v: 1, t: 'hello', ver: opts.version, profileAt: opts.getProfileAt() }, function (ok) {
      if (ok) status('linked', 'Phone link: linked');
      else status('no-reply', 'Phone link: phone not reachable');
    });
  }

  function onData(data) {
    if (data && data.isFileType) return;
    var msg = parseMessage(data);
    if (!msg || msg.v !== 1) {
      console.info('fuel link: message ignored');
      return;
    }
    if (msg.t !== 'profile') return;
    var stored = null;
    try {
      stored = opts.onProfile(msg);
    } catch (e) {
      console.error('fuel link onProfile threw: ' + e);
    }
    if (stored) {
      send({ v: 1, t: 'ack', at: stored.at });
      status('linked', 'Phone link: profile received');
    }
  }

  function connect() {
    if (stopped) return;
    try {
      client.setPeerPkgName(opts.peerPkg);
      client.setPeerFingerPrint(opts.fingerprint);
      client.registerReceiver({
        onSuccess: function () {
          sendHello();
        },
        onFailure: function () {
          off('receiver not registered');
        },
        onReceiveMessage: onData,
      });
    } catch (e) {
      console.error('fuel link connect threw: ' + e);
      off('Wear Engine error');
    }
  }

  return {
    start: function () {
      if (started) return;
      started = true;
      if (!sdk || typeof sdk.P2pClient !== 'function' || typeof sdk.Message !== 'function' || typeof sdk.Builder !== 'function') {
        off('Wear Engine SDK not installed');
        return;
      }
      if (!opts.fingerprint || opts.fingerprint === opts.placeholder) {
        off('JoyoFit fingerprint not set');
        return;
      }
      status('connecting', 'Phone link: connecting');
      try {
        client = new sdk.P2pClient();
      } catch (e) {
        console.error('fuel link constructor threw: ' + e);
        off('Wear Engine error');
        return;
      }
      opts.setTimer(connect, opts.delayMs);
    },

    stop: function () {
      stopped = true;
      if (!client) return;
      try {
        client.unregisterReceiver({ onSuccess: function () {} });
      } catch (e) {
        console.error('fuel link unregister threw: ' + e);
      }
    },
  };
}
