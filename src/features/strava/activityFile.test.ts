import { describe, expect, it } from 'bun:test';

import {
  buildFit,
  buildUploadForm,
  DESCRIPTION_LINK,
  duplicateOf,
  externalId,
  stravaSport,
  type StravaPoint,
  type StravaWorkout,
} from './activityFile';
import { FIT_EPOCH_OFFSET, toSemicircles } from './fitEncoder';
import { decodeFit } from './testDecode';

const START = 1_792_058_016;
const FIT_START = START - FIT_EPOCH_OFFSET;

const walk: StravaWorkout = {
  start: START,
  end: START + 600,
  sportType: 2,
  sportName: 'Walking',
  duration: 540,
  distance: 500,
  calories: 38,
  avgHr: 101,
  maxHr: 120,
  steps: 900,
  elevationGain: 12,
  elevationLoss: 9,
  maxSpeed: 1.8,
};

/** About 111 m per 0.001 degree of latitude: three fixes make roughly 222 m of GPS path, the watch says 500 m. */
const fix = (offset: number, lat: number, hr: number | null = null): StravaPoint => ({ ts: START + offset, lat, lon: 106.8, alt: 10, hr });
const hrOnly = (offset: number, hr: number): StravaPoint => ({ ts: START + offset, lat: null, lon: null, alt: null, hr });

/** Builds, decodes with Garmin's SDK and insists on an intact file. */
function roundTrip(workout: StravaWorkout, points: readonly StravaPoint[]) {
  const built = buildFit(workout, points, { utcOffsetSeconds: 7 * 3600 });
  const decoded = decodeFit(built.bytes);
  expect(decoded.errors).toEqual([]);
  expect(decoded.integrity).toBe(true);
  const { messages } = decoded;
  return {
    built,
    records: messages.recordMesgs ?? [],
    session: messages.sessionMesgs?.[0],
    lap: messages.lapMesgs?.[0],
    activity: messages.activityMesgs?.[0],
    events: messages.eventMesgs ?? [],
    fileId: messages.fileIdMesgs?.[0],
    messages,
  };
}

const offsets = (records: { timestamp?: number }[]) => records.map((r) => (r.timestamp ?? NaN) - FIT_START);
const distances = (records: { distance?: number }[]) => records.map((r) => r.distance);

describe('buildFit distance', () => {
  const points = [fix(100, 10), fix(200, 10.001), fix(300, 10.002), hrOnly(150, 99), hrOnly(250, 105)];

  it('scales the GPS path so the last record and the session are exactly the watch distance', () => {
    const { records, session, lap } = roundTrip(walk, points);
    expect(records[records.length - 1]?.distance).toBe(500);
    expect(session?.totalDistance).toBe(500);
    expect(lap?.totalDistance).toBe(500);
  });

  it('is cumulative and never decreases, with HR-only samples interpolated between fixes', () => {
    const { records } = roundTrip(walk, points);
    const d = distances(records) as number[];
    for (let i = 1; i < d.length; i++) expect(d[i]).toBeGreaterThanOrEqual(d[i - 1] ?? 0);
    const at = (offset: number) => d[offsets(records).indexOf(offset)] ?? Number.NaN;
    expect(at(0)).toBe(0);
    expect(at(100)).toBe(0);
    expect(at(200)).toBeCloseTo(250, 0);
    expect(at(150)).toBeCloseTo(125, 0);
    expect(at(300)).toBe(500);
    expect(at(600)).toBe(500);
  });

  it('grows linearly over the whole workout when there is no GPS', () => {
    const { records } = roundTrip({ ...walk, sportType: 5 }, [hrOnly(0, 90), hrOnly(300, 100), hrOnly(600, 110)]);
    expect(distances(records)).toEqual([0, 250, 500]);
    expect(records.some((r) => r.positionLat !== undefined)).toBe(false);
  });

  it('writes no distance at all for a workout without one', () => {
    const { records, session } = roundTrip({ ...walk, distance: 0, sportType: 137 }, [hrOnly(0, 80), hrOnly(60, 85)]);
    expect(records.every((r) => r.distance === undefined)).toBe(true);
    expect(session?.totalDistance).toBeUndefined();
    expect(session?.avgSpeed).toBeUndefined();
  });
});

