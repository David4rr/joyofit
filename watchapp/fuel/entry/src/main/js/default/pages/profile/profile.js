import router from '@system.router';
import {
  AGE_MAX,
  AGE_MIN,
  MAX_HR_MAX,
  MAX_HR_MIN,
  WEIGHT_MAX,
  WEIGHT_MIN,
  ageFromBirthYear,
  defaults,
  edit,
  maxHr,
  yearOf,
} from '../../common/profile.js';
import { loadProfile, saveProfile } from '../../common/store.js';
import { maxHeartRate } from '../../common/fuel.js';

var SEX_VALUES = ['male', 'female', 'unknown'];
var SEX_NAMES = ['Male', 'Female', 'Not set'];
/** The birth-year picker needs a sane clock; a watch that thinks it is 1970 gets no picker. */
var MIN_SANE_YEAR = 2020;

var profile = defaults();
var pickValue = '';
var pickIndex = 0;

function numberRange(from, to) {
  var out = [];
  for (var n = from; n <= to; n++) out.push('' + n);
  return out;
}

function indexOfValue(range, value) {
  for (var i = 0; i < range.length; i++) if (range[i] === value) return i;
  return 0;
}

function nearestIndex(from, to, value) {
  var v = Math.round(value);
  if (v < from) v = from;
  if (v > to) v = to;
  return v - from;
}

export default {
  data: {
    editing: '',
    editTitle: '',
    weightText: '',
    ageText: '',
    bornText: '',
    sexText: '',
    maxHrText: '',
    pickSelected: '0',
    weightRange: [],
    ageRange: [],
    bornRange: [],
    sexRange: [],
    maxHrRange: [],
  },

  onInit() {
    var page = this;
    profile = defaults();
    page.show();
    loadProfile(function (p) {
      profile = p;
      page.show();
    });
  },

  show() {
    var year = yearOf(Date.now());
    var kg = profile.weightKg;
    this.weightText = (Math.round(kg) === kg ? '' + kg : (Math.round(kg * 10) / 10).toFixed(1)) + ' kg';
    this.ageText = '' + profile.age;
    this.bornText = year >= MIN_SANE_YEAR ? '' + (year - profile.age) : '--';
    this.sexText = SEX_NAMES[indexOfValue(SEX_VALUES, profile.sex)];
    this.maxHrText = maxHr(profile) + (profile.maxHrOverride === null ? ' auto' : '');
  },

  open(field, title, selectedIndex, value) {
    pickIndex = selectedIndex;
    pickValue = value;
    this.pickSelected = '' + selectedIndex;
    this.editTitle = title;
    this.editing = field;
  },

  editWeight() {
    this.weightRange = numberRange(WEIGHT_MIN, WEIGHT_MAX);
    var i = nearestIndex(WEIGHT_MIN, WEIGHT_MAX, profile.weightKg);
    this.open('weight', 'Weight, kg', i, this.weightRange[i]);
  },

  editAge() {
    this.ageRange = numberRange(AGE_MIN, AGE_MAX);
    var i = nearestIndex(AGE_MIN, AGE_MAX, profile.age);
    this.open('age', 'Age', i, this.ageRange[i]);
  },

  editBorn() {
    var year = yearOf(Date.now());
    if (year < MIN_SANE_YEAR) return;
    var from = year - AGE_MAX;
    var to = year - AGE_MIN;
    this.bornRange = numberRange(from, to);
    var i = nearestIndex(from, to, year - profile.age);
    this.open('born', 'Birth year', i, this.bornRange[i]);
  },

  editSex() {
    this.sexRange = SEX_NAMES.slice(0);
    var i = indexOfValue(SEX_VALUES, profile.sex);
    this.open('sex', 'Sex', i, this.sexRange[i]);
  },

  editMaxHr() {
    var range = ['Auto, ' + maxHeartRate(profile.age)];
    for (var n = MAX_HR_MIN; n <= MAX_HR_MAX; n++) range.push('' + n);
    this.maxHrRange = range;
    var i = profile.maxHrOverride === null ? 0 : nearestIndex(MAX_HR_MIN, MAX_HR_MAX, profile.maxHrOverride) + 1;
    this.open('maxHr', 'Max heart rate', i, range[i]);
  },

  onPick(e) {
    pickValue = e.newValue;
    pickIndex = Number(e.newSelected);
  },

  cancel() {
    this.editing = '';
    this.clearRanges();
  },

  save() {
    var field = this.editing;
    var changes = {};
    if (field === 'weight') changes.weightKg = Number(pickValue);
    else if (field === 'age') changes.age = Number(pickValue);
    else if (field === 'born') changes.age = Math.max(AGE_MIN, ageFromBirthYear(Number(pickValue), Date.now()));
    else if (field === 'sex') changes.sex = SEX_VALUES[pickIndex];
    else if (field === 'maxHr') changes.maxHrOverride = pickIndex === 0 ? null : Number(pickValue);
    profile = edit(profile, changes, Date.now());
    saveProfile(profile);
    this.editing = '';
    this.clearRanges();
    this.show();
  },

  clearRanges() {
    this.weightRange = [];
    this.ageRange = [];
    this.bornRange = [];
    this.sexRange = [];
    this.maxHrRange = [];
  },

  back() {
    router.replace({ uri: 'pages/index/index' });
  },
};
