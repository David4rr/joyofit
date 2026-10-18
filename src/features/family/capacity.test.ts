import { describe, expect, test } from 'bun:test';

import type { FamilyLimits } from '@/cloud/family';
import { allowedRange, watchCapacity } from '@/features/family/capacity';

const FREE: FamilyLimits = { pro: false, maxWatching: 1, maxWatchers: 2, historyDays: 30 };
const PRO: FamilyLimits = { pro: true, maxWatching: 5, maxWatchers: 5, historyDays: 90 };

describe('watchCapacity', () => {
  test('a free account can watch one person, then is offered Pro', () => {
    expect(watchCapacity(FREE, 0)).toBe('ok');
    expect(watchCapacity(FREE, 1)).toBe('pro');
  });

  test('Pro takes five, then it is simply full', () => {
    expect(watchCapacity(PRO, 4)).toBe('ok');
    expect(watchCapacity(PRO, 5)).toBe('full');
  });

  test('unknown limits refuse nothing', () => {
    expect(watchCapacity(null, 3)).toBe('ok');
  });
});

describe('allowedRange', () => {
  test('a free account keeps 30 days, so 90 is cut back to 30', () => {
    expect(allowedRange(FREE, 7)).toBe(7);
    expect(allowedRange(FREE, 30)).toBe(30);
    expect(allowedRange(FREE, 90)).toBe(30);
  });

  test('Pro keeps 90', () => {
    expect(allowedRange(PRO, 90)).toBe(90);
    expect(allowedRange(PRO, 30)).toBe(30);
  });

  test('a short history cuts every range to the shortest', () => {
    expect(allowedRange({ ...FREE, historyDays: 7 }, 90)).toBe(7);
    expect(allowedRange(null, 90)).toBe(7);
  });
});
