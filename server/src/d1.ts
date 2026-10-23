/**
 * Cloudflare D1 limits that bite a statement built from variable-size input. Local SQLite (and tests that skip these
 * checks) accepts far more, so a statement that works locally can still fail in production with a 500.
 * See https://developers.cloudflare.com/d1/platform/limits/
 */

/** Bound parameters per statement; each statement of `db.batch([...])` is counted on its own. */
export const D1_MAX_PARAMS = 100;
/** Bytes of statement text. */
export const D1_MAX_STATEMENT_BYTES = 100_000;
/** Bytes of one string, blob or table row. */
export const D1_MAX_VALUE_BYTES = 2_000_000;
/** Bytes of a LIKE or GLOB pattern. */
export const D1_MAX_LIKE_PATTERN_BYTES = 50;

/** Splits `items` into consecutive slices of at most `size` items; an empty list gives no slices. */
export function chunk<T>(items: readonly T[], size: number): T[][] {
  if (!Number.isInteger(size) || size < 1) throw new RangeError(`chunk size must be a positive integer, got ${size}`);
  const slices: T[][] = [];
  for (let i = 0; i < items.length; i += size) slices.push(items.slice(i, i + size));
  return slices;
}

/**
 * Splits `items` into consecutive slices whose summed `weight` stays at most `max`, so one JSON bind parameter stays
 * under D1's value cap. An item heavier than `max` on its own gets a slice of its own (the caller must reject it).
 */
export function chunkByWeight<T>(items: readonly T[], weight: (item: T) => number, max: number): T[][] {
  const slices: T[][] = [];
  let current: T[] = [];
  let used = 0;
  for (const item of items) {
    const w = weight(item);
    if (current.length > 0 && used + w > max) {
      slices.push(current);
      current = [];
      used = 0;
    }
    current.push(item);
    used += w;
  }
  if (current.length > 0) slices.push(current);
  return slices;
}

const encoder = new TextEncoder();

/** UTF-8 size of a string, as D1 counts it. */
export function utf8Bytes(text: string): number {
  return encoder.encode(text).byteLength;
}
