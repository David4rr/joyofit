import { describe, expect, it } from 'bun:test';

import { MIN_QUALIFYING_RUNS, predictRaces, riegel, type RacePrediction } from './racePredictor';

const run5k = { '5k': 1500 };
const three = [run5k, { '5k': 1560 }, { '5k': 1620 }];
const ok = (r: ReturnType<typeof predictRaces>): RacePrediction[] => {
  if (r.kind !== 'ok') throw new Error('expected ok');
  return r.predictions;
};

describe('riegel', () => {
  it('is T x (D2/D1)^1.06: 5K in 25:00 gives 10K in 52:07', () => {
    expect(riegel(1500, 5000, 10000)).toBeCloseTo(1500 * 2 ** 1.06, 6);
    expect(Math.round(riegel(1500, 5000, 10000))).toBe(3127);
    expect(riegel(1500, 5000, 5000)).toBe(1500);
  });
});

describe('predictRaces', () => {
  it('needs 3 runs with a 5 km effort', () => {
    expect(predictRaces([])).toEqual({ kind: 'short', runs: 0, need: MIN_QUALIFYING_RUNS });
    expect(predictRaces([run5k, run5k])).toEqual({ kind: 'short', runs: 2, need: 3 });
    expect(predictRaces([run5k, run5k, { '1k': 240 }])).toEqual({ kind: 'short', runs: 2, need: 3 });
    expect(predictRaces(three).kind).toBe('ok');
  });

  it('projects from the best 5K and returns it for 5K itself', () => {
    const p = ok(predictRaces(three));
    expect(p.map((x) => x.key)).toEqual(['5k', '10k', 'half', 'full']);
    expect(p[0].seconds).toBe(1500);
    expect(p[1].seconds).toBe(Math.round(riegel(1500, 5000, 10000)));
    expect(p[3].seconds).toBe(Math.round(riegel(1500, 5000, 42195)));
    expect(p.every((x) => x.basedOn === '5k')).toBe(true);
  });

  it('uses the base closest to each target', () => {
    const runs = [{ '5k': 1500, '10k': 3100, half: 6900 }, run5k, run5k];
    const p = ok(predictRaces(runs));
    expect(p.find((x) => x.key === '5k')?.basedOn).toBe('5k');
    expect(p.find((x) => x.key === '10k')?.basedOn).toBe('10k');
    expect(p.find((x) => x.key === '10k')?.seconds).toBe(3100);
    expect(p.find((x) => x.key === 'half')?.basedOn).toBe('half');
    expect(p.find((x) => x.key === 'full')?.basedOn).toBe('half');
    expect(p.find((x) => x.key === 'full')?.seconds).toBe(Math.round(riegel(6900, 21097.5, 42195)));
  });

  it('takes the fastest time over the runs for each base', () => {
    const p = ok(predictRaces([{ '5k': 1600 }, { '5k': 1480 }, { '5k': 1550 }]));
    expect(p[0].seconds).toBe(1480);
  });

  it('skips targets whose base is more than 10x shorter or 5x longer', () => {
    // 5K base only: marathon is 8.4x, within the limit. A half-only base would reach 5K only through a 4.2x shortening.
    expect(ok(predictRaces(three)).length).toBe(4);
    const halfOnly = ok(predictRaces([{ '5k': 1500, half: 6900 }, { '5k': 1500 }, { '5k': 1500 }]));
    expect(halfOnly.map((x) => x.key)).toContain('full');
  });

  it('ignores zero and missing efforts', () => {
    expect(predictRaces([{ '5k': 0 }, { '5k': 0 }, { '5k': 0 }]).kind).toBe('short');
  });
});