describe('buildFit records', () => {
  it('covers start to end even when GPS only exists in the middle', () => {
    const { records, events } = roundTrip(walk, [fix(100, 10), fix(200, 10.001), hrOnly(10, 88), hrOnly(550, 95)]);
    const times = offsets(records);
    expect(times[0]).toBe(0);
    expect(times[times.length - 1]).toBe(600);
    expect(times).toEqual([...times].sort((a, b) => a - b));
    expect(new Set(times).size).toBe(times.length);
    expect(events.map((e) => [e.eventType, (e.timestamp ?? 0) - FIT_START])).toEqual([
      [0, 0],
      [4, 600],
    ]);
  });

  it('keeps HR-only samples and merges samples of the same second', () => {
    const { built, records } = roundTrip(walk, [hrOnly(30, 90), fix(30, 10), hrOnly(60, 100)]);
    // start, 30 (merged), 60, end
    expect(built.samples).toBe(4);
    expect(records.length).toBe(4);
    expect(records.filter((r) => r.positionLat !== undefined).length).toBe(1);
    expect(records.flatMap((r) => (r.heartRate === undefined ? [] : [r.heartRate]))).toEqual([90, 100]);
  });

  it('drops points outside the workout and invalid fixes', () => {
    const points = [hrOnly(-5, 70), hrOnly(700, 70), { ts: START + 20, lat: 0, lon: 0, alt: null, hr: null }, { ts: START + 40, lat: 95, lon: 10, alt: null, hr: 0 }];
    const { built, records } = roundTrip(walk, points);
    expect(built.samples).toBe(4);
    expect(records.some((r) => r.positionLat !== undefined)).toBe(false);
    expect(records.some((r) => r.heartRate !== undefined)).toBe(false);
  });

  it('writes positions in semicircles, altitude and heart rate as given', () => {
    const lat = -6.2088;
    const lon = 106.8456;
    const { records } = roundTrip(walk, [{ ts: START + 60, lat, lon, alt: 23.46, hr: 111 }, { ts: START + 120, lat: lat - 0.01, lon: lon + 0.01, alt: -3.2, hr: 254 }]);
    const [, a, b] = records;
    expect(a?.positionLat).toBe(toSemicircles(lat));
    expect(a?.positionLong).toBe(toSemicircles(lon));
    // One semicircle is 8.4e-8 degrees.
    expect(((a?.positionLat as number) * 180) / 2 ** 31).toBeCloseTo(lat, 7);
    expect(((a?.positionLong as number) * 180) / 2 ** 31).toBeCloseTo(lon, 7);
    // Altitude has a resolution of 0.2 m.
    expect(Math.abs((a?.altitude as number) - 23.46)).toBeLessThanOrEqual(0.1 + 1e-9);
    expect(a?.enhancedAltitude).toBe(a?.altitude);
    expect(a?.heartRate).toBe(111);
    expect(Math.abs((b?.altitude as number) + 3.2)).toBeLessThanOrEqual(0.1 + 1e-9);
    expect(b?.heartRate).toBe(254);
  });

  it('leaves out a heart rate of 255 (the FIT invalid value), which no watch reports', () => {
    const { records } = roundTrip(walk, [hrOnly(30, 255)]);
    expect(records.some((r) => r.heartRate !== undefined)).toBe(false);
  });
});

