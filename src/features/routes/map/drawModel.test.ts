import { describe, expect, test } from 'bun:test';

import {
  addVerdict,
  drawReducer,
  EMPTY_DRAW,
  linePoints,
  MAX_WAYPOINTS,
  pendingLegs,
  usedRouting,
  type DrawAction,
  type DrawState,
} from './drawModel';

const P1 = { lat: -7.98, lon: 112.63 };
const P2 = { lat: -7.97, lon: 112.64 };
const P3 = { lat: -7.96, lon: 112.65 };

function run(...actions: DrawAction[]): DrawState {
  return actions.reduce(drawReducer, EMPTY_DRAW);
}

describe('add', () => {
  test('the first waypoint makes no leg', () => {
    const state = run({ type: 'add', point: P1, routed: true });
    expect(state.waypoints).toEqual([P1]);
    expect(state.legs).toEqual([]);
  });

  test('every next waypoint adds a leg from the previous one: pending when routed, straight when not', () => {
    const state = run(
      { type: 'add', point: P1, routed: false },
      { type: 'add', point: P2, routed: true },
      { type: 'add', point: P3, routed: false },
    );
    expect(state.waypoints).toEqual([P1, P2, P3]);
    expect(state.legs.map((leg) => [leg.status, leg.points])).toEqual([
      ['pending', [P1, P2]],
      ['straight', [P2, P3]],
    ]);
    expect(new Set(state.legs.map((leg) => leg.id)).size).toBe(2);
  });

  test('a tap within 3 m of the last waypoint is ignored', () => {
    const near = { lat: P1.lat + 0.00001, lon: P1.lon };
    expect(addVerdict(run({ type: 'add', point: P1, routed: false }), near)).toBe('duplicate');
    const state = run({ type: 'add', point: P1, routed: false }, { type: 'add', point: near, routed: true });
    expect(state.waypoints).toHaveLength(1);
  });

  test('stops at the waypoint limit', () => {
    let state = EMPTY_DRAW;
    for (let i = 0; i < MAX_WAYPOINTS + 5; i++) {
      state = drawReducer(state, { type: 'add', point: { lat: 0, lon: i * 0.001 }, routed: false });
    }
    expect(state.waypoints).toHaveLength(MAX_WAYPOINTS);
    expect(addVerdict(state, { lat: 5, lon: 5 })).toBe('full');
  });
});

describe('resolve and fail', () => {
  const pending = run({ type: 'add', point: P1, routed: true }, { type: 'add', point: P2, routed: true });
  const legId = pending.legs[0].id;
  const snapped = [P1, { lat: -7.975, lon: 112.63 }, P2];

  test('resolve swaps the straight segment for the snapped geometry', () => {
    const state = drawReducer(pending, { type: 'resolve', legId, points: snapped });
    expect(state.legs[0]).toMatchObject({ status: 'snapped', points: snapped });
    expect(pendingLegs(state)).toHaveLength(0);
    expect(usedRouting(state)).toBe(true);
  });

  test('fail keeps the straight segment and every waypoint', () => {
    const state = drawReducer(pending, { type: 'fail', legId });
    expect(state.legs[0]).toMatchObject({ status: 'fallback', points: [P1, P2] });
    expect(state.waypoints).toEqual([P1, P2]);
    expect(usedRouting(state)).toBe(false);
  });

  test('an answer for a leg that was undone changes nothing', () => {
    const undone = drawReducer(pending, { type: 'undo' });
    expect(drawReducer(undone, { type: 'resolve', legId, points: snapped })).toBe(undone);
    expect(drawReducer(undone, { type: 'fail', legId })).toBe(undone);
  });

  test('an answer for a leg that was cleared changes nothing, even after new legs', () => {
    const cleared = drawReducer(pending, { type: 'clear' });
    const again = drawReducer(
      drawReducer(cleared, { type: 'add', point: P1, routed: true }),
      { type: 'add', point: P2, routed: true },
    );
    expect(again.legs[0].id).not.toBe(legId);
    expect(drawReducer(again, { type: 'resolve', legId, points: snapped })).toBe(again);
  });
});

describe('undo and clear', () => {
  test('undo drops the last waypoint and the leg that led to it', () => {
    const state = run(
      { type: 'add', point: P1, routed: false },
      { type: 'add', point: P2, routed: false },
      { type: 'add', point: P3, routed: false },
      { type: 'undo' },
    );
    expect(state.waypoints).toEqual([P1, P2]);
    expect(state.legs).toHaveLength(1);
  });

  test('undo down to nothing, and past it', () => {
    const state = run({ type: 'add', point: P1, routed: false }, { type: 'undo' }, { type: 'undo' });
    expect(state.waypoints).toEqual([]);
    expect(state.legs).toEqual([]);
  });

  test('clear empties everything', () => {
    const state = run({ type: 'add', point: P1, routed: false }, { type: 'add', point: P2, routed: false }, { type: 'clear' });
    expect(state.waypoints).toEqual([]);
    expect(state.legs).toEqual([]);
  });
});

describe('linePoints', () => {
  test('joins the legs and keeps a shared point once', () => {
    const state = run(
      { type: 'add', point: P1, routed: false },
      { type: 'add', point: P2, routed: false },
      { type: 'add', point: P3, routed: false },
    );
    expect(linePoints(state)).toEqual([P1, P2, P3]);
  });

  test('uses snapped geometry where a leg has it', () => {
    const mid = { lat: -7.975, lon: 112.63 };
    let state = run({ type: 'add', point: P1, routed: true }, { type: 'add', point: P2, routed: true });
    state = drawReducer(state, { type: 'resolve', legId: state.legs[0].id, points: [P1, mid, P2] });
    expect(linePoints(state)).toEqual([P1, mid, P2]);
  });

  test('no line for fewer than two waypoints', () => {
    expect(linePoints(EMPTY_DRAW)).toEqual([]);
    expect(linePoints(run({ type: 'add', point: P1, routed: false }))).toEqual([]);
  });
});
