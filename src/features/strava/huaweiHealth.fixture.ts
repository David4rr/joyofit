/**
 * Test-only: what Huawei Health's own upload to Strava looked like, for the owner's walk on 2026-10-14 06:13 WIB
 * (Strava activity 20575074754, "Outdoor walk", Huawei Watch Fit 4 Pro), read from `Export Original` with Garmin's FIT SDK
 * (raw values, nothing scaled). Only the totals and the field layout are kept: the route is a home address.
 *
 * What it shows (decoded 2026-10-18):
 * - `file_id` has manufacturer 255 (development), product 1 and no product name; there is no `device_info`, `lap`, `event`
 *   or `session.total_timer_time` at all. Strava therefore shows no device line for it. The watch's name only appears as the
 *   last words of the activity description Huawei Health writes, `HUAWEI_HEALTH_DESCRIPTION`.
 * - `session` is sport 11 (walking), sub_sport 30 (casual walking).
 * - `activity.local_timestamp` is the UTC timestamp plus the wearer's 7 h offset.
 */

export const HUAWEI_HEALTH_DESCRIPTION = 'Walk 2026-10-14 06:13:07 HUAWEI WATCH FIT 4 Pro';

export const HUAWEI_HEALTH_FIT = {
  messageKinds: ['fileIdMesgs', 'activityMesgs', 'sessionMesgs', 'recordMesgs'],
  fileId: { type: 4, manufacturer: 255, product: 1, timeCreated: 1160869353 },
  session: {
    sport: 11,
    subSport: 30,
    totalElapsedTime: 1753,
    totalDistance: 1540,
    totalCalories: 141,
    startTime: 1160867587,
    avgSpeed: 0.878,
    maxSpeed: 0.89,
    avgHeartRate: 98,
  },
  activity: { timestamp: 1160869353, localTimestamp: 1160894553 },
  /** Record fields present (of 2100 records; positions on 1748, heart rate on 349, cadence on 350). */
  recordFields: ['altitude', 'cadence', 'enhancedAltitude', 'enhancedSpeed', 'heartRate', 'positionLat', 'positionLong', 'speed', 'timestamp'],
} as const;
