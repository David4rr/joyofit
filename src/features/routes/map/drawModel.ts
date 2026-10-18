/**
 * The state of the drawing screen: waypoints the user tapped, and between each pair a leg (the line from one to the next).
 * A leg starts as a straight segment and is replaced by the snapped geometry when the routing service answers; when it
 * fails, the straight segment stays. Waypoints are never dropped by a failure. Pure, so it runs under `bun test`.
 */
import { haversineM } from '@/features/routes/routeModel';

import type { LatLon } from '@/features/routes/map/geometry';

/** Heavy use is against the routing service's policy: one route is at most this many taps. */
export const MAX_WAYPOINTS = 150;

/** A tap closer than this to the last waypoint is a double tap, not a new point. */
const MIN_STEP_M = 3;

export type LegStatus =
  /** Straight segment shown dashed while the routing service is asked. */
  | 'pending'
  /** Geometry from the routing service. */
  | 'snapped'
  /** The user chose "Garis lurus" for this leg. */
  | 'straight'
  /** The routing service failed: a straight segment stands in. */
  | 'fallback';

export interface Leg {
  id: number;
  status: LegStatus;
  /** From the waypoint before to the waypoint after; at least two points. */
  points: readonly LatLon[];
}

export interface DrawState {
  waypoints: readonly LatLon[];
  /** `legs[i]` joins `waypoints[i]` to `waypoints[i + 1]`. */
  legs: readonly Leg[];
  nextLegId: number;
}

export const EMPTY_DRAW: DrawState = { waypoints: [], legs: [], nextLegId: 1 };

export type DrawAction =
  /** `routed`: ask the routing service for this leg (the leg is `pending` until it answers). */
  | { type: 'add'; point: LatLon; routed: boolean }
  | { type: 'resolve'; legId: number; points: readonly LatLon[] }
  | { type: 'fail'; legId: number }
  /** Drops the last waypoint and the leg that led to it. */
  | { type: 'undo' }
  | { type: 'clear' };

export type AddVerdict = 'ok' | 'full' | 'duplicate';

export function addVerdict(state: DrawState, point: LatLon): AddVerdict {
  if (state.waypoints.length >= MAX_WAYPOINTS) return 'full';
  const last = state.waypoints[state.waypoints.length - 1];
  if (last && haversineM(last, point) < MIN_STEP_M) return 'duplicate';
  return 'ok';
}

function replaceLeg(state: DrawState, legId: number, change: Pick<Leg, 'status'> & Partial<Pick<Leg, 'points'>>): DrawState {
  if (!state.legs.some((leg) => leg.id === legId)) return state;
  return { ...state, legs: state.legs.map((leg) => (leg.id === legId ? { ...leg, ...change } : leg)) };
}

export function drawReducer(state: DrawState, action: DrawAction): DrawState {
  switch (action.type) {
    case 'add': {
      if (addVerdict(state, action.point) !== 'ok') return state;
      const last = state.waypoints[state.waypoints.length - 1];
      const waypoints = [...state.waypoints, action.point];
      if (!last) return { ...state, waypoints };
      const leg: Leg = {
        id: state.nextLegId,
        status: action.routed ? 'pending' : 'straight',
        points: [last, action.point],
      };
      return { waypoints, legs: [...state.legs, leg], nextLegId: state.nextLegId + 1 };
    }
    case 'resolve':
      return replaceLeg(state, action.legId, { status: 'snapped', points: action.points });
    case 'fail':
      return replaceLeg(state, action.legId, { status: 'fallback' });
    case 'undo':
      if (state.waypoints.length === 0) return state;
      return { ...state, waypoints: state.waypoints.slice(0, -1), legs: state.legs.slice(0, -1) };
    case 'clear':
      return { ...EMPTY_DRAW, nextLegId: state.nextLegId };
  }
}

/** The whole line, legs joined; a point two legs share is kept once. */
export function linePoints(state: DrawState): LatLon[] {
  const line: LatLon[] = [];
  for (const leg of state.legs) {
    for (const point of leg.points) {
      const previous = line[line.length - 1];
      if (previous && previous.lat === point.lat && previous.lon === point.lon) continue;
      line.push(point);
    }
  }
  return line;
}

export function pendingLegs(state: DrawState): Leg[] {
  return state.legs.filter((leg) => leg.status === 'pending');
}

/** Whether any leg follows the routing service: the screen must credit OSRM / FOSSGIS then. */
export function usedRouting(state: DrawState): boolean {
  return state.legs.some((leg) => leg.status === 'snapped');
}
