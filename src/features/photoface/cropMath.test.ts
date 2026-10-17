import { describe, expect, test } from 'bun:test';

import { cropRect, initialView, isExactScreenSize } from './cropMath';

const screen = { width: 408, height: 480 };

describe('isExactScreenSize', () => {
  test('a picture of the screen size needs no crop', () => {
    expect(isExactScreenSize({ width: 408, height: 480 }, screen)).toBe(true);
  });

  test('any other size goes through the crop screen', () => {
    expect(isExactScreenSize({ width: 480, height: 408 }, screen)).toBe(false);
    expect(isExactScreenSize({ width: 409, height: 480 }, screen)).toBe(false);
    expect(isExactScreenSize({ width: 816, height: 960 }, screen)).toBe(false);
  });

  test('the full-frame crop of an exact-size picture would be the whole picture', () => {
    const image = { width: 408, height: 480 };
    expect(cropRect(initialView(image, screen), image, screen)).toEqual({ originX: 0, originY: 0, width: 408, height: 480 });
  });
});
