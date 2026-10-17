import { describe, expect, test } from 'bun:test';

import { RequestError } from './http';
import { rejectionOf } from './testSupport';
import { createThrottle } from './throttle';

/** A clock that only moves when something sleeps. */
function fakeClock() {
  let time = 0;
  return {
    now: () => time,
    sleep: async (ms: number) => {
      time += ms;
    },
  };
}

describe('createThrottle', () => {
  test('starts tasks at least minIntervalMs apart', async () => {
    const clock = fakeClock();
    const throttle = createThrottle({ minIntervalMs: 1100, ...clock });
    const starts: number[] = [];
    const task = async () => {
      starts.push(clock.now());
    };
    await Promise.all([throttle(task), throttle(task), throttle(task)]);
    expect(starts).toEqual([0, 1100, 2200]);
  });

  test('does not wait when the last task started long ago', async () => {
    const clock = fakeClock();
    const throttle = createThrottle({ minIntervalMs: 1100, ...clock });
    const starts: number[] = [];
    await throttle(async () => void starts.push(clock.now()));
    await clock.sleep(5000);
    await throttle(async () => void starts.push(clock.now()));
    expect(starts).toEqual([0, 5000]);
  });

  test('runs one task at a time, in order, and passes results and errors through', async () => {
    const clock = fakeClock();
    const throttle = createThrottle({ minIntervalMs: 0, ...clock });
    const order: string[] = [];
    const first = throttle(async () => {
      order.push('first');
      return 1;
    });
    const second = throttle(async () => {
      order.push('second');
      throw new Error('boom');
    });
    const third = throttle(async () => {
      order.push('third');
      return 3;
    });
    expect(await first).toBe(1);
    await expect(second).rejects.toThrow('boom');
    expect(await third).toBe(3);
    expect(order).toEqual(['first', 'second', 'third']);
  });

  test('a task aborted in the queue rejects at once and does not use up a slot', async () => {
    const clock = fakeClock();
    const throttle = createThrottle({ minIntervalMs: 1100, ...clock });
    const starts: number[] = [];
    const { promise: release, resolve } = Promise.withResolvers<void>();
    const running = throttle(async () => {
      starts.push(clock.now());
      await release;
    });

    const controller = new AbortController();
    const queued = throttle(async () => void starts.push(-1), controller.signal);
    const rejection = rejectionOf(queued);
    controller.abort();
    expect(await rejection).toMatchObject({ kind: 'aborted' });

    const later = throttle(async () => void starts.push(clock.now()));
    resolve();
    await Promise.all([running, later]);
    expect(starts).toEqual([0, 1100]);
  });

  test('an already aborted signal never starts the task', async () => {
    const throttle = createThrottle({ minIntervalMs: 0, ...fakeClock() });
    const controller = new AbortController();
    controller.abort();
    let ran = false;
    await expect(
      throttle(async () => {
        ran = true;
      }, controller.signal),
    ).rejects.toBeInstanceOf(RequestError);
    expect(ran).toBe(false);
  });
});
