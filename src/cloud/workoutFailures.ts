/**
 * Workouts the cloud refused as a document (400, or too big even alone), kept in `cloud_state` so they are not sent
 * again on every run. A refused workout waits until it changes (its `rev` moves) or the app is a different build,
 * because an app update is what can change the document.
 */
export interface WorkoutFailures {
  /** App build the failures were recorded by; failures of another build are forgotten. */
  build: string;
  /** `start` to the local `rev` that was refused. */
  items: Record<string, number>;
  lastError: string | null;
}

export const noFailures = (build: string): WorkoutFailures => ({ build, items: {}, lastError: null });

export function parseFailures(raw: string | null, build: string): WorkoutFailures {
  if (!raw) return noFailures(build);
  try {
    const value = JSON.parse(raw) as Partial<WorkoutFailures> | null;
    if (value?.build !== build || typeof value.items !== 'object' || value.items === null) return noFailures(build);
    return { build, items: value.items, lastError: typeof value.lastError === 'string' ? value.lastError : null };
  } catch {
    return noFailures(build);
  }
}

export function recordFailure(failures: WorkoutFailures, start: number, rev: number, message: string): WorkoutFailures {
  return { ...failures, items: { ...failures.items, [start]: rev }, lastError: message };
}

/** The workout uploaded after all, or is gone: it is no longer a failure. */
export function clearFailure(failures: WorkoutFailures, start: number): WorkoutFailures {
  if (!(start in failures.items)) return failures;
  const { [start]: _removed, ...items } = failures.items;
  return { ...failures, items, lastError: Object.keys(items).length === 0 ? null : failures.lastError };
}

/** The cloud refused this very state of the workout. */
export function isFailed(failures: WorkoutFailures, start: number, rev: number): boolean {
  return failures.items[start] === rev;
}

/** Pending workouts split into the ones to send and the ones the cloud refused in their current state. */
export function partitionPending<T extends { start: number; rev: number }>(
  pending: readonly T[],
  failures: WorkoutFailures,
): { todo: T[]; refused: T[] } {
  const todo: T[] = [];
  const refused: T[] = [];
  for (const p of pending) (isFailed(failures, p.start, p.rev) ? refused : todo).push(p);
  return { todo, refused };
}
