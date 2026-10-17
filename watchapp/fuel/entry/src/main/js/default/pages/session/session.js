import router from '@system.router';
import sensor from '@system.sensor';
import brightness from '@system.brightness';
import vibrator from '@system.vibrator';
import { ZONE_LABELS, createSession } from '../../common/fuel.js';
import { fatBarPx, formatBpm, formatDuration, formatGrams, formatKcal, formatPercent } from '../../common/format.js';
import { forSession } from '../../common/profile.js';
import { LAST_KEY, SESSION_KEY, clearKey, loadJson, loadProfile, saveJson } from '../../common/store.js';

var BAR_W = 360;
/** The heart-rate sensor reports about every 5 s; no reading for this long and the number is shown as "--". */
var STALE_MS = 15000;
/** Insurance against the app being killed without onHide or onDestroy: a snapshot this often while running. */
var PERSIST_EVERY_MS = 30000;
var CONFIRM_MS = 3000;
var ZONE_COLORS = ['#9ba6a8', '#58c4de', '#5fd08d', '#f0a23c', '#ff8fa4', '#ff8a80'];
var MUTED = '#9ba6a8';

// Page-local state; every page is its own bundle on Lite Wearable.
var session = createSession();
var ready = false;
var shown = false;
var active = false;
var awayAt = null;
var finishing = false;
var tickTimer = null;
var persistTimer = null;
var confirmTimer = null;
var hrNote = '';

function keepScreenOn(on) {
  try {
    brightness.setKeepScreenOn({
      keepScreenOn: on,
      fail: function (data, code) {
        console.error('fuel setKeepScreenOn failed: ' + code + ' ' + data);
      },
    });
  } catch (e) {
    console.error('fuel setKeepScreenOn threw: ' + e);
  }
}

function buzz() {
  try {
    vibrator.vibrate({ mode: 'short' });
  } catch (e) {
    console.error('fuel vibrate threw: ' + e);
  }
}

function unsubscribeHr() {
  try {
    sensor.unsubscribeHeartRate();
  } catch (e) {
    console.error('fuel unsubscribeHeartRate threw: ' + e);
  }
}

