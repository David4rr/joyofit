/**
 * JoyoFit Fuel math: energy from heart rate and the fat / carbohydrate split.
 *
 * Pure functions and one session accumulator. Nothing here reads a clock, a global or the watch APIs: time comes in as
 * `nowMs` arguments, so the same code runs on the watch and under `bun test`. Written in the JS subset Lite Wearable
 * accepts (var, plain functions, no spread, no optional chaining, no Map or Set).
 *
 * Same numbers as the phone, one formula at a time (the contract is the P2P contract in README.md):
 *  - kcalPerMinute = HeartRateEnergy.kcalPerMinute in modules/huawei-wear/.../LiveWorkoutCodec.kt (Keytel 2005).
 *  - fatShare / maxHeartRate = SubstrateEstimator in the same file, RER points as src/features/workouts/substrate.ts.
 *  - A reading covers the time since the previous reading and is attributed with the heart rate of the NEW reading, as
 *    LiveWorkout.onHeartRate does. (substrate.ts, which works from a finished workout, attributes a slice to the
 *    reading at its start; the totals differ by one reading's shift.)
 *  - A gap over two minutes between readings counts as a pause (substrate.ts MAX_GAP_SEC): no energy, no zone time.
 */

export var KCAL_PER_G_FAT = 9;
export var KCAL_PER_G_CARB = 4;
/** Floor of the Keytel rate, kcal per minute (HeartRateEnergy.REST_KCAL_PER_MIN). */
export var REST_KCAL_PER_MIN = 1.2;
/** A gap longer than this between two heart-rate readings is a pause. */
export var MAX_GAP_MS = 120000;

/** %VO2max to respiratory exchange ratio (Romijn 1993, Achten 2003), the same points as substrate.ts RER_POINTS. */
export var RER_POINTS = [
  [25, 0.78],
  [45, 0.83],
  [65, 0.88],
  [85, 0.95],
  [100, 1.0],
];

/** Huawei's zones: 50, 60, 70, 80, 90 % of maximum heart rate; zone 0 is below 50 %. */
export var ZONE_LABELS = ['Below zones', 'Warm-up', 'Fat burning', 'Aerobic', 'Anaerobic', 'Extreme'];

function clamp(x, lo, hi) {
  return Math.min(hi, Math.max(lo, x));
}

/** 220 - age, kept between 120 and 220 (SubstrateEstimator.maxHeartRate). */
export function maxHeartRate(age) {
  return clamp(220 - age, 120, 220);
}

function interpolateRer(pctVo2) {
  for (var i = 1; i < RER_POINTS.length; i++) {
    var x1 = RER_POINTS[i][0];
    var y1 = RER_POINTS[i][1];
    if (pctVo2 <= x1) {
      var x0 = RER_POINTS[i - 1][0];
      var y0 = RER_POINTS[i - 1][1];
      return y0 + ((y1 - y0) * (pctVo2 - x0)) / (x1 - x0);
    }
  }
  return RER_POINTS[RER_POINTS.length - 1][1];
}

/**
 * Share of energy from fat (0..1) at `heartRate`: %HRmax to %VO2max after Swain (1994), RER from the curve, then
 * `(1 - RER) / 0.3` (SubstrateEstimator.fatShare).
 */
export function fatShare(heartRate, maxHr) {
  var pctHrMax = (100 * heartRate) / maxHr;
  var pctVo2 = clamp((pctHrMax - 37) / 0.64, 25, 100);
  return clamp((1 - interpolateRer(pctVo2)) / 0.3, 0, 1);
}

/** Zone 0..5 by share of maximum heart rate (substrate.ts zoneOf). */
export function zoneOf(heartRate, maxHr) {
  var pct = heartRate / maxHr;
  if (pct < 0.5) return 0;
  return Math.min(5, Math.floor((pct - 0.5) / 0.1) + 1);
}

/**
 * Keytel et al. (2005), kJ per minute from heart rate, weight and age, divided by 4.184. `sex` other than "male" or
 * "female" uses the mean of both equations. Never below REST_KCAL_PER_MIN (HeartRateEnergy.kcalPerMinute).
 */
