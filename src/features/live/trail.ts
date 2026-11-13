import { useState } from 'react';

import { haversineM } from '@/features/routes/routeModel';

export interface TrailPoint {
  lat: number;
  lon: number;
}

/** A fix closer than this (metres) to the last trail point is jitter, not movement. */
export const TRAIL_MIN_STEP_M = 6;
/** The trail never holds more points than this: past it every second point goes (the line keeps its shape, the GeoJSON stays small). */
export const TRAIL_MAX_POINTS = 1500;

/** `trail` with `point` added when it is a real step from the last point; the same array when it is not. */
export function appendTrail(trail: readonly TrailPoint[], point: TrailPoint): readonly TrailPoint[] {
  const last = trail[trail.length - 1];
  if (last && haversineM(last, point) < TRAIL_MIN_STEP_M) return trail;
  const next = [...trail, { lat: point.lat, lon: point.lon }];
  if (next.length <= TRAIL_MAX_POINTS) return next;
  return next.filter((_, index) => index % 2 === 0 || index === next.length - 1);
}

/** Converts GeoJSON `[lon, lat]` pairs from native `LiveWorkout.trail` into validated `TrailPoint`s. */
export function fromNativeTrail(nativeTrail?: readonly (readonly [number, number])[] | null): readonly TrailPoint[] {
  if (!nativeTrail || nativeTrail.length === 0) return [];
  const out: TrailPoint[] = [];
  for (const pair of nativeTrail) {
    if (!Array.isArray(pair) || pair.length < 2) continue;
    const lon = Number(pair[0]);
    const lat = Number(pair[1]);
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180) continue;
    out.push({ lat, lon });
  }
  return out;
}

/** The path a recording's position has taken since the workout started, for the line on the map. */
export function useTrail(
  position: TrailPoint | null,
  nativeTrail?: readonly (readonly [number, number])[] | null,
): readonly TrailPoint[] {
  const [trail, setTrail] = useState<readonly TrailPoint[]>(() => fromNativeTrail(nativeTrail));
  const nativeCount = nativeTrail?.length ?? 0;
  if (nativeCount > trail.length) {
    const recovered = fromNativeTrail(nativeTrail);
    if (recovered.length > trail.length) setTrail(recovered);
  }
  const lat = position?.lat;
  const lon = position?.lon;
  // Append when the position changes, during render, rather than from an effect.
  const [seen, setSeen] = useState<{ lat?: number; lon?: number }>({});
  if (seen.lat !== lat || seen.lon !== lon) {
    setSeen({ lat, lon });
    if (lat !== undefined && lon !== undefined) setTrail((old) => appendTrail(old, { lat, lon }));
  }
  return trail;
}
