/**
 * The profile the math runs on, and which copy of it wins.
 *
 * One storage key (PROFILE_KEY) holds the whole profile as JSON, with `at` (epoch ms of its last change) and `src`
 * ("phone", "watch" or "default"). Precedence, from the P2P contract in README.md:
 *  - a profile received from JoyoFit replaces the stored one only when its `at` is newer than the stored `at`; a watch
 *    that holds none yet (src "default") takes any, including `at` 0, which JoyoFit sends when it has no saved profile;
 *  - an edit on the watch sets `at` to the watch clock and `src` to "watch" (and still wins when the watch clock is
 *    behind: `at` is then one past the stored one);
 *  - nothing saved yet: DEFAULT_AGE and DEFAULT_WEIGHT_KG, the same as LiveWorkout.kt, `at` 0.
 * The maximum heart rate is 220 - age (SubstrateEstimator.maxHeartRate) unless `maxHrOverride` is set. A phone profile
 * whose `maxHr` is not 220 - age keeps that value as the override.
 *
 * Pure: no storage and no clock in here (store.js does the I/O).
 */
import { maxHeartRate } from './fuel.js';

export var PROFILE_KEY = 'fuel.profile';
/** LiveWorkout.DEFAULT_AGE and LiveWorkout.DEFAULT_WEIGHT_KG. */
export var DEFAULT_AGE = 35;
export var DEFAULT_WEIGHT_KG = 70;

export var WEIGHT_MIN = 30;
export var WEIGHT_MAX = 200;
export var AGE_MIN = 10;
export var AGE_MAX = 99;
export var MAX_HR_MIN = 100;
export var MAX_HR_MAX = 230;

export function defaults() {
  return { weightKg: DEFAULT_WEIGHT_KG, age: DEFAULT_AGE, sex: 'unknown', maxHrOverride: null, restHr: null, at: 0, src: 'default' };
}

function isNum(x) {
  return typeof x === 'number' && x === x && x > -Infinity && x < Infinity;
}

function cleanSex(s) {
  return s === 'male' || s === 'female' ? s : 'unknown';
}

function copy(p) {
  return {
    weightKg: p.weightKg,
    age: p.age,
    sex: p.sex,
    maxHrOverride: p.maxHrOverride,
    restHr: p.restHr,
    at: p.at,
    src: p.src,
  };
}

/** The maximum heart rate the math uses. */
export function maxHr(p) {
  return p.maxHrOverride !== null ? p.maxHrOverride : maxHeartRate(p.age);
}

/** What the session accumulator needs, with the maximum resolved. */
export function forSession(p) {
  return { weightKg: p.weightKg, age: p.age, sex: p.sex, maxHr: maxHr(p) };
}

/** A stored value back into a profile; anything unusable gives the defaults, a bad single field its default. */
export function normalize(raw) {
  var d = defaults();
  if (!raw || typeof raw !== 'object') return d;
  var p = copy(d);
  if (isNum(raw.weightKg) && raw.weightKg >= 20 && raw.weightKg <= 300) p.weightKg = raw.weightKg;
  if (isNum(raw.age) && raw.age >= 1 && raw.age <= 120) p.age = Math.round(raw.age);
  p.sex = cleanSex(raw.sex);
  if (isNum(raw.maxHrOverride) && raw.maxHrOverride >= MAX_HR_MIN && raw.maxHrOverride <= MAX_HR_MAX) {
    p.maxHrOverride = Math.round(raw.maxHrOverride);
  }
  if (isNum(raw.restHr) && raw.restHr >= 25 && raw.restHr <= 150) p.restHr = Math.round(raw.restHr);
  if ((raw.src === 'phone' || raw.src === 'watch') && isNum(raw.at) && raw.at >= 0) {
    p.at = raw.at;
    p.src = raw.src;
  }
  return p;
}

export function serialize(p) {
  return JSON.stringify(p);
}