export default {
  data: {
    elapsed: '0:00',
    hr: '--',
    zoneText: 'Waiting for heart rate',
    zoneColor: MUTED,
    kcal: '0',
    fat: '0.0',
    carbs: '0.0',
    fatLabel: 'FAT',
    carbLabel: 'CARBS',
    fatPx: BAR_W / 2,
    carbPx: BAR_W / 2,
    hint: 'Tap to pause',
    finishText: 'Finish',
    finishColor: '#ff8a80',
  },

  onInit() {
    var page = this;
    ready = false;
    shown = false;
    active = false;
    awayAt = null;
    finishing = false;
    hrNote = '';
    session = createSession();
    loadJson(SESSION_KEY, function (snap) {
      var now = Date.now();
      var restored = session.restore(snap, now);
      if (!restored || session.status() === 'finished') {
        loadProfile(function (profile) {
          session = createSession();
          session.start(forSession(profile), Date.now());
          buzz();
          page.persist();
          page.begin();
        });
        return;
      }
      page.begin();
    });
  },

  onShow() {
    shown = true;
    this.activate();
  },

  onHide() {
    shown = false;
    this.deactivate();
  },

  onDestroy() {
    shown = false;
    this.deactivate();
    if (confirmTimer) clearTimeout(confirmTimer);
    confirmTimer = null;
  },

  begin() {
    ready = true;
    this.refresh();
    this.activate();
  },

  /** The page is visible and the session loaded: count time again, listen to the sensor, keep the screen on. */
  activate() {
    if (!ready || !shown || active || finishing) return;
    active = true;
    var now = Date.now();
    if (awayAt !== null) {
      session.away(awayAt, now);
      awayAt = null;
    }
    this.startTimers();
    if (session.status() === 'running') {
      this.subscribeHr();
      keepScreenOn(true);
    }
    this.refresh();
  },

  /** The page is hidden or going away: save, stop the sensor and the timers. The time until activate() is a pause. */
  deactivate() {
    if (!active) return;
    active = false;
    var now = Date.now();
    if (session.status() === 'running') awayAt = now;
    this.stopTimers();
    unsubscribeHr();
    keepScreenOn(false);
    this.persist();
  },

  startTimers() {
    var page = this;
    this.stopTimers();
    tickTimer = setInterval(function () {
      page.refresh();
    }, 1000);
    persistTimer = setInterval(function () {
      if (session.status() === 'running') page.persist();
    }, PERSIST_EVERY_MS);
  },

  stopTimers() {
    if (tickTimer) clearInterval(tickTimer);
    if (persistTimer) clearInterval(persistTimer);
    tickTimer = null;
    persistTimer = null;
  },

  subscribeHr() {
    var page = this;
    hrNote = '';
    try {
      sensor.subscribeHeartRate({
        success: function (ret) {
          session.sample(Number(ret.heartRate), Date.now());
          page.refresh();
        },
        fail: function (data, code) {
          console.error('fuel subscribeHeartRate failed: ' + code + ' ' + data);
          hrNote = 'Heart rate sensor unavailable (' + code + ')';
          page.refresh();
        },
      });
    } catch (e) {
      console.error('fuel subscribeHeartRate threw: ' + e);
      hrNote = 'Heart rate sensor unavailable';
    }
  },

  persist() {
    saveJson(SESSION_KEY, session.snapshot(Date.now()));
  },

  refresh() {
    var now = Date.now();
    var s = session.summary(now);
    var live = s.status === 'running' && s.sinceSampleMs !== null && s.sinceSampleMs <= STALE_MS;
    this.elapsed = formatDuration(s.elapsedSec);
    this.hr = live ? formatBpm(s.lastHr) : '--';
    var zone = live && s.zone !== null ? s.zone : null;
    this.zoneColor = zone === null ? MUTED : ZONE_COLORS[zone];
    if (s.status === 'paused') this.zoneText = 'Paused';
    else if (hrNote !== '') this.zoneText = hrNote;
    else if (zone === null) this.zoneText = 'Waiting for heart rate';
    else this.zoneText = ZONE_LABELS[zone];
    this.kcal = formatKcal(s.kcal);
    this.fat = formatGrams(s.fatGrams);
    this.carbs = formatGrams(s.carbGrams);
    this.fatLabel = 'FAT ' + formatPercent(s.fatShare);
    this.carbLabel = 'CARBS ' + formatPercent(s.fatShare === null ? null : 1 - s.fatShare);
    var fatPx = fatBarPx(s.fatShare, BAR_W);
    this.fatPx = fatPx;
    this.carbPx = BAR_W - fatPx;
    this.hint = s.status === 'paused' ? 'Paused. Tap to resume' : 'Tap to pause';
  },

  /** Tap on the numbers: pause or resume. */
  toggle() {
    if (!ready || finishing) return;
    var now = Date.now();
    if (session.status() === 'running') {
      session.pause(now);
      unsubscribeHr();
      keepScreenOn(false);
    } else if (session.status() === 'paused') {
      session.resume(now);
      this.subscribeHr();
      keepScreenOn(true);
    }
    this.persist();
    this.refresh();
  },

  /** First tap asks, second tap within CONFIRM_MS finishes. */
  finish() {
    var page = this;
    if (!ready || finishing) return;
    if (confirmTimer === null) {
      this.finishText = 'Tap again to finish';
      confirmTimer = setTimeout(function () {
        confirmTimer = null;
        page.finishText = 'Finish';
      }, CONFIRM_MS);
      return;
    }
    clearTimeout(confirmTimer);
    confirmTimer = null;
    finishing = true;
    var now = Date.now();
    session.finish(now);
    this.stopTimers();
    active = false;
    unsubscribeHr();
    keepScreenOn(false);
    buzz();
    var summary = session.summary(now);
    saveJson(LAST_KEY, { summary: summary, finishedAt: now }, function () {
      clearKey(SESSION_KEY, function () {
        router.replace({ uri: 'pages/summary/summary' });
      });
    });
  },
};
