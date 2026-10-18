/**
 * GPX 1.0 / 1.1: the track (`trk/trkseg/trkpt`) when it has a line, otherwise the planned route (`rte/rtept`). Waypoints
 * (`wpt`) are not part of the line. Extensions (heart rate, power, Garmin and Strava additions) are skipped.
 */
import { cleanRoutePoints, completeAltitudes, type RoutePoint } from './routeModel';
import { parseAttrs, parseNumber, scanXml, type RawRoute } from './xml';

interface OpenPoint {
  lat: number;
  lon: number;
  alt: number | null;
  into: RoutePoint[];
}

/** The line of a GPX file. Never throws; a file without a usable line returns fewer than 2 points. */
export function parseGpx(xml: string): RawRoute {
  const stack: string[] = [];
  const track: RoutePoint[] = [];
  const planned: RoutePoint[] = [];
  /** The first `<name>` under `trk`, `rte` and `metadata`; a name under anything else (a waypoint, a link) is not the line's. */
  const names: Record<string, string | null> = { trk: null, rte: null, metadata: null };

  let point: OpenPoint | null = null;
  let capture: 'name' | 'ele' | null = null;
  let buffer = '';

  scanXml(xml, {
    open(name, attrs) {
      const parent = stack[stack.length - 1];
      if (name === 'trkpt' || name === 'rtept') {
        const a = parseAttrs(attrs);
        point = { lat: parseNumber(a.lat), lon: parseNumber(a.lon), alt: null, into: name === 'trkpt' ? track : planned };
      } else if (name === 'name' && names[parent] === null) {
        capture = 'name';
        buffer = '';
      } else if (name === 'ele' && point !== null && (parent === 'trkpt' || parent === 'rtept')) {
        capture = 'ele';
        buffer = '';
      }
      stack.push(name);
    },
    text(text) {
      if (capture !== null) buffer += text;
    },
    close(name) {
      const at = stack.lastIndexOf(name);
      if (at === -1) return;
      stack.length = at;
      if (name === 'trkpt' || name === 'rtept') {
        if (point !== null) point.into.push({ lat: point.lat, lon: point.lon, alt: point.alt });
        point = null;
        capture = null;
      } else if (capture === 'name' && name === 'name') {
        const owner = stack[stack.length - 1];
        const value = buffer.trim();
        if (value !== '' && names[owner] === null) names[owner] = value;
        capture = null;
      } else if (capture === 'ele' && name === 'ele') {
        if (point !== null) {
          const alt = parseNumber(buffer);
          point.alt = Number.isFinite(alt) ? alt : null;
        }
        capture = null;
      }
    },
  });

  const trackPoints = cleanRoutePoints(track);
  const routePoints = cleanRoutePoints(planned);
  const useTrack = trackPoints.length >= 2 || routePoints.length < 2;
  return {
    name: (useTrack ? names.trk : names.rte) ?? names.metadata,
    points: completeAltitudes(useTrack ? trackPoints : routePoints),
  };
}