export function parse(text) {
  if (!text) return defaults();
  try {
    return normalize(JSON.parse(text));
  } catch (e) {
    return defaults();
  }
}

/**
 * A `{"v":1,"t":"profile",...}` message from JoyoFit against the stored profile.
 * Returns `{ stored: true, profile }` when it replaced the stored one, `{ stored: false, reason }` when not.
 */
export function fromPhone(current, msg) {
  if (!msg || msg.v !== 1 || msg.t !== 'profile') return { stored: false, reason: 'not a profile message' };
  if (!isNum(msg.at) || msg.at < 0) return { stored: false, reason: 'no time stamp' };
  // JoyoFit sends at 0 when it has no saved profile either: a watch that holds none takes it, any later edit is newer.
  if (current.src !== 'default' && msg.at <= current.at) return { stored: false, reason: 'not newer than the stored profile' };
  if (!isNum(msg.weightKg) || msg.weightKg < 20 || msg.weightKg > 300) return { stored: false, reason: 'weight out of range' };
  if (!isNum(msg.age) || msg.age < 1 || msg.age > 120) return { stored: false, reason: 'age out of range' };
  var age = Math.round(msg.age);
  var p = copy(current);
  p.weightKg = msg.weightKg;
  p.age = age;
  p.sex = cleanSex(msg.sex);
  p.maxHrOverride = null;
  if (isNum(msg.maxHr) && msg.maxHr >= MAX_HR_MIN && msg.maxHr <= MAX_HR_MAX && Math.round(msg.maxHr) !== maxHeartRate(age)) {
    p.maxHrOverride = Math.round(msg.maxHr);
  }
  p.restHr = isNum(msg.restHr) && msg.restHr >= 25 && msg.restHr <= 150 ? Math.round(msg.restHr) : null;
  p.at = msg.at;
  p.src = 'phone';
  return { stored: true, profile: p };
}

/** An edit made on the watch. `changes` has any of weightKg, age, sex, maxHrOverride (null = automatic). */
export function edit(current, changes, nowMs) {
  var p = copy(current);
  if (changes.weightKg !== undefined) p.weightKg = changes.weightKg;
  if (changes.age !== undefined) p.age = changes.age;
  if (changes.sex !== undefined) p.sex = cleanSex(changes.sex);
  if (changes.maxHrOverride !== undefined) p.maxHrOverride = changes.maxHrOverride;
  p.at = nowMs > current.at ? nowMs : current.at + 1;
  p.src = 'watch';
  return normalizeEdited(p);
}

function normalizeEdited(p) {
  var out = normalize(p);
  out.at = p.at;
  out.src = 'watch';
  return out;
}

/** Calendar year (UTC) of an epoch time, without Date. */
export function yearOf(nowMs) {
  var z = Math.floor(nowMs / 86400000) + 719468;
  var era = Math.floor(z / 146097);
  var doe = z - era * 146097;
  var yoe = Math.floor((doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365);
  var doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
  var mp = Math.floor((5 * doy + 2) / 153);
  var month = mp < 10 ? mp + 3 : mp - 9;
  return yoe + era * 400 + (month <= 2 ? 1 : 0);
}

/** ProfileSender.age: this year minus the birth year, never negative. */
export function ageFromBirthYear(birthYear, nowMs) {
  return Math.max(0, yearOf(nowMs) - birthYear);
}

function weightText(kg) {
  return Math.round(kg) === kg ? '' + kg : (Math.round(kg * 10) / 10).toFixed(1);
}

/** "72.5 kg, 34 y, male, max 186" for the home page. */
export function describe(p) {
  var sex = p.sex === 'unknown' ? 'sex not set' : p.sex;
  return weightText(p.weightKg) + ' kg, ' + p.age + ' y, ' + sex + ', max ' + maxHr(p);
}

/** Where the profile came from, for the home page. */
export function sourceText(p) {
  if (p.src === 'phone') return 'from JoyoFit';
  if (p.src === 'watch') return 'set on the watch';
  return 'defaults, not set yet';
}
