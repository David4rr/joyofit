import { describe, expect, it } from 'bun:test';

import { EMPTY_GEAR_DOC, type GearDoc } from './model';
import { syncGearDoc, type GearSyncIo, type RemoteGear } from './syncDoc';

const shoe = (id: string, updatedAt: number, name = id) => ({
  id,
  kind: 'shoes' as const,
  name,
  brand: null,
  model: null,
  startDistanceM: 0,
  retireAtM: null,
  stravaGearId: null,
  stravaGearName: null,
  retiredAt: null,
  createdAt: 1,
  updatedAt,
  deletedAt: null,
  notified: 0 as const,
});
const doc = (...gear: ReturnType<typeof shoe>[]): GearDoc => ({ ...EMPTY_GEAR_DOC, gear });

function fake(local: GearDoc, remotes: RemoteGear[], outcome: (baseRev: number) => 'ok' | 'conflict' | 'locked' = () => 'ok') {
  const calls = { put: [] as { baseRev: number; doc: GearDoc }[], written: [] as GearDoc[] };
  let stored = local;
  let fetched = 0;
  const io: GearSyncIo = {
    fetchRemote: async () => remotes[Math.min(fetched++, remotes.length - 1)]!,
    putRemote: async (baseRev, d) => {
      calls.put.push({ baseRev, doc: d });
      return outcome(baseRev);
    },
    readLocal: async () => stored,
    writeLocal: async (d) => {
      stored = d;
      calls.written.push(d);
    },
  };
  return { io, calls };
}

describe('syncGearDoc', () => {
  it('does nothing when both sides are empty or equal', async () => {
    const empty = fake(EMPTY_GEAR_DOC, [{ rev: 0, doc: null }]);
    expect(await syncGearDoc(empty.io)).toBe('unchanged');
    expect(empty.calls.put).toEqual([]);
    const same = fake(doc(shoe('a', 1)), [{ rev: 4, doc: doc(shoe('a', 1)) }]);
    expect(await syncGearDoc(same.io)).toBe('unchanged');
    expect(same.calls.put).toEqual([]);
  });

  it('uploads local gear to an empty cloud at rev 0', async () => {
    const t = fake(doc(shoe('a', 1)), [{ rev: 0, doc: null }]);
    expect(await syncGearDoc(t.io)).toBe('uploaded');
    expect(t.calls.put).toHaveLength(1);
    expect(t.calls.put[0]?.baseRev).toBe(0);
  });

  it('restores the cloud gear on a new phone without uploading it back', async () => {
    const t = fake(EMPTY_GEAR_DOC, [{ rev: 3, doc: doc(shoe('a', 1)) }]);
    expect(await syncGearDoc(t.io)).toBe('downloaded');
    expect(t.calls.written[0]?.gear.map((g) => g.id)).toEqual(['a']);
    expect(t.calls.put).toEqual([]);
  });

  it('merges both sides and uploads the union against the rev it read', async () => {
    const t = fake(doc(shoe('a', 1), shoe('b', 5, 'local')), [{ rev: 7, doc: doc(shoe('b', 2, 'remote'), shoe('c', 1)) }]);
    expect(await syncGearDoc(t.io)).toBe('uploaded');
    expect(t.calls.put[0]?.baseRev).toBe(7);
    expect(t.calls.put[0]?.doc.gear.map((g) => [g.id, g.name])).toEqual([['a', 'a'], ['b', 'local'], ['c', 'c']]);
    expect(t.calls.written).toHaveLength(1);
  });

  it('merges again with what is there when the rev was stale', async () => {
    const t = fake(
      doc(shoe('a', 2)),
      [
        { rev: 1, doc: doc(shoe('a', 1)) },
        { rev: 2, doc: doc(shoe('a', 1), shoe('x', 9)) },
      ],
      (baseRev) => (baseRev === 1 ? 'conflict' : 'ok'),
    );
    expect(await syncGearDoc(t.io)).toBe('uploaded');
    expect(t.calls.put.map((c) => c.baseRev)).toEqual([1, 2]);
    expect(t.calls.put[1]?.doc.gear.map((g) => g.id)).toEqual(['a', 'x']);
  });

  it('keeps changes local for an account that is not Pro, but still takes the cloud copy', async () => {
    const t = fake(doc(shoe('a', 5)), [{ rev: 2, doc: doc(shoe('b', 1)) }], () => 'locked');
    expect(await syncGearDoc(t.io)).toBe('downloaded');
    expect(t.calls.written[0]?.gear.map((g) => g.id)).toEqual(['a', 'b']);
    const quiet = fake(doc(shoe('a', 5)), [{ rev: 0, doc: null }], () => 'locked');
    expect(await syncGearDoc(quiet.io)).toBe('local-only');
  });

  it('gives up after repeated conflicts', async () => {
    const always = fake(doc(shoe('a', 5)), [{ rev: 1, doc: doc(shoe('a', 1)) }], () => 'conflict');
    await expect(syncGearDoc(always.io)).rejects.toThrow();
    expect(always.calls.put).toHaveLength(3);
  });
});
