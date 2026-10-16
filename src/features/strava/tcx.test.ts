import { describe, expect, it } from 'bun:test';

import { buildTcx, buildUploadForm, DESCRIPTION_LINK, duplicateOf, externalId, stravaSport, type StravaPoint, type StravaWorkout } from './tcx';

const START = 1_792_058_016;

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
};

/** About 111 m per 0.001 degree of latitude: three fixes make roughly 222 m of GPS path, the watch says 500 m. */
const fix = (offset: number, lat: number, hr: number | null = null): StravaPoint => ({ ts: START + offset, lat, lon: 106.8, alt: 10, hr });
const hrOnly = (offset: number, hr: number): StravaPoint => ({ ts: START + offset, lat: null, lon: null, alt: null, hr });

interface Parsed {
  times: number[];
  distances: number[];
  positions: number;
  heartRates: number[];
}

function parse(xml: string): Parsed {
  const trackpoints = xml.match(/<Trackpoint>.*?<\/Trackpoint>/g) ?? [];
  return {
    times: trackpoints.map((t) => Date.parse(/<Time>(.*?)<\/Time>/.exec(t)?.[1] ?? '') / 1000),
    distances: trackpoints.map((t) => Number(/<DistanceMeters>(.*?)<\/DistanceMeters>/.exec(t)?.[1])),
    positions: trackpoints.filter((t) => t.includes('<Position>')).length,
    heartRates: trackpoints.flatMap((t) => {
      const hr = /<HeartRateBpm><Value>(\d+)<\/Value>/.exec(t)?.[1];
      return hr ? [Number(hr)] : [];
    }),
  };
}

const lap = (xml: string, tag: string) => new RegExp(`<${tag}>(.*?)</${tag}>`).exec(xml)?.[1];

describe('buildTcx distance', () => {
  const points = [fix(100, 10), fix(200, 10.001), fix(300, 10.002), hrOnly(150, 99), hrOnly(250, 105)];

  it('scales the GPS path so the last sample is exactly the watch distance', () => {
    const { xml } = buildTcx(walk, points);
    const { distances } = parse(xml);
    expect(distances[distances.length - 1]).toBe(500);
    expect(lap(xml, 'DistanceMeters')).toBe('500.00');
  });

  it('is cumulative and never decreases, with HR-only samples interpolated between fixes', () => {
    const { distances, times } = parse(buildTcx(walk, points).xml);
    for (let i = 1; i < distances.length; i++) expect(distances[i]).toBeGreaterThanOrEqual(distances[i - 1] ?? 0);
    const at = (offset: number) => distances[times.indexOf(START + offset)] ?? NaN;
    expect(at(0)).toBe(0);
    expect(at(100)).toBe(0);
    expect(at(200)).toBeCloseTo(250, 0);
    expect(at(150)).toBeCloseTo(125, 0);
    expect(at(300)).toBe(500);
    expect(at(600)).toBe(500);
  });

  it('grows linearly over the whole workout when there is no GPS', () => {
    const { xml } = buildTcx({ ...walk, sportType: 5 }, [hrOnly(0, 90), hrOnly(300, 100), hrOnly(600, 110)]);
    const { distances, positions } = parse(xml);
    expect(positions).toBe(0);
    expect(distances).toEqual([0, 250, 500]);
  });

  it('writes no distance at all for a workout without one', () => {
    const { xml } = buildTcx({ ...walk, distance: 0, sportType: 137 }, [hrOnly(0, 80), hrOnly(60, 85)]);
    expect(parse(xml).distances.every(Number.isNaN)).toBe(true);
  });
});

describe('buildTcx span', () => {
  it('covers start to end even when GPS only exists in the middle', () => {
    const points = [fix(100, 10), fix(200, 10.001), hrOnly(10, 88), hrOnly(550, 95)];
    const { xml } = buildTcx(walk, points);
    const { times } = parse(xml);
    expect(times[0]).toBe(START);
    expect(times[times.length - 1]).toBe(START + 600);
    expect(times).toEqual([...times].sort((a, b) => a - b));
    expect(new Set(times).size).toBe(times.length);
    expect(lap(xml, 'TotalTimeSeconds')).toBe('600');
  });

  it('keeps HR-only samples and merges samples of the same second', () => {
    const points = [hrOnly(30, 90), fix(30, 10), hrOnly(60, 100)];
    const built = buildTcx(walk, points);
    // start, 30 (merged), 60, end
    expect(built.samples).toBe(4);
    const { positions, heartRates } = parse(built.xml);
    expect(positions).toBe(1);
    expect(heartRates).toEqual([90, 100]);
  });

  it('drops points outside the workout and invalid fixes', () => {
    const points = [hrOnly(-5, 70), hrOnly(700, 70), { ts: START + 20, lat: 0, lon: 0, alt: null, hr: null }, { ts: START + 40, lat: 95, lon: 10, alt: null, hr: 0 }];
    const { xml, samples } = buildTcx(walk, points);
    expect(samples).toBe(4);
    const parsed = parse(xml);
    expect(parsed.positions).toBe(0);
    expect(parsed.heartRates).toEqual([]);
  });
});

