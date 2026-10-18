import { describe, expect, it } from 'bun:test';

import { buildFit, type StravaPoint, type StravaWorkout } from './activityFile';
import { FIT_MANUFACTURER_DEVELOPMENT, FIT_MANUFACTURER_HUAWEI, modelName, productId, softwareVersionOf, stravaDevice } from './device';
import { HUAWEI_HEALTH_DESCRIPTION, HUAWEI_HEALTH_FIT } from './huaweiHealth.fixture';
import { FIT_EPOCH_OFFSET } from './fitEncoder';
import { decodeFit } from './testDecode';

describe('modelName', () => {
  it('drops the unit suffix of the Bluetooth name and nothing else', () => {
    expect(modelName('HUAWEI WATCH FIT 4 Pro-40A')).toBe('HUAWEI WATCH FIT 4 Pro');
    expect(modelName('HONOR Band 9-123')).toBe('HONOR Band 9');
    expect(modelName('HUAWEI WATCH GT 3-26B ')).toBe('HUAWEI WATCH GT 3');
    expect(modelName('HUAWEI WATCH FIT 4 Pro')).toBe('HUAWEI WATCH FIT 4 Pro');
    expect(modelName('HUAWEI WATCH FIT 2-xyz1')).toBe('HUAWEI WATCH FIT 2');
  });
});

describe('productId', () => {
  it('is stable, case-insensitive, never FIT\'s "none", and differs between models', () => {
    const fit4 = productId('HUAWEI WATCH FIT 4');
    expect(productId('huawei watch fit 4')).toBe(fit4);
    expect(productId('HUAWEI WATCH FIT 4 Pro')).not.toBe(fit4);
    for (const name of ['a', 'HUAWEI WATCH GT 5', 'HUAWEI WATCH FIT 2', 'HONOR Band 9']) {
      const id = productId(name);
      expect(id).toBeGreaterThanOrEqual(1);
      expect(id).toBeLessThanOrEqual(65_534);
    }
  });
});

describe('softwareVersionOf', () => {
  it('keeps major.minor in hundredths', () => {
    expect(softwareVersionOf('5.1.0.222')).toBe(501);
    expect(softwareVersionOf('4.0')).toBe(400);
    expect(softwareVersionOf('12')).toBe(1200);
    expect(softwareVersionOf('abc')).toBeNull();
    expect(softwareVersionOf(null)).toBeNull();
  });
});

describe('stravaDevice', () => {
  it('writes a Huawei watch as Huawei', () => {
    const device = stravaDevice({ name: 'HUAWEI WATCH FIT 4 Pro-40A', softwareVersion: '5.1.0.222' });
    expect(device).toEqual({ name: 'HUAWEI WATCH FIT 4 Pro', manufacturer: FIT_MANUFACTURER_HUAWEI, product: productId('HUAWEI WATCH FIT 4 Pro'), softwareVersion: 501 });
  });

  it('never puts another brand on a watch: Honor and unknown names stay development', () => {
    expect(stravaDevice({ name: 'HONOR Band 9-123', softwareVersion: null })?.manufacturer).toBe(FIT_MANUFACTURER_DEVELOPMENT);
    expect(stravaDevice({ name: 'Some Watch', softwareVersion: null })?.manufacturer).toBe(FIT_MANUFACTURER_DEVELOPMENT);
  });

  it('has no device without a name', () => {
    expect(stravaDevice(null)).toBeNull();
    expect(stravaDevice({ name: '  -40A', softwareVersion: null })).toBeNull();
  });
});

/** The owner's 2026-10-14 walk as Huawei Health uploaded it (see the fixture), rebuilt from its totals. */
const START = HUAWEI_HEALTH_FIT.session.startTime + FIT_EPOCH_OFFSET;
const walk: StravaWorkout = {
  start: START,
  end: START + HUAWEI_HEALTH_FIT.session.totalElapsedTime,
  sportType: 2,
  sportName: 'Walking',
  duration: HUAWEI_HEALTH_FIT.session.totalElapsedTime,
  distance: HUAWEI_HEALTH_FIT.session.totalDistance,
  calories: HUAWEI_HEALTH_FIT.session.totalCalories,
  avgHr: HUAWEI_HEALTH_FIT.session.avgHeartRate,
  maxHr: 120,
};
const points: StravaPoint[] = [{ ts: START + 30, lat: null, lon: null, alt: null, hr: 98 }];

function decoded(device: ReturnType<typeof stravaDevice>) {
  const result = decodeFit(buildFit(walk, points, { utcOffsetSeconds: 7 * 3600, device }).bytes);
  expect(result.errors).toEqual([]);
  expect(result.integrity).toBe(true);
  return result.messages;
}

describe('device fields against Huawei Health\'s own upload', () => {
  const watch = stravaDevice({ name: 'HUAWEI WATCH FIT 4 Pro-40A', softwareVersion: '5.1.0.222' });

  it('names the same watch Huawei Health puts in its activity description', () => {
    expect(HUAWEI_HEALTH_DESCRIPTION.endsWith(` ${watch?.name}`)).toBe(true);
  });

  it('agrees with Huawei Health on the shared fields', () => {
    const { fileIdMesgs, sessionMesgs, activityMesgs } = decoded(watch);
    const huawei = HUAWEI_HEALTH_FIT;
    expect(fileIdMesgs?.[0]?.type).toBe(huawei.fileId.type);
    const session = sessionMesgs?.[0];
    expect(session?.sport).toBe(huawei.session.sport);
    expect(session?.startTime).toBe(huawei.session.startTime);
    expect(session?.totalElapsedTime).toBe(huawei.session.totalElapsedTime);
    expect(session?.totalDistance).toBe(huawei.session.totalDistance);
    expect(session?.totalCalories).toBe(huawei.session.totalCalories);
    expect(session?.avgHeartRate).toBe(huawei.session.avgHeartRate);
    // local_timestamp = timestamp + the wearer's UTC offset, as in Huawei's file.
    const activity = activityMesgs?.[0];
    expect(Number(activity?.localTimestamp) - Number(activity?.timestamp)).toBe(huawei.activity.localTimestamp - huawei.activity.timestamp);
  });

  it('without a known watch the file is as anonymous as Huawei Health\'s: development manufacturer, product 1, no brand borrowed', () => {
    const { fileIdMesgs } = decoded(null);
    expect(fileIdMesgs?.[0]?.manufacturer).toBe(HUAWEI_HEALTH_FIT.fileId.manufacturer);
    expect(fileIdMesgs?.[0]?.product).toBe(HUAWEI_HEALTH_FIT.fileId.product);
  });

  it('adds what Huawei Health leaves out: the watch as file_id and creator device_info, JoyoFit as the writing software', () => {
    const { fileIdMesgs, deviceInfoMesgs } = decoded(watch);
    expect(fileIdMesgs?.[0]).toMatchObject({ manufacturer: FIT_MANUFACTURER_HUAWEI, product: watch?.product, productName: 'HUAWEI WATCH FIT 4 Pro' });
    expect(deviceInfoMesgs).toHaveLength(2);
    expect(deviceInfoMesgs?.[0]).toMatchObject({
      deviceIndex: 0,
      manufacturer: FIT_MANUFACTURER_HUAWEI,
      product: watch?.product,
      productName: 'HUAWEI WATCH FIT 4 Pro',
      softwareVersion: 5.01,
      sourceType: 6,
    });
    expect(deviceInfoMesgs?.[1]).toMatchObject({ deviceIndex: 1, manufacturer: FIT_MANUFACTURER_DEVELOPMENT, productName: 'JoyoFit' });
  });
});
