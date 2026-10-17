import app from '@system.app';
import router from '@system.router';
import { describe, fromPhone, sourceText, defaults } from '../../common/profile.js';
import { SESSION_KEY, clearKey, loadJson, loadProfile, saveProfile } from '../../common/store.js';
import { createLink } from '../../common/link.js';
import { P2pClient, Message, Builder } from '../../common/wearengine.js';
import { APP_VERSION, PEER_FINGERPRINT, PEER_FINGERPRINT_PLACEHOLDER, PEER_PKG } from '../../common/config.js';

var MUTED = '#9ba6a8';
var GOOD = '#5fd08d';
var WARN = '#f0a23c';

// Page-local state; every page is its own bundle on Lite Wearable.
var profile = defaults();
var link = null;
var destroyed = false;
/** Counts onInit calls, so a storage answer for an earlier page instance is dropped even if a new one already started. */
var generation = 0;

export default {
  data: {
    profileLine: '',
    profileSource: '',
    hasResume: false,
    profileBtnW: 360,
    linkText: 'Phone link: starting',
    linkColor: MUTED,
  },

  onInit() {
    var page = this;
    profile = defaults();
    destroyed = false;
    link = null;
    generation++;
    var mine = generation;
    page.showProfile();
    loadProfile(function (p) {
      // The page may have been replaced (Start, Profile) before storage answered: then no link, or it would never stop.
      if (destroyed || mine !== generation) return;
      profile = p;
      page.showProfile();
      page.startLink();
    });
    loadJson(SESSION_KEY, function (snap) {
      if (destroyed || mine !== generation) return;
      var open = !!snap && (snap.status === 'running' || snap.status === 'paused');
      page.hasResume = open;
      page.profileBtnW = open ? 176 : 360;
    });
  },

  onDestroy() {
    destroyed = true;
    if (link) link.stop();
    link = null;
  },

  showProfile() {
    this.profileLine = describe(profile);
    this.profileSource = sourceText(profile);
  },

  startLink() {
    var page = this;
    link = createLink(
      { P2pClient: P2pClient, Message: Message, Builder: Builder },
      {
        peerPkg: PEER_PKG,
        fingerprint: PEER_FINGERPRINT,
        placeholder: PEER_FINGERPRINT_PLACEHOLDER,
        version: APP_VERSION,
        delayMs: 800,
        setTimer: function (fn, ms) {
          setTimeout(fn, ms);
        },
        getProfileAt: function () {
          return profile.at;
        },
        onProfile: function (msg) {
          var r = fromPhone(profile, msg);
          if (!r.stored) {
            console.info('fuel: phone profile not taken: ' + r.reason);
            return null;
          }
          profile = r.profile;
          saveProfile(profile);
          page.showProfile();
          return profile;
        },
        onStatus: function (state, text) {
          page.linkText = text;
          page.linkColor = state === 'linked' ? GOOD : state === 'no-reply' ? WARN : MUTED;
        },
      }
    );
    link.start();
  },

  start() {
    // A new session replaces any unfinished one; the session page starts fresh when it finds no snapshot.
    clearKey(SESSION_KEY, function () {
      router.replace({ uri: 'pages/session/session' });
    });
  },

  resume() {
    router.replace({ uri: 'pages/session/session' });
  },

  /** Swipe right leaves the app (Huawei's documented pattern; the app cannot run in the background anyway). */
  onSwipe(e) {
    if (e.direction === 'right') app.terminate();
  },

  openProfile() {
    router.replace({ uri: 'pages/profile/profile' });
  },
};
