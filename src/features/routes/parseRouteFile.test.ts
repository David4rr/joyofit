import { describe, expect, test } from 'bun:test';

import { applyLocale } from '@/i18n';

import { parseGpx } from './gpx';
import { decodeUtf8, parseRouteFile, parseRouteText, sniffRouteFormat } from './parseRouteFile';
import { routeStats } from './routeModel';
import {
  ACTIVITY_TCX,
  COURSE_TCX,
  GARMIN_GPX,
  NOT_A_ROUTE_XML,
  PREFIXED_GPX,
  ROUTE_GPX,
  SINGLE_POINT_GPX,
  STRAVA_GPX,
} from './routeFixtures';
import { parseTcx } from './tcx';

const bytes = (text: string) => new TextEncoder().encode(text);

function parsed(text: string) {
  const result = parseRouteText(text);
  if (!result.ok) throw new Error(result.message);
  return result.route;
}

describe('Strava-style GPX', () => {
  const route = parsed(STRAVA_GPX);
  test('the track name, 5 points with altitude', () => {
    expect(route.format).toBe('gpx');
    expect(route.name).toBe('Lari pagi Alun-Alun');
    expect(route.points).toHaveLength(5);
    expect(route.points[0]).toEqual({ lat: -7.9825, lon: 112.6304, alt: 445.2 });
    expect(route.points.every((p) => p.alt !== null)).toBe(true);
  });
  test('the stats follow from the points', () => {
    const stats = routeStats(route.points);
    expect(stats.hasAltitude).toBe(true);
    expect(stats.ascentM).toBe(7);
    expect(stats.descentM).toBe(0);
    expect(stats.distanceM).toBeGreaterThan(145);
    expect(stats.distanceM).toBeLessThan(165);
  });
});

describe('Garmin-style GPX with extensions', () => {
  const route = parsed(GARMIN_GPX);
  test('the CDATA name with its entity-looking characters, not the waypoint name', () => {
    expect(route.name).toBe('Gowes <Batu> & Sekitar');
  });
  test('drops the repeated point, the 0,0 fix and the waypoint', () => {
    expect(route.points.map((p) => [p.lat, p.lon])).toEqual([
      [-7.96, 112.61],
      [-7.961, 112.612],
      [-7.9625, 112.615],
      [-7.965, 112.619],
    ]);
    expect(route.points[0].alt).toBe(650);
    expect(route.points[3].alt).toBe(671.9);
  });
});

describe('planned route GPX', () => {
  test('uses rte/rtept when there is no track, the metadata name decoded, a missing altitude filled in', () => {
    const route = parsed(ROUTE_GPX);
    expect(route.name).toBe('Rencana & Tanjakan Bromo');
    expect(route.points).toHaveLength(4);
    expect(route.points.map((p) => p.alt)).toEqual([900, 950, 1000, 1100]);
  });
  test('the track wins over the route; a prefixed root and single quotes are fine', () => {
    const route = parsed(PREFIXED_GPX);
    expect(route.name).toBe('Recorded');
    expect(route.points).toEqual([
      { lat: -7.5, lon: 112.5, alt: null },
      { lat: -7.6, lon: 112.6, alt: null },
    ]);
  });
  test('parseGpx alone', () => {
    expect(parseGpx(STRAVA_GPX).points).toHaveLength(5);
    expect(parseGpx('<gpx></gpx>').points).toEqual([]);
  });
});

describe('TCX', () => {
  test('a course: its name and Trackpoint positions, not the CoursePoint', () => {
    const route = parsed(COURSE_TCX);
    expect(route.format).toBe('tcx');
    expect(route.name).toBe('Tanjakan Songgoriti');
    expect(route.points).toEqual([
      { lat: -7.89, lon: 112.53, alt: 800 },
      { lat: -7.892, lon: 112.532, alt: 812.5 },
      { lat: -7.895, lon: 112.535, alt: 830 },
    ]);
  });
  test('an activity: no name, the Trackpoint without a Position is skipped', () => {
    const route = parsed(ACTIVITY_TCX);
    expect(route.format).toBe('tcx');
    expect(route.name).toBeNull();
    expect(route.points.map((p) => [p.lat, p.lon, p.alt])).toEqual([
      [-7.98, 112.63, 440],
      [-7.981, 112.631, 441],
      [-7.983, 112.633, 445],
    ]);
  });
  test('parseTcx alone', () => {
    expect(parseTcx(COURSE_TCX).points).toHaveLength(3);
    expect(parseTcx('<TrainingCenterDatabase/>').points).toEqual([]);
  });
});

