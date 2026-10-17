import type { RogoHrSeries, RogoRoute } from '@/cloud/rogo';
import type { WorkoutPointRow } from '@/db/queries';
import type { RoutePoint } from '@/features/workouts/summary';

/**
 * A shared heart-rate series as `HeartRateChart` props: one point per reading, `intervalSec` apart from `start`
 * (unix seconds), so the chart's own bucketing, scale and clock axis work unchanged on a post from someone else.
 */
export function hrChartProps(hr: RogoHrSeries, start: number): { points: WorkoutPointRow[]; start: number; end: number } {
  const points: WorkoutPointRow[] = [];
  hr.bpm.forEach((bpm, i) => {
    if (bpm !== null) points.push({ ts: start + i * hr.intervalSec, lat: null, lon: null, alt: null, hr: bpm });
  });
  return { points, start, end: start + hr.bpm.length * hr.intervalSec };
}

/** A shared route as `RouteView`'s `route` prop. */
export function routeViewPoints(route: RogoRoute): RoutePoint[] {
  return route.map(([lat, lon]) => ({ lat, lon }));
}