export function kcalPerMinute(heartRate, weightKg, age, sex) {
  var male = (-55.0969 + 0.6309 * heartRate + 0.1988 * weightKg + 0.2017 * age) / 4.184;
  var female = (-20.4022 + 0.4472 * heartRate - 0.1263 * weightKg + 0.074 * age) / 4.184;
  var kcal;
  if (sex === 'male') kcal = male;
  else if (sex === 'female') kcal = female;
  else kcal = (male + female) / 2;
  return Math.max(kcal, REST_KCAL_PER_MIN);
}

function copyZones(zoneMs) {
  var out = [];
  for (var i = 0; i < zoneMs.length; i++) out.push(zoneMs[i]);
  return out;
}

function validHeartRate(hr) {
  return typeof hr === 'number' && hr > 0 && hr < Infinity;
}

/**
 * One workout's accumulator. `profile` is `{ weightKg, age, sex, maxHr }` (maxHr already resolved), frozen at start.
 *
 *   var s = createSession();
 *   s.start(profile, nowMs);
 *   s.sample(hr, nowMs);      // every reading
 *   s.pause(nowMs); s.resume(nowMs);
 *   s.finish(nowMs);
 *   s.summary(nowMs);         // plain numbers for the screens
 *   s.snapshot(nowMs); s.restore(snapshot, nowMs);   // JSON-safe, for the storage across page changes
 */
