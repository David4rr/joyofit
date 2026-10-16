/**
 * The file JoyoFit sends to Strava for one workout: a TCX built from the `workouts` row and its `workout_points`.
 *
 * Strava keeps the numbers a file carries, so the file carries the watch's: every sample of the workout from its start
 * to its end (GPS fixes and heart-rate-only samples, so the elapsed time is the whole workout, not just the GPS part),
 * a cumulative distance on every sample, scaled so the last one is exactly the watch's distance (raw GPS distance
 * drifts), and the watch's calories on the lap. Pure functions, no React Native imports, so they run under `bun test`.
 */

export interface StravaWorkout {
  /** Unix seconds. */
  start: number;
  end: number;
  /** The raw Huawei sport type byte. */
  sportType: number;
  sportName: string;
  /** Active seconds. */
  duration: number;
  /** Metres. */
  distance: number;
  calories: number;
  avgHr: number | null;
  maxHr: number | null;
}

export interface StravaPoint {
  ts: number;
  lat: number | null;
  lon: number | null;
  alt: number | null;
  hr: number | null;
}

export interface StravaSport {
  /** Strava's `sport_type` upload parameter. */
  sportType: string;
  /** Marks a treadmill or bike-trainer session. */
  trainer: boolean;
}

/** Huawei sport type byte (see `WorkoutSportTypes.kt`) -> Strava `sport_type`. Everything not listed is `Workout`. */
const SPORTS: Readonly<Record<number, StravaSport>> = {
  1: { sportType: 'Run', trainer: false },
  2: { sportType: 'Walk', trainer: false },
  3: { sportType: 'Ride', trainer: false },
  4: { sportType: 'Hike', trainer: false },
  5: { sportType: 'Run', trainer: true },
  6: { sportType: 'Swim', trainer: false },
  7: { sportType: 'Ride', trainer: true },
  8: { sportType: 'Swim', trainer: false },
  11: { sportType: 'TrailRun', trainer: false },
  13: { sportType: 'Walk', trainer: true },
  14: { sportType: 'Hike', trainer: false },
  128: { sportType: 'TableTennis', trainer: false },
  129: { sportType: 'Badminton', trainer: false },
  130: { sportType: 'Tennis', trainer: false },
  131: { sportType: 'Soccer', trainer: false },
  134: { sportType: 'Elliptical', trainer: false },
  135: { sportType: 'Rowing', trainer: false },
  136: { sportType: 'StairStepper', trainer: false },
  137: { sportType: 'Yoga', trainer: false },
  138: { sportType: 'Pilates', trainer: false },
  140: { sportType: 'WeightTraining', trainer: false },
  141: { sportType: 'Ride', trainer: true },
  143: { sportType: 'HighIntensityIntervalTraining', trainer: false },
  145: { sportType: 'Crossfit', trainer: false },
  163: { sportType: 'InlineSkate', trainer: false },
  177: { sportType: 'StairStepper', trainer: false },
  191: { sportType: 'Squash', trainer: false },
  194: { sportType: 'Sail', trainer: false },
  195: { sportType: 'Surfing', trainer: false },
  199: { sportType: 'Canoeing', trainer: false },
  200: { sportType: 'Rowing', trainer: false },
  202: { sportType: 'StandUpPaddling', trainer: false },
  203: { sportType: 'IceSkate', trainer: false },
  209: { sportType: 'Skateboard', trainer: false },
  210: { sportType: 'RockClimbing', trainer: false },
};

export function stravaSport(huaweiSportType: number): StravaSport {
  return SPORTS[huaweiSportType] ?? { sportType: 'Workout', trainer: false };
}

/** Stable per workout (its start is unique), so Strava refuses a second upload of the same workout as a duplicate. */
export function externalId(start: number): string {
  return `joyofit-${start}`;
}

/** TCX only knows three sports; Strava takes the real one from the `sport_type` upload field. */
function tcxSport(sportType: string): string {
  if (sportType === 'Run' || sportType === 'TrailRun') return 'Running';
  if (sportType === 'Ride') return 'Biking';
  return 'Other';
}

interface Sample {
  ts: number;
  lat: number | null;
  lon: number | null;
  alt: number | null;
  hr: number | null;
  /** Cumulative metres, filled in by `withDistance`. */
  distance: number;
}

const EARTH_RADIUS_M = 6_371_000;

