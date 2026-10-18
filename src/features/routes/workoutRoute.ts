import { cleanRoutePoints, completeAltitudes, type RouteDraft, type RoutePoint } from './routeModel';

/** The part of a `workout_points` row a route is made of. */
export interface WorkoutPointLike {
  lat: number | null;
  lon: number | null;
  alt: number | null;
}

/** The GPS rows of a workout as a route draft: rows without a position dropped, altitude kept when most rows have it. Null when fewer than 2 points remain. */
export function workoutRouteDraft(name: string, rows: readonly WorkoutPointLike[]): RouteDraft | null {
  const positioned: RoutePoint[] = [];
  for (const row of rows) {
    if (row.lat !== null && row.lon !== null) positioned.push({ lat: row.lat, lon: row.lon, alt: row.alt });
  }
  const points = completeAltitudes(cleanRoutePoints(positioned));
  return points.length < 2 ? null : { name, source: 'workout', points };
}