export function createSession() {
  var st = blank();

  function blank() {
    return {
      status: 'idle', // idle | running | paused | finished
      startedAt: 0,
      endedAt: 0,
      pausedAt: 0,
      pausedMs: 0,
      lastSampleAt: null, // time of the previous reading, null after a pause so the next one starts a new slice
      lastHr: 0,
      kcal: 0,
      fatKcal: 0,
      carbKcal: 0,
      hrSum: 0,
      hrCount: 0,
      hrMax: 0,
      countedMs: 0,
      zoneMs: [0, 0, 0, 0, 0, 0],
      profile: { weightKg: 70, age: 35, sex: 'unknown', maxHr: 185 },
    };
  }

  function elapsedMs(nowMs) {
    var end;
    if (st.status === 'running') end = nowMs;
    else if (st.status === 'paused') end = st.pausedAt;
    else if (st.status === 'finished') end = st.endedAt;
    else return 0;
    return Math.max(0, end - st.startedAt - st.pausedMs);
  }

  var api = {
    start: function (profile, nowMs) {
      st = blank();
      st.profile = {
        weightKg: profile.weightKg,
        age: profile.age,
        sex: profile.sex,
        maxHr: profile.maxHr,
      };
      st.status = 'running';
      st.startedAt = nowMs;
    },

    sample: function (hr, nowMs) {
      if (st.status !== 'running' || !validHeartRate(hr)) return;
      var p = st.profile;
      if (st.lastSampleAt !== null) {
        var dt = nowMs - st.lastSampleAt;
        if (dt > 0 && dt <= MAX_GAP_MS) {
          var kcal = kcalPerMinute(hr, p.weightKg, p.age, p.sex) * (dt / 60000);
          var fat = fatShare(hr, p.maxHr);
          st.kcal += kcal;
          st.fatKcal += kcal * fat;
          st.carbKcal += kcal * (1 - fat);
          st.zoneMs[zoneOf(hr, p.maxHr)] += dt;
          st.countedMs += dt;
        }
      }
      st.lastSampleAt = nowMs;
      st.lastHr = hr;
      st.hrSum += hr;
      st.hrCount += 1;
      if (hr > st.hrMax) st.hrMax = hr;
    },

    pause: function (nowMs) {
      if (st.status !== 'running') return;
      st.status = 'paused';
      st.pausedAt = nowMs;
      st.lastSampleAt = null;
    },

    resume: function (nowMs) {
      if (st.status !== 'paused') return;
      st.pausedMs += Math.max(0, nowMs - st.pausedAt);
      st.status = 'running';
      st.lastSampleAt = null;
    },

    /** The page was away from `fromMs` to `nowMs`: that time is a pause even though the session stays running. */
    away: function (fromMs, nowMs) {
      if (st.status !== 'running') return;
      st.pausedMs += Math.max(0, nowMs - fromMs);
      st.lastSampleAt = null;
    },

    finish: function (nowMs) {
      if (st.status !== 'running' && st.status !== 'paused') return;
      if (st.status === 'paused') st.pausedMs += Math.max(0, nowMs - st.pausedAt);
      st.status = 'finished';
      st.endedAt = nowMs;
      st.lastSampleAt = null;
    },

    status: function () {
      return st.status;
    },

    summary: function (nowMs) {
      var zoneSeconds = [];
      for (var i = 0; i < st.zoneMs.length; i++) zoneSeconds.push(st.zoneMs[i] / 1000);
      return {
        status: st.status,
        elapsedSec: elapsedMs(nowMs) / 1000,
        countedSec: st.countedMs / 1000,
        kcal: st.kcal,
        fatKcal: st.fatKcal,
        carbKcal: st.carbKcal,
        fatGrams: st.fatKcal / KCAL_PER_G_FAT,
        carbGrams: st.carbKcal / KCAL_PER_G_CARB,
        /** Fat share of the energy burned so far, 0..1; null before the first counted slice. */
        fatShare: st.kcal > 0 ? st.fatKcal / st.kcal : null,
        avgHr: st.hrCount > 0 ? st.hrSum / st.hrCount : null,
        maxHr: st.hrCount > 0 ? st.hrMax : null,
        lastHr: st.lastHr > 0 ? st.lastHr : null,
        /** Zone of the latest reading; null before one. */
        zone: st.lastHr > 0 ? zoneOf(st.lastHr, st.profile.maxHr) : null,
        zoneSeconds: zoneSeconds,
        /** Milliseconds since the latest reading; null when there is none or after a pause. */
        sinceSampleMs: st.lastSampleAt === null ? null : Math.max(0, nowMs - st.lastSampleAt),
        profile: {
          weightKg: st.profile.weightKg,
          age: st.profile.age,
          sex: st.profile.sex,
          maxHr: st.profile.maxHr,
        },
      };
    },

    snapshot: function (nowMs) {
      return {
        v: 1,
        savedAt: nowMs,
        status: st.status,
        startedAt: st.startedAt,
        endedAt: st.endedAt,
        pausedAt: st.pausedAt,
        pausedMs: st.pausedMs,
        lastSampleAt: st.lastSampleAt,
        lastHr: st.lastHr,
        kcal: st.kcal,
        fatKcal: st.fatKcal,
        carbKcal: st.carbKcal,
        hrSum: st.hrSum,
        hrCount: st.hrCount,
        hrMax: st.hrMax,
        countedMs: st.countedMs,
        zoneMs: copyZones(st.zoneMs),
        profile: {
          weightKg: st.profile.weightKg,
          age: st.profile.age,
          sex: st.profile.sex,
          maxHr: st.profile.maxHr,
        },
      };
    },

    /**
     * Loads a snapshot. A running session was away since `savedAt`: that time becomes a pause and the next reading
     * starts a new slice. Returns false (and leaves the session idle) when the snapshot is not usable.
     */
    restore: function (snap, nowMs) {
      if (!snap || snap.v !== 1 || !snap.profile || !snap.zoneMs || snap.zoneMs.length !== 6) return false;
      if (snap.status !== 'running' && snap.status !== 'paused' && snap.status !== 'finished') return false;
      st = blank();
      st.status = snap.status;
      st.startedAt = snap.startedAt;
      st.endedAt = snap.endedAt;
      st.pausedAt = snap.pausedAt;
      st.pausedMs = snap.pausedMs;
      st.lastHr = snap.lastHr;
      st.kcal = snap.kcal;
      st.fatKcal = snap.fatKcal;
      st.carbKcal = snap.carbKcal;
      st.hrSum = snap.hrSum;
      st.hrCount = snap.hrCount;
      st.hrMax = snap.hrMax;
      st.countedMs = snap.countedMs;
      st.zoneMs = copyZones(snap.zoneMs);
      st.profile = {
        weightKg: snap.profile.weightKg,
        age: snap.profile.age,
        sex: snap.profile.sex,
        maxHr: snap.profile.maxHr,
      };
      st.lastSampleAt = null;
      if (st.status === 'running') api.away(snap.savedAt, nowMs);
      return true;
    },
  };
  return api;
}
