import { describe, expect, it } from 'bun:test';

import { buildFit, type StravaPoint, type StravaWorkout } from '@/features/strava/activityFile';
import { decodeFit } from '@/features/strava/testDecode';

import { buildGpx, canExportFit, canExportGpx, exportFileName, shareExport, type ExportIo } from './workoutExport';

const START = 1_792_058_016;
const workout: StravaWorkout = {
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
};
const points: StravaPoint[] = [
  { ts: START, lat: -6.2, lon: 106.8, alt: 10, hr: null },
  { ts: START + 5, lat: null, lon: null, alt: null, hr: 98 },
  { ts: START + 300, lat: -6.201, lon: 106.8, alt: 12, hr: null },
  { ts: START + 600, lat: -6.202, lon: 106.8, alt: 11, hr: 110 },
];
const row = { start: START, sportName: 'Walking', complete: true };

describe('exportFileName', () => {
  it('names the file by sport and local start time', () => {
    const d = new Date(START * 1000);
    const p = (n: number) => String(n).padStart(2, '0');
    const when = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
    expect(exportFileName(row, 'fit')).toBe(`JoyoFit-Walking-${when}.fit`);
    expect(exportFileName({ ...row, sportName: 'Indoor cycling' }, 'gpx')).toBe(`JoyoFit-Indoorcycling-${when}.gpx`);
    expect(exportFileName({ ...row, sportName: '' }, 'fit')).toStartWith('JoyoFit-Workout-');
  });
});

describe('shareExport', () => {
  it('shares exactly the bytes the Strava builder produces', async () => {
    const built = buildFit(workout, points, { utcOffsetSeconds: 7 * 3600 });
    const written: { name: string; content: Uint8Array | string }[] = [];
    const shared: { uri: string; mime: string; name: string }[] = [];
    const io: ExportIo = {
      writeCacheFile: (name, content) => {
        written.push({ name, content });
        return `file:///cache/${name}`;
      },
      share: async (uri, mime, name) => {
        shared.push({ uri, mime, name });
      },
    };
    const name = await shareExport(io, row, 'fit', built.bytes);
    expect(written).toHaveLength(1);
    expect(written[0]?.name).toBe(name);
    expect(written[0]?.content).toBe(built.bytes);
    expect(Buffer.from(written[0]?.content as Uint8Array).equals(Buffer.from(buildFit(workout, points, { utcOffsetSeconds: 7 * 3600 }).bytes))).toBe(true);
    expect(shared).toEqual([{ uri: `file:///cache/${name}`, mime: 'application/vnd.ant.fit', name }]);
    expect(decodeFit(built.bytes).integrity).toBe(true);
  });
});

describe('availability', () => {
  it('needs a finished workout, and for GPX a line', () => {
    expect(canExportFit(row)).toBe(true);
    expect(canExportFit({ ...row, complete: false })).toBe(false);
    expect(canExportGpx(row, points)).toBe(true);
    expect(canExportGpx(row, points.slice(1, 2))).toBe(false);
    expect(canExportGpx({ ...row, complete: false }, points)).toBe(false);
  });
});

describe('buildGpx', () => {
  it('writes the fixes with time and the closest heart rate in the Garmin extension', () => {
    const gpx = buildGpx(row, points);
    expect(gpx).toContain('xmlns:gpxtpx="http://www.garmin.com/xmlschemas/TrackPointExtension/v1"');
    expect(gpx.match(/<trkpt /g)).toHaveLength(3);
    expect(gpx).toContain('<trkpt lat="-6.200000" lon="106.800000"><ele>10.0</ele><time>');
    expect(gpx).toContain('<gpxtpx:hr>98</gpxtpx:hr>');
    expect(gpx).toContain('<gpxtpx:hr>110</gpxtpx:hr>');
    // The fix at +300 s has no heart rate within reach.
    expect(gpx.match(/<gpxtpx:hr>/g)).toHaveLength(2);
    expect(gpx).toContain(new Date(START * 1000).toISOString());
  });
  it('escapes the name', () => {
    expect(buildGpx({ ...row, sportName: 'A & <B>' }, points)).toContain('<name>A &amp; &lt;B&gt;</name>');
  });
});
