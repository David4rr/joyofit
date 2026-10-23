import type { LatLon } from './tileMath';

const M_PER_DEG = 111_195;

/** Samples of the ride: one per second for 12 h 15 min. */
export const LONG_RIDE_POINTS = 44_100;

/**
 * A 12 h ride at 1 Hz: about 157 km out along a bending road (a bend every kilometre or so on top of the long curves, so a few
 * hundred metres between two samples cut corners) and back by a slightly different line (the two lines part over the 3 % of
 * the ride after the turn, so no fix jumps), 44 100 points, with GPS jitter of about a metre. `kmAt` holds the position of
 * each whole kilometre. For tests only.
 */
export function longRide() {
  const points: LatLon[] = [];
  const total = LONG_RIDE_POINTS;
  let seed = 7;
  const noise = () => {
    seed = (seed * 1_664_525 + 1_013_904_223) % 4_294_967_296;
    return (seed / 4_294_967_296 - 0.5) * 2;
  };
  for (let i = 0; i < total; i++) {
    const f = i / (total - 1);
    const out = f < 0.5;
    const u = out ? f * 2 : (1 - f) * 2; // 0..1 along the out leg
    const side = out ? 0 : 0.012 * Math.min(1, (f - 0.5) / 0.03);
    const lat = -7.3 + u * 0.34 + 0.03 * Math.sin(u * 5) + 0.00125 * Math.sin(u * 400) + side;
    const lon = 110.2 + u * 0.52 + 0.04 * Math.sin(u * 7) + side;
    points.push([lat + noise() * 0.000001, lon + noise() * 0.000001]);
  }
  const kmAt: { km: number; pos: LatLon }[] = [];
  let acc = 0;
  let next = 1;
  for (let i = 1; i < points.length; i++) {
    const [la0, lo0] = points[i - 1];
    const [la1, lo1] = points[i];
    acc += Math.hypot((la1 - la0) * M_PER_DEG, (lo1 - lo0) * M_PER_DEG * Math.cos((la1 * Math.PI) / 180));
    while (acc >= next * 1000) {
      kmAt.push({ km: next, pos: points[i] });
      next += 1;
    }
  }
  return { points, kmAt, km: acc / 1000 };
}
