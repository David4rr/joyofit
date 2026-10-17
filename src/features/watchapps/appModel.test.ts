import { describe, expect, test } from 'bun:test';

import type { FuelLinkStatus, WatchAppDeviceParams, WatchAppList } from '@/wear';
import { FUEL_PACKAGE, findFuel, fuelReach, groupFingerprint, installPercent, installStageText, paramsLine } from './appModel';

const params: WatchAppDeviceParams = {
  type: 38,
  typeName: 'liteWearable',
  osApiLevel: 7,
  osVersion: '6.1.0',
  screenShape: 'rect',
  width: 408,
  height: 480,
  buildLevel: 2,
  buildType: 'debug',
};

const link = (pingCode: number | null): FuelLinkStatus => ({
  available: true,
  registered: true,
  pingCode,
  reachable: pingCode === null ? null : pingCode === 0xca,
  phonePackage: 'com.joyodigitama.joyofit',
  watchPackage: FUEL_PACKAGE,
  phoneFingerprint: 'AB'.repeat(32),
  watchFingerprint: '',
  lastHelloAt: null,
  lastHelloVersion: null,
  lastHelloProfileAt: null,
  lastProfileSentAt: null,
  lastAckAt: null,
  lastAckProfileAt: null,
  profile: { weightKg: 70, age: 35, sex: 'unknown', maxHr: 185, restHr: null, at: 0 },
});

describe('paramsLine', () => {
  test('names the runtime, API level, OS, screen and build', () => {
    expect(paramsLine(params)).toBe('Lite Wearable, API 7, OS 6.1.0, 408x480 rect, debug');
  });

  test('leaves out what the watch did not send', () => {
    expect(paramsLine({ ...params, typeName: null, type: 12, osVersion: '', width: 0, height: 0, buildType: '' })).toBe('app type 12, API 7');
  });

  test('is null without parameters', () => {
    expect(paramsLine(null)).toBeNull();
  });
});

describe('findFuel', () => {
  const list: WatchAppList = {
    params: null,
    updatedAt: 0,
    apps: [
      { packageName: 'com.other', name: 'Other', version: '1', versionCode: 1, size: 0, packageType: 1 },
      { packageName: FUEL_PACKAGE, name: 'Fuel', version: '1.0.0', versionCode: 1, size: 0, packageType: 1 },
    ],
  };

  test('finds the app by package name', () => {
    expect(findFuel(list)?.version).toBe('1.0.0');
  });

  test('is null when it is not there or the list is unknown', () => {
    expect(findFuel({ ...list, apps: [] })).toBeNull();
    expect(findFuel(null)).toBeNull();
  });
});

describe('groupFingerprint', () => {
  test('groups of eight, no trailing space', () => {
    expect(groupFingerprint('ABCDEFGH12345678IJ')).toBe('ABCDEFGH 12345678 IJ');
    expect(groupFingerprint('ABCDEFGH')).toBe('ABCDEFGH');
    expect(groupFingerprint('')).toBe('');
  });
});

describe('fuelReach', () => {
  test('0xca is reachable, any other answer is silent, none is unknown', () => {
    expect(fuelReach(link(0xca))).toBe('reachable');
    expect(fuelReach(link(0xcb))).toBe('silent');
    expect(fuelReach(link(null))).toBe('unknown');
    expect(fuelReach(null)).toBe('unknown');
  });
});

describe('install progress', () => {
  test('the transfer fills the first half, the watch percentage the second', () => {
    expect(installPercent(null, null)).toBe(0);
    expect(installPercent({ bytes: 500, total: 1000 }, null)).toBe(25);
    expect(installPercent({ bytes: 1000, total: 1000 }, null)).toBe(50);
    expect(installPercent(null, { status: 50, packageName: FUEL_PACKAGE, phase: 'progress' })).toBe(75);
    expect(installPercent(null, { status: 101, packageName: FUEL_PACKAGE, phase: 'installStarted' })).toBe(50);
    expect(installPercent(null, { status: 102, packageName: FUEL_PACKAGE, phase: 'installed' })).toBe(100);
  });

  test('the text follows the latest report, else the bytes', () => {
    expect(installStageText(null, null)).toBe('Waiting for the watch to accept the file');
    expect(installStageText({ bytes: 250, total: 1000 }, null)).toContain('25%');
    expect(installStageText({ bytes: 250, total: 1000 }, { status: 40, packageName: '', phase: 'progress' })).toBe('The watch is installing the app: 40%');
    expect(installStageText(null, { status: 103, packageName: '', phase: 'installFailed' })).toBe('The watch refused the app');
  });
});