describe('buildFit session and lap', () => {
  const points = [fix(100, 10, 95), fix(200, 10.001, 110), fix(300, 10.002, 120)];

  it('carries the watch totals: elapsed, active time, distance, calories, heart rate, ascent', () => {
    const { session, lap, activity } = roundTrip(walk, points);
    for (const total of [session, lap]) {
      expect(total?.startTime).toBe(FIT_START);
      expect(total?.timestamp).toBe(FIT_START + 600);
      expect(total?.totalElapsedTime).toBe(600);
      expect(total?.totalTimerTime).toBe(540);
      expect(total?.totalDistance).toBe(500);
      expect(total?.totalCalories).toBe(38);
      expect(total?.avgHeartRate).toBe(101);
      expect(total?.maxHeartRate).toBe(120);
      expect(total?.totalAscent).toBe(12);
      expect(total?.totalDescent).toBe(9);
      expect(total?.sport).toBe(11);
      expect(total?.subSport).toBe(0);
    }
    expect(session?.numLaps).toBe(1);
    expect(session?.firstLapIndex).toBe(0);
    expect(activity?.totalTimerTime).toBe(540);
    expect(activity?.numSessions).toBe(1);
    expect(activity?.timestamp).toBe(FIT_START + 600);
    expect(activity?.localTimestamp).toBe(FIT_START + 600 + 7 * 3600);
  });

  it('round-trips positions of the first and last fix', () => {
    const { session, lap } = roundTrip(walk, points);
    expect(session?.startPositionLat).toBe(toSemicircles(10));
    expect(lap?.startPositionLat).toBe(toSemicircles(10));
    expect(lap?.endPositionLat).toBe(toSemicircles(10.002));
    expect(lap?.endPositionLong).toBe(toSemicircles(106.8));
  });

  it('has the speeds the watch gives: distance over active time, and its maximum', () => {
    const { session } = roundTrip(walk, points);
    expect(session?.avgSpeed).toBeCloseTo(500 / 540, 3);
    expect(session?.enhancedAvgSpeed).toBeCloseTo(500 / 540, 3);
    expect(session?.maxSpeed).toBeCloseTo(1.8, 3);
    // A maximum below the average cannot be, so the average is the floor.
    expect(roundTrip({ ...walk, maxSpeed: 0.1 }, points).session?.maxSpeed).toBeCloseTo(500 / 540, 3);
    expect(roundTrip({ ...walk, maxSpeed: null }, points).session?.maxSpeed).toBeUndefined();
  });

  it('uses the elapsed time when the watch has no active time, and never more than it', () => {
    expect(roundTrip({ ...walk, duration: 0 }, points).session?.totalTimerTime).toBe(600);
    expect(roundTrip({ ...walk, duration: 999 }, points).session?.totalTimerTime).toBe(600);
  });

  it('has the active time, not the elapsed time, when the workout was paused', () => {
    const { session, records } = roundTrip({ ...walk, duration: 300 }, points);
    expect(session?.totalElapsedTime).toBe(600);
    expect(session?.totalTimerTime).toBe(300);
    expect(offsets(records).pop()).toBe(600);
  });

  it('omits what the watch did not provide', () => {
    const { session } = roundTrip(
      { ...walk, avgHr: null, maxHr: null, calories: 0, steps: 0, elevationGain: null, elevationLoss: undefined, maxSpeed: undefined },
      [],
    );
    expect(session?.avgHeartRate).toBeUndefined();
    expect(session?.maxHeartRate).toBeUndefined();
    expect(session?.totalCalories).toBeUndefined();
    expect(session?.avgCadence).toBeUndefined();
    expect(session?.totalCycles).toBeUndefined();
    expect(session?.totalAscent).toBeUndefined();
    expect(session?.totalDescent).toBeUndefined();
    expect(session?.maxSpeed).toBeUndefined();
    expect(session?.startPositionLat).toBeUndefined();
  });

  it('clamps calories to what the field holds', () => {
    expect(roundTrip({ ...walk, calories: 1_000_000 }, []).session?.totalCalories).toBe(65_534);
  });

  it('turns steps into strides and strides per minute of active time for foot sports only', () => {
    // 900 steps = 450 strides in 9 active minutes = 50 per minute (100 steps per minute).
    const run = roundTrip({ ...walk, sportType: 1 }, points).session;
    expect(run?.totalCycles).toBe(450);
    expect(run?.avgCadence).toBe(50);
    expect(roundTrip({ ...walk, sportType: 4 }, points).session?.avgCadence).toBe(50);
    const ride = roundTrip({ ...walk, sportType: 3 }, points).session;
    expect(ride?.avgCadence).toBeUndefined();
    expect(ride?.totalCycles).toBeUndefined();
  });

  it('writes no per-record cadence or speed: the watch has none', () => {
    const { records } = roundTrip(walk, points);
    expect(records.every((r) => r.cadence === undefined && r.speed === undefined)).toBe(true);
  });
});

