/**
 * Storage for the three things that must outlive a page: the profile, the running session and the last finished
 * session. Every page is bundled on its own on Lite Wearable, so module variables are not shared between pages; the
 * pages hand state to each other through these keys.
 *
 * Wraps @system.storage (key and string value, callbacks). Every call is guarded: when the API is missing or fails the
 * callback gets the fallback and the app carries on without saving.
 */
import storage from '@system.storage';
import { PROFILE_KEY, parse, serialize } from './profile.js';

/** Snapshot of the running or paused session (fuel.js `snapshot`). */
export var SESSION_KEY = 'fuel.session';
/** `{ summary, finishedAt }` of the last finished session, for the summary page. */
export var LAST_KEY = 'fuel.last';

function read(key, cb) {
  var done = false;
  function finish(value) {
    if (done) return;
    done = true;
    cb(value);
  }
  try {
    storage.get({
      key: key,
      default: '',
      success: function (data) {
        finish(typeof data === 'string' && data !== '' ? data : null);
      },
      fail: function (data, code) {
        console.error('fuel store.get ' + key + ' failed: ' + code + ' ' + data);
        finish(null);
      },
    });
  } catch (e) {
    console.error('fuel store.get ' + key + ' threw: ' + e);
    finish(null);
  }
}

function write(key, text, cb) {
  try {
    storage.set({
      key: key,
      value: text,
      success: function () {
        if (cb) cb(true);
      },
      fail: function (data, code) {
        console.error('fuel store.set ' + key + ' failed: ' + code + ' ' + data);
        if (cb) cb(false);
      },
    });
  } catch (e) {
    console.error('fuel store.set ' + key + ' threw: ' + e);
    if (cb) cb(false);
  }
}

function remove(key, cb) {
  try {
    storage.delete({
      key: key,
      success: function () {
        if (cb) cb(true);
      },
      fail: function (data, code) {
        console.error('fuel store.delete ' + key + ' failed: ' + code + ' ' + data);
        if (cb) cb(false);
      },
    });
  } catch (e) {
    console.error('fuel store.delete ' + key + ' threw: ' + e);
    if (cb) cb(false);
  }
}

/** cb(profile): the stored profile, or the defaults. */
export function loadProfile(cb) {
  read(PROFILE_KEY, function (text) {
    cb(parse(text));
  });
}

export function saveProfile(profile, cb) {
  write(PROFILE_KEY, serialize(profile), cb);
}

/** cb(object | null) */
export function loadJson(key, cb) {
  read(key, function (text) {
    if (text === null) {
      cb(null);
      return;
    }
    try {
      cb(JSON.parse(text));
    } catch (e) {
      cb(null);
    }
  });
}

export function saveJson(key, value, cb) {
  write(key, JSON.stringify(value), cb);
}

export function clearKey(key, cb) {
  remove(key, cb);
}
