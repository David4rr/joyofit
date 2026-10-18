/**
 * Garmin TCX: a course (`Courses/Course/Track/Trackpoint`, what a planned route exports) when it has a line, otherwise the
 * recorded activity (`Activities/Activity/Lap/Track/Trackpoint`). A Trackpoint without a `Position` (a pause, an indoor
 * sample) is skipped; course points (`CoursePoint`, turn cues) are not part of the line.
 */
import { cleanRoutePoints, completeAltitudes, type RoutePoint } from './routeModel';
import { parseNumber, scanXml, type RawRoute } from './xml';

interface OpenTrackpoint {
  lat: number;
  lon: number;
  alt: number | null;
  inCourse: boolean;
}

/** The line of a TCX file. Never throws; a file without a usable line returns fewer than 2 points. */
export function parseTcx(xml: string): RawRoute {
  const stack: string[] = [];
  const course: RoutePoint[] = [];
  const activity: RoutePoint[] = [];
  let courseName: string | null = null;

  let point: OpenTrackpoint | null = null;
  let capture: 'lat' | 'lon' | 'alt' | 'name' | null = null;
  let buffer = '';

  scanXml(xml, {
    open(name) {
      const parent = stack[stack.length - 1];
      if (name === 'trackpoint') {
        point = { lat: Number.NaN, lon: Number.NaN, alt: null, inCourse: stack.includes('course') };
      } else if (point !== null && name === 'latitudedegrees' && parent === 'position') {
        capture = 'lat';
        buffer = '';
      } else if (point !== null && name === 'longitudedegrees' && parent === 'position') {
        capture = 'lon';
        buffer = '';
      } else if (point !== null && name === 'altitudemeters' && parent === 'trackpoint') {
        capture = 'alt';
        buffer = '';
      } else if (name === 'name' && parent === 'course' && courseName === null) {
        capture = 'name';
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
      if (name === 'trackpoint') {
        if (point !== null) (point.inCourse ? course : activity).push({ lat: point.lat, lon: point.lon, alt: point.alt });
        point = null;
        capture = null;
        return;
      }
      if (capture === null) return;
      if (capture === 'name' && name === 'name') {
        const value = buffer.trim();
        if (value !== '') courseName = value;
      } else if (point !== null) {
        const value = parseNumber(buffer);
        if (capture === 'lat' && name === 'latitudedegrees') point.lat = value;
        else if (capture === 'lon' && name === 'longitudedegrees') point.lon = value;
        else if (capture === 'alt' && name === 'altitudemeters') point.alt = Number.isFinite(value) ? value : null;
        else return;
      } else return;
      capture = null;
    },
  });

  const coursePoints = cleanRoutePoints(course);
  const activityPoints = cleanRoutePoints(activity);
  const useCourse = coursePoints.length >= 2 || activityPoints.length < 2;
  return {
    name: useCourse ? courseName : null,
    points: completeAltitudes(useCourse ? coursePoints : activityPoints),
  };
}