describe('buildFit file', () => {
  it('identifies an activity file made by JoyoFit', () => {
    const { fileId, messages } = roundTrip(walk, [hrOnly(10, 90)]);
    expect(fileId?.type).toBe(4);
    expect(fileId?.manufacturer).toBe(255);
    expect(fileId?.timeCreated).toBe(FIT_START);
    expect(fileId?.productName).toBe('JoyoFit');
    expect(messages.deviceInfoMesgs?.[0]?.productName).toBe('JoyoFit');
  });

  it('writes messages in the order a FIT activity has them', () => {
    const { messages } = roundTrip(walk, [hrOnly(10, 90)]);
    expect(Object.keys(messages)).toEqual(['fileIdMesgs', 'deviceInfoMesgs', 'eventMesgs', 'recordMesgs', 'lapMesgs', 'sessionMesgs', 'activityMesgs']);
  });

  it('is the same bytes every time for the same workout', () => {
    const points = [fix(100, 10), hrOnly(150, 99)];
    expect(buildFit(walk, points, { utcOffsetSeconds: 0 }).bytes).toEqual(buildFit(walk, points, { utcOffsetSeconds: 0 }).bytes);
  });

  it('handles a workout whose end is not after its start', () => {
    const { session, records } = roundTrip({ ...walk, end: START - 5 }, [hrOnly(0, 80)]);
    expect(records.length).toBe(1);
    expect(session?.totalElapsedTime).toBe(0);
  });
});

describe('buildFit sport mapping', () => {
  it('writes the FIT sport and sub sport of the mapped sport, treadmill and trainer sessions included', () => {
    const sportOf = (sportType: number) => {
      const { session } = roundTrip({ ...walk, sportType }, []);
      return [session?.sport, session?.subSport];
    };
    expect(sportOf(1)).toEqual([1, 0]); // running
    expect(sportOf(5)).toEqual([1, 1]); // running, treadmill
    expect(sportOf(11)).toEqual([1, 3]); // running, trail
    expect(sportOf(2)).toEqual([11, 0]); // walking
    expect(sportOf(13)).toEqual([11, 27]); // walking, indoor
    expect(sportOf(3)).toEqual([2, 0]); // cycling
    expect(sportOf(7)).toEqual([2, 6]); // cycling, indoor
    expect(sportOf(4)).toEqual([17, 0]); // hiking
    expect(sportOf(6)).toEqual([5, 17]); // swimming, lap
    expect(sportOf(8)).toEqual([5, 18]); // swimming, open water
    expect(sportOf(137)).toEqual([10, 43]); // training, yoga
    expect(sportOf(255)).toEqual([10, 0]); // unknown: training
  });
});