describe('bytes', () => {
  test('a byte-order mark is ignored', () => {
    const withBom = new Uint8Array([0xef, 0xbb, 0xbf, ...bytes(STRAVA_GPX)]);
    const result = parseRouteFile(withBom);
    expect(result.ok).toBe(true);
  });
  test('whitespace and a comment before the root are fine', () => {
    expect(parseRouteText(`\n\n  <!-- made by hand -->\n${STRAVA_GPX}`).ok).toBe(true);
  });
  test('decoded as UTF-8', () => {
    const text = '<gpx><trk><name>Jalan Pahlawan \u2013 Caf\u00e9 \u{1F6B4}</name><trkseg><trkpt lat="1" lon="2"/><trkpt lat="1.1" lon="2.1"/></trkseg></trk></gpx>';
    const result = parseRouteFile(bytes(text));
    expect(result.ok && result.route.name).toBe('Jalan Pahlawan \u2013 Caf\u00e9 \u{1F6B4}');
    expect(decodeUtf8(new Uint8Array([0xef, 0xbb, 0xbf, 0x41]))).toBe('A');
  });
  test('whitespace in the name is collapsed', () => {
    const text = '<gpx><trk><name>  Lari\n   sore  </name><trkseg><trkpt lat="1" lon="2"/><trkpt lat="1.1" lon="2.1"/></trkseg></trk></gpx>';
    expect(parsed(text).name).toBe('Lari sore');
  });
});

describe('sniffRouteFormat', () => {
  test('by the root element, prefixed or not', () => {
    expect(sniffRouteFormat(STRAVA_GPX)).toBe('gpx');
    expect(sniffRouteFormat(PREFIXED_GPX)).toBe('gpx');
    expect(sniffRouteFormat(COURSE_TCX)).toBe('tcx');
    expect(sniffRouteFormat(NOT_A_ROUTE_XML)).toBeNull();
  });
});

describe('errors', () => {
  test('an empty file', () => {
    for (const result of [parseRouteFile(new Uint8Array(0)), parseRouteText('  \n ')]) {
      expect(result).toMatchObject({ ok: false, reason: 'empty' });
    }
  });
  test('XML that is neither GPX nor TCX', () => {
    const result = parseRouteText(NOT_A_ROUTE_XML);
    expect(result).toMatchObject({ ok: false, reason: 'unrecognized' });
    expect(result.ok ? '' : result.message).toContain('GPX atau TCX');
  });
  test('one point is not a route', () => {
    const result = parseRouteText(SINGLE_POINT_GPX);
    expect(result).toMatchObject({ ok: false, reason: 'too-few-points' });
    expect(result.ok ? '' : result.message).toContain('1 titik');
  });
  test('the single-point message is singular in English', async () => {
    await applyLocale('en');
    try {
      const result = parseRouteText(SINGLE_POINT_GPX);
      expect(result.ok ? '' : result.message).toContain('only 1 valid route point.');
    } finally {
      await applyLocale('id');
    }
  });
  test('a track of points without a fix', () => {
    const result = parseRouteText('<gpx><trk><trkseg><trkpt lat="0" lon="0"/><trkpt lat="x" lon="y"/><trkpt lon="3"/></trkseg></trk></gpx>');
    expect(result).toMatchObject({ ok: false, reason: 'too-few-points' });
    expect(result.ok ? '' : result.message).toContain('Tidak ada titik');
  });
  test('binary garbage and a cut-off file do not throw', () => {
    const garbage = new Uint8Array(512).map((_, i) => (i * 37 + 11) % 256);
    expect(parseRouteFile(garbage).ok).toBe(false);
    const secondPoint = STRAVA_GPX.indexOf('<trkpt', STRAVA_GPX.indexOf('<trkpt') + 1);
    expect(parseRouteText(STRAVA_GPX.slice(0, secondPoint)).ok).toBe(false);
  });
});