function haversine(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const rad = Math.PI / 180;
  const dLat = (bLat - aLat) * rad;
  const dLon = (bLon - aLon) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(aLat * rad) * Math.cos(bLat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

function validFix(lat: number | null, lon: number | null): lat is number {
  return lat !== null && lon !== null && Math.abs(lat) <= 90 && Math.abs(lon) <= 180 && !(lat === 0 && lon === 0);
}

/**
 * One sample per second at most, in time order, inside `[start, end]`, with a sample exactly at `start` and at `end` so
 * Strava's elapsed time is the watch's. Several points of one second merge: a fix, an altitude or a heart rate
 * from any of them wins over a missing value.
 */
function collectSamples(workout: StravaWorkout, points: readonly StravaPoint[]): Sample[] {
  const end = Math.max(workout.end, workout.start);
  const bySecond = new Map<number, Sample>();
  const at = (ts: number): Sample => {
    let sample = bySecond.get(ts);
    if (!sample) {
      sample = { ts, lat: null, lon: null, alt: null, hr: null, distance: 0 };
      bySecond.set(ts, sample);
    }
    return sample;
  };
  for (const p of points) {
    if (p.ts < workout.start || p.ts > end) continue;
    const sample = at(Math.round(p.ts));
    if (validFix(p.lat, p.lon) && p.lon !== null) {
      sample.lat = p.lat;
      sample.lon = p.lon;
    }
    if (p.alt !== null && Number.isFinite(p.alt)) sample.alt = p.alt;
    if (p.hr !== null && p.hr > 0 && p.hr < 256) sample.hr = Math.round(p.hr);
  }
  at(workout.start);
  at(end);
  return [...bySecond.values()].sort((a, b) => a.ts - b.ts);
}

/**
 * Fills `distance` on every sample: GPS samples get the haversine path length scaled so the last fix is at the watch's
 * total; samples between fixes interpolate in time, before the first fix is 0 and after the last the total. Without any
 * fix (treadmill, pool) the distance grows linearly over the whole workout.
 */
function withDistance(samples: Sample[], total: number): void {
  if (!(total > 0)) return;
  const fixes: number[] = [];
  samples.forEach((s, i) => {
    if (s.lat !== null) fixes.push(i);
  });
  const first = samples[0];
  const last = samples[samples.length - 1];
  if (fixes.length < 2 || !first || !last) {
    const span = last && first ? last.ts - first.ts : 0;
    for (const s of samples) s.distance = span > 0 ? (total * (s.ts - (first?.ts ?? 0))) / span : 0;
    if (last) last.distance = total;
    return;
  }
  const cumulative: number[] = [0];
  for (let k = 1; k < fixes.length; k++) {
    const a = samples[fixes[k - 1] as number] as Sample;
    const b = samples[fixes[k] as number] as Sample;
    cumulative.push((cumulative[k - 1] as number) + haversine(a.lat as number, a.lon as number, b.lat as number, b.lon as number));
  }
  const gpsTotal = cumulative[cumulative.length - 1] as number;
  if (!(gpsTotal > 0)) {
    // All fixes on one spot: no path to scale, so fall back to time.
    for (const s of samples) s.distance = (total * (s.ts - first.ts)) / Math.max(1, last.ts - first.ts);
    last.distance = total;
    return;
  }
  const scale = total / gpsTotal;
  fixes.forEach((index, k) => {
    (samples[index] as Sample).distance = (cumulative[k] as number) * scale;
  });
  const firstFix = fixes[0] as number;
  const lastFix = fixes[fixes.length - 1] as number;
  for (let i = 0; i < firstFix; i++) (samples[i] as Sample).distance = 0;
  for (let i = lastFix + 1; i < samples.length; i++) (samples[i] as Sample).distance = total;
  for (let k = 1; k < fixes.length; k++) {
    const a = samples[fixes[k - 1] as number] as Sample;
    const b = samples[fixes[k] as number] as Sample;
    for (let i = (fixes[k - 1] as number) + 1; i < (fixes[k] as number); i++) {
      const s = samples[i] as Sample;
      s.distance = b.ts === a.ts ? a.distance : a.distance + ((b.distance - a.distance) * (s.ts - a.ts)) / (b.ts - a.ts);
    }
  }
}

const iso = (seconds: number) => new Date(seconds * 1000).toISOString();

export interface BuiltTcx {
  xml: string;
  /** Trackpoints written. */
  samples: number;
}

export function buildTcx(workout: StravaWorkout, points: readonly StravaPoint[]): BuiltTcx {
  const samples = collectSamples(workout, points);
  const total = workout.distance > 0 ? workout.distance : 0;
  withDistance(samples, total);
  const sport = stravaSport(workout.sportType);
  const last = samples[samples.length - 1];
  const elapsed = (last?.ts ?? workout.start) - workout.start;

  const trackpoints = samples.map((s) => {
    let xml = `<Trackpoint><Time>${iso(s.ts)}</Time>`;
    if (s.lat !== null && s.lon !== null) {
      xml += `<Position><LatitudeDegrees>${s.lat}</LatitudeDegrees><LongitudeDegrees>${s.lon}</LongitudeDegrees></Position>`;
    }
    if (s.alt !== null) xml += `<AltitudeMeters>${s.alt.toFixed(1)}</AltitudeMeters>`;
    if (total > 0) xml += `<DistanceMeters>${s.distance.toFixed(2)}</DistanceMeters>`;
    if (s.hr !== null) xml += `<HeartRateBpm><Value>${s.hr}</Value></HeartRateBpm>`;
    return `${xml}</Trackpoint>`;
  });

  // `Calories` is an unsigned short in the schema.
  const calories = Math.min(65_535, Math.max(0, Math.round(workout.calories)));
  const lap = [
    `<Lap StartTime="${iso(workout.start)}">`,
    `<TotalTimeSeconds>${elapsed}</TotalTimeSeconds>`,
    `<DistanceMeters>${total.toFixed(2)}</DistanceMeters>`,
    `<Calories>${calories}</Calories>`,
    workout.avgHr && workout.avgHr > 0 ? `<AverageHeartRateBpm><Value>${Math.round(workout.avgHr)}</Value></AverageHeartRateBpm>` : '',
    workout.maxHr && workout.maxHr > 0 ? `<MaximumHeartRateBpm><Value>${Math.round(workout.maxHr)}</Value></MaximumHeartRateBpm>` : '',
    '<Intensity>Active</Intensity><TriggerMethod>Manual</TriggerMethod>',
    `<Track>${trackpoints.join('')}</Track>`,
    '</Lap>',
  ].join('');

  const xml =
    '<?xml version="1.0" encoding="UTF-8"?>' +
    '<TrainingCenterDatabase xmlns="http://www.garmin.com/xmlschemas/TrainingCenterDatabase/v2">' +
    `<Activities><Activity Sport="${tcxSport(sport.sportType)}"><Id>${iso(workout.start)}</Id>${lap}` +
    '<Creator xsi:type="Device_t" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><Name>JoyoFit</Name></Creator>' +
    '</Activity></Activities></TrainingCenterDatabase>';
  return { xml, samples: samples.length };
}

/** The activity a Strava "duplicate of activity N" message points at (a repeated `external_id`), or null. */
export function duplicateOf(message: string | null): number | null {
  const match = message ? /duplicate of activity (\d+)/i.exec(message) : null;
  return match ? Number(match[1]) : null;
}

/** The activity description when the user opted in; plain text, never part of the title. */
export const DESCRIPTION_LINK = 'fit.joyorogo.com';

export interface UploadForm {
  /** Value of the `Content-Type` header, boundary included. */
  contentType: string;
  body: string;
}

/**
 * The multipart body of `POST /api/v3/uploads` as one string. React Native's FormData can only send files from disk
 * (`{ uri }`), and the file here exists only in memory, so the body is assembled by hand and sent with fetch.
 */
export function buildUploadForm(workout: StravaWorkout, tcx: string, options: { addLink: boolean }): UploadForm {
  const sport = stravaSport(workout.sportType);
  const boundary = `----joyofit${workout.start.toString(36)}${Math.abs(tcx.length).toString(36)}`;
  const fields: Record<string, string> = {
    data_type: 'tcx',
    name: workout.sportName,
    external_id: externalId(workout.start),
    sport_type: sport.sportType,
    ...(sport.trainer ? { trainer: '1' } : {}),
    ...(options.addLink ? { description: DESCRIPTION_LINK } : {}),
  };
  let body = '';
  for (const [name, value] of Object.entries(fields)) {
    body += `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`;
  }
  body +=
    `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${externalId(workout.start)}.tcx"\r\n` +
    `Content-Type: application/xml\r\n\r\n${tcx}\r\n--${boundary}--\r\n`;
  return { contentType: `multipart/form-data; boundary=${boundary}`, body };
}