describe('sport mapping and upload form', () => {
  it('maps Huawei sport types to Strava sport types', () => {
    expect(stravaSport(1).sportType).toBe('Run');
    expect(stravaSport(2).sportType).toBe('Walk');
    expect(stravaSport(3).sportType).toBe('Ride');
    expect(stravaSport(14).sportType).toBe('Hike');
    expect(stravaSport(6).sportType).toBe('Swim');
    expect(stravaSport(7)).toMatchObject({ sportType: 'Ride', trainer: true });
    expect(stravaSport(5)).toMatchObject({ sportType: 'Run', trainer: true });
    expect(stravaSport(255).sportType).toBe('Workout');
    expect(stravaSport(9999).sportType).toBe('Workout');
  });

  it('reads the activity id out of a duplicate error', () => {
    expect(duplicateOf('joyofit-1.fit duplicate of activity 9876543210')).toBe(9876543210);
    expect(duplicateOf('The file is empty')).toBeNull();
    expect(duplicateOf(null)).toBeNull();
  });

  it('uses one stable external id per workout', () => {
    expect(externalId(START)).toBe(`joyofit-${START}`);
    expect(externalId(START)).toBe(externalId(START));
    expect(externalId(START)).not.toBe(externalId(START + 1));
  });

  // Every byte value, with the CR LF a multipart parser would split on, and a NUL.
  const file = Uint8Array.from([...Array.from({ length: 256 }, (_, i) => i), 13, 10, 13, 10, 0, 45, 45]);
  const latin1 = (bytes: Uint8Array) => new TextDecoder('latin1').decode(bytes);

  it('adds the link to the description only when asked, never to the title', () => {
    const off = latin1(buildUploadForm(walk, file, { addLink: false }).body);
    expect(off).not.toContain('name="description"');
    expect(off).not.toContain(DESCRIPTION_LINK);
    const on = latin1(buildUploadForm(walk, file, { addLink: true }).body);
    expect(on).toContain(`name="description"\r\n\r\n${DESCRIPTION_LINK}\r\n`);
    expect(on).toContain('name="name"\r\n\r\nWalking\r\n');
  });

  it('builds a binary multipart body with the fields Strava needs and the file untouched', () => {
    const form = buildUploadForm({ ...walk, sportType: 7 }, file, { addLink: false });
    const boundary = /boundary=(.*)$/.exec(form.contentType)?.[1] ?? '';
    expect(boundary).not.toBe('');
    const text = latin1(form.body);
    expect(text.startsWith(`--${boundary}\r\n`)).toBe(true);
    expect(text.endsWith(`\r\n--${boundary}--\r\n`)).toBe(true);
    for (const [name, value] of [
      ['data_type', 'fit'],
      ['external_id', `joyofit-${START}`],
      ['sport_type', 'Ride'],
      ['trainer', '1'],
    ] as const) {
      expect(text).toContain(`name="${name}"\r\n\r\n${value}\r\n`);
    }
    const header = `name="file"; filename="joyofit-${START}.fit"\r\nContent-Type: application/octet-stream\r\n\r\n`;
    const from = text.indexOf(header) + header.length;
    expect(from).toBeGreaterThan(header.length);
    expect(form.body.subarray(from, from + file.length)).toEqual(file);
    expect(text.slice(from + file.length)).toBe(`\r\n--${boundary}--\r\n`);
  });

  it('carries a real FIT file through the form byte for byte', () => {
    const { bytes } = buildFit(walk, [fix(100, 10, 95), fix(200, 10.001, 110)], { utcOffsetSeconds: 0 });
    const { body } = buildUploadForm(walk, bytes, { addLink: false });
    let from = -1;
    for (let i = 0; i + bytes.length <= body.length && from < 0; i++) if (body[i] === 14 && body[i + 8] === 0x2e && body[i + 11] === 0x54) from = i;
    expect(from).toBeGreaterThan(0);
    expect(body.subarray(from, from + bytes.length)).toEqual(bytes);
    expect(decodeFit(body.subarray(from, from + bytes.length)).integrity).toBe(true);
  });
});

/**
 * A walk shaped like a stored `workouts` + `workout_points` pair of the Huawei watch (the owner's real one is not committed:
 * its route is a home address): 50 minutes elapsed, 36 active, GPS from the fourth minute at one fix per second, a data
 * sample (heart rate and barometric altitude, no position) every 5 seconds, and a 12 minute pause in which neither
 * stream has a point.
 */
