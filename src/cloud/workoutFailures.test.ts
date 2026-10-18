import { describe, expect, it } from 'bun:test';

import { clearFailure, isFailed, noFailures, parseFailures, partitionPending, recordFailure } from './workoutFailures';

describe('workout failures', () => {
  it('refuses one state of one workout until its rev moves', () => {
    const failures = recordFailure(noFailures('1.0+1'), 100, 5, 'bad_doc: x');
    expect(isFailed(failures, 100, 5)).toBe(true);
    expect(isFailed(failures, 100, 6)).toBe(false);
    expect(isFailed(failures, 101, 5)).toBe(false);
    expect(failures.lastError).toBe('bad_doc: x');
  });

  it('survives a save and load, and is forgotten by another app build', () => {
    const failures = recordFailure(noFailures('1.0+1'), 100, 5, 'e');
    const raw = JSON.stringify(failures);
    expect(parseFailures(raw, '1.0+1')).toEqual(failures);
    expect(parseFailures(raw, '1.1+2')).toEqual(noFailures('1.1+2'));
    expect(parseFailures(null, '1.0+1')).toEqual(noFailures('1.0+1'));
    expect(parseFailures('not json', '1.0+1')).toEqual(noFailures('1.0+1'));
  });

  it('forgets a workout that uploaded after all, and its error with the last one', () => {
    const two = recordFailure(recordFailure(noFailures('b'), 1, 1, 'first'), 2, 1, 'second');
    expect(clearFailure(two, 1).items).toEqual({ 2: 1 });
    expect(clearFailure(two, 1).lastError).toBe('second');
    expect(clearFailure(clearFailure(two, 1), 2).lastError).toBeNull();
    expect(clearFailure(two, 9)).toBe(two);
  });

  it('splits pending workouts into the ones to send and the refused ones', () => {
    const failures = recordFailure(noFailures('b'), 2, 7, 'e');
    const pending = [
      { start: 3, rev: 1 },
      { start: 2, rev: 7 },
      { start: 1, rev: 1 },
      { start: 2, rev: 8 },
    ];
    const { todo, refused } = partitionPending(pending, failures);
    expect(refused).toEqual([{ start: 2, rev: 7 }]);
    expect(todo.map((p) => p.start)).toEqual([3, 1, 2]);
  });
});