describe('buildTcx lap', () => {
  it('carries the watch calories and heart rate summary', () => {
    const { xml } = buildTcx(walk, [hrOnly(10, 90)]);
    expect(lap(xml, 'Calories')).toBe('38');
    expect(xml).toContain('<AverageHeartRateBpm><Value>101</Value></AverageHeartRateBpm>');
    expect(xml).toContain('<MaximumHeartRateBpm><Value>120</Value></MaximumHeartRateBpm>');
  });

  it('omits heart rate summary when the watch has none and clamps calories to the schema', () => {
    const { xml } = buildTcx({ ...walk, avgHr: null, maxHr: null, calories: 1_000_000 }, []);
    expect(xml).not.toContain('AverageHeartRateBpm');
    expect(lap(xml, 'Calories')).toBe('65535');
  });

  it('is well-formed enough for Strava: one activity id at the start, TCX sport from the mapping', () => {
    const { xml } = buildTcx({ ...walk, sportType: 1 }, []);
    expect(xml).toContain(`<Id>${new Date(START * 1000).toISOString()}</Id>`);
    expect(xml).toContain('<Activity Sport="Running">');
    expect(buildTcx({ ...walk, sportType: 140 }, []).xml).toContain('<Activity Sport="Other">');
  });
});

describe('sport mapping and upload form', () => {
  it('maps Huawei sport types to Strava sport types', () => {
    expect(stravaSport(1).sportType).toBe('Run');
    expect(stravaSport(2).sportType).toBe('Walk');
    expect(stravaSport(3).sportType).toBe('Ride');
    expect(stravaSport(14).sportType).toBe('Hike');
    expect(stravaSport(6).sportType).toBe('Swim');
    expect(stravaSport(7)).toEqual({ sportType: 'Ride', trainer: true });
    expect(stravaSport(5)).toEqual({ sportType: 'Run', trainer: true });
    expect(stravaSport(255).sportType).toBe('Workout');
    expect(stravaSport(9999).sportType).toBe('Workout');
  });

  it('reads the activity id out of a duplicate error', () => {
    expect(duplicateOf('joyofit-1.tcx duplicate of activity 9876543210')).toBe(9876543210);
    expect(duplicateOf('The file is empty')).toBeNull();
    expect(duplicateOf(null)).toBeNull();
  });

  it('uses one stable external id per workout', () => {
    expect(externalId(START)).toBe(`joyofit-${START}`);
    expect(externalId(START)).toBe(externalId(START));
    expect(externalId(START)).not.toBe(externalId(START + 1));
  });

  it('adds the link to the description only when asked, never to the title', () => {
    const off = buildUploadForm(walk, '<x/>', { addLink: false });
    expect(off.body).not.toContain('name="description"');
    expect(off.body).not.toContain(DESCRIPTION_LINK);
    const on = buildUploadForm(walk, '<x/>', { addLink: true });
    expect(on.body).toContain(`name="description"\r\n\r\n${DESCRIPTION_LINK}\r\n`);
    expect(on.body).toContain('name="name"\r\n\r\nWalking\r\n');
  });

  it('builds a multipart body with the fields Strava needs', () => {
    const form = buildUploadForm({ ...walk, sportType: 7 }, '<x/>', { addLink: false });
    const boundary = /boundary=(.*)$/.exec(form.contentType)?.[1] ?? '';
    expect(boundary).not.toBe('');
    expect(form.body.startsWith(`--${boundary}\r\n`)).toBe(true);
    expect(form.body.endsWith(`--${boundary}--\r\n`)).toBe(true);
    for (const [name, value] of [
      ['data_type', 'tcx'],
      ['external_id', `joyofit-${START}`],
      ['sport_type', 'Ride'],
      ['trainer', '1'],
    ] as const) {
      expect(form.body).toContain(`name="${name}"\r\n\r\n${value}\r\n`);
    }
    expect(form.body).toContain(`name="file"; filename="joyofit-${START}.tcx"`);
  });
});