function storedWalk(): { workout: StravaWorkout; points: StravaPoint[] } {
  const points: StravaPoint[] = [];
  const paused = (t: number) => t > 2069 && t < 2902;
  for (let t = 5; t <= 3003; t++) {
    if (paused(t)) continue;
    if (t % 5 === 0 && !(t > 2151 && t < 2989)) {
      points.push({ ts: START + t, lat: null, lon: null, alt: 6 + Math.sin(t / 300), hr: 105 + ((t * 7) % 35) });
    }
    if (t >= 219) {
      const angle = t / 400;
      points.push({ ts: START + t, lat: -6.2 + 0.002 * Math.sin(angle), lon: 106.8 + 0.002 * Math.cos(angle), alt: 5 + Math.sin(t / 200), hr: null });
    }
  }
  return {
    workout: {
      start: START,
      end: START + 3005,
      sportType: 2,
      sportName: 'Walking',
      duration: 2169,
      distance: 2270,
      calories: 188,
      avgHr: 126,
      maxHr: 139,
      steps: 3625,
      elevationGain: 1.1,
      elevationLoss: 6.6,
      maxSpeed: 1.5,
    },
    points,
  };
}

describe('a stored workout', () => {
  const { workout, points } = storedWalk();
  const { built, records, session, lap, activity } = roundTrip(workout, points);

  it('decodes without errors and gives the watch totals back', () => {
    expect(session?.totalElapsedTime).toBe(3005);
    expect(session?.totalTimerTime).toBe(2169);
    expect(session?.totalDistance).toBe(2270);
    expect(session?.totalCalories).toBe(188);
    expect(session?.avgHeartRate).toBe(126);
    expect(session?.maxHeartRate).toBe(139);
    expect(session?.totalAscent).toBe(1);
    expect(session?.totalDescent).toBe(7);
    expect(session?.totalCycles).toBe(1813);
    expect(session?.avgCadence).toBe(50);
    expect(session?.avgSpeed).toBeCloseTo(1.047, 3);
    expect(session?.sport).toBe(11);
    expect(lap?.totalTimerTime).toBe(2169);
    expect(activity?.totalTimerTime).toBe(2169);
  });

  it('keeps every sample, one record per second at most, in time order', () => {
    const wanted = new Set(points.map((p) => p.ts));
    wanted.add(START);
    wanted.add(START + 3005);
    expect(records.length).toBe(wanted.size);
    expect(built.samples).toBe(wanted.size);
    const times = offsets(records);
    expect(times).toEqual([...times].sort((a, b) => a - b));
    expect(times[0]).toBe(0);
    expect(times[times.length - 1]).toBe(3005);
  });

  it('round-trips every position to a semicircle and every heart rate and altitude', () => {
    const byTime = new Map(records.map((r) => [(r.timestamp as number) - FIT_START, r]));
    // Points of one second merge, the later one winning for altitude.
    const lastAlt = new Map<number, number>();
    for (const p of points) if (p.alt !== null) lastAlt.set(p.ts, p.alt);
    let positions = 0;
    let heartRates = 0;
    for (const p of points) {
      const record = byTime.get(p.ts - START);
      expect(record).toBeDefined();
      if (p.lat !== null && p.lon !== null) {
        positions += 1;
        expect(record?.positionLat).toBe(toSemicircles(p.lat));
        expect(record?.positionLong).toBe(toSemicircles(p.lon));
      }
      if (p.hr !== null) {
        heartRates += 1;
        expect(record?.heartRate).toBe(p.hr);
      }
      if (p.alt !== null) expect(Math.abs((record?.altitude as number) - (lastAlt.get(p.ts) as number))).toBeLessThanOrEqual(0.1 + 1e-9);
    }
    expect(records.filter((r) => r.positionLat !== undefined).length).toBe(positions);
    expect(records.filter((r) => r.heartRate !== undefined).length).toBe(heartRates);
    expect(positions).toBeGreaterThan(1500);
  });

  it('has a distance that only grows, is 0 before the first fix and ends on the watch total', () => {
    const d = distances(records) as number[];
    for (let i = 1; i < d.length; i++) expect(d[i]).toBeGreaterThanOrEqual(d[i - 1] ?? 0);
    const times = offsets(records);
    expect(d[times.indexOf(215)]).toBe(0);
    expect(d[d.length - 1]).toBe(2270);
    expect(Math.max(...(records.map((r) => r.heartRate ?? 0) as number[]))).toBeLessThanOrEqual(139);
  });
});
