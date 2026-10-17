/** Rounds to `decimals` places (0 for a whole number). */
export function round(value: number, decimals: number): number {
  const f = 10 ** decimals;
  return Math.round(value * f) / f;
}

/** `round` that passes null through. */
export function roundOrNull(value: number | null | undefined, decimals: number): number | null {
  return value === null || value === undefined || !Number.isFinite(value) ? null : round(value, decimals);
}
