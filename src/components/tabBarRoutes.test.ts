import { describe, expect, it } from 'bun:test';

import { isTabCurrent, MORE_ROUTE } from './tabBarRoutes';

describe('isTabCurrent', () => {
  it('marks the tab that is on screen', () => {
    expect(isTabCurrent('index', 'index')).toBe(true);
    expect(isTabCurrent('workouts', 'workouts')).toBe(true);
    expect(isTabCurrent(MORE_ROUTE, MORE_ROUTE)).toBe(true);
  });
  it('marks More while the Watch hub and the other screens reached from it are on screen', () => {
    for (const route of ['watch', 'routes', 'family', 'home-cards']) {
      expect(isTabCurrent(MORE_ROUTE, route)).toBe(true);
    }
  });
  it('does not mark any other tab for those screens', () => {
    for (const tab of ['index', 'workouts', 'social']) {
      expect(isTabCurrent(tab, 'watch')).toBe(false);
    }
  });
  it('leaves More unmarked on the other tabs and on screens pushed from Today', () => {
    expect(isTabCurrent(MORE_ROUTE, 'index')).toBe(false);
    expect(isTabCurrent(MORE_ROUTE, 'workouts')).toBe(false);
    expect(isTabCurrent(MORE_ROUTE, 'sleep')).toBe(false);
  });
  it('is not fooled by names on the object prototype', () => {
    expect(isTabCurrent(MORE_ROUTE, 'constructor')).toBe(false);
    expect(isTabCurrent(MORE_ROUTE, 'toString')).toBe(false);
  });
});
