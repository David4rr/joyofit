import Storage from 'expo-sqlite/kv-store';
import { openDatabaseAsync } from 'expo-sqlite';
import { useSyncExternalStore } from 'react';

import { buildAppSchema, DATABASE_NAME } from '@/db/appSchema';
import { HuaweiWear, hasNative, onNativeCallError } from '@/wear';

import { isCorruptionError } from './corruption';
import { holdQueries } from './gate';
import { createDbHealth, type DbHealthState } from './health';
import { watchNativeErrors } from './nativeErrors';
import { applyPendingSwap, quickCheck, recoverDatabase } from './recover';
import { recoveryEnv } from './env';

/** How long a start waits for the quick check before it opens the app anyway; a check that is still running reports when it ends. */
const QUICK_CHECK_BUDGET_MS = 2000;

/**
 * Stops the foreground service of the watch link (the native writer and its connection are in that process) for the time of a
 * repair and starts it again for the same watch afterwards. Nothing to stop on a binary without the service or with background
 * mode off.
 */
async function pauseNativeWriter(): Promise<() => Promise<void>> {
  if (!hasNative('getBackgroundStatus') || !hasNative('setBackgroundEnabled')) return async () => {};
  const { enabled, address } = HuaweiWear.getBackgroundStatus();
  if (!enabled || address === null) return async () => {};
  await HuaweiWear.setBackgroundEnabled(null);
  return () => HuaweiWear.setBackgroundEnabled(address);
}

export { isCorruptionError } from './corruption';
export type { DbHealthState, RepairNotice } from './health';

/**
 * The one repair coordinator of the app. Notes are kept in the key-value store (its own small database file, so a damaged
 * `joyofit.db` cannot take them with it).
 */
export const dbHealth = createDbHealth({
  recover: (options) => recoverDatabase(recoveryEnv, DATABASE_NAME, options),
  hold: holdQueries,
  quiesce: pauseNativeWriter,
  storage: {
    get: (key) => Storage.getItemSync(key),
    set: (key, value) => (value === null ? Storage.removeItemSync(key) : Storage.setItemSync(key, value)),
  },
  now: () => Date.now(),
});

/** Hands the status of the repair (running, or the notice to show) to a component. */
export function useDbHealth(): DbHealthState {
  return useSyncExternalStore(dbHealth.subscribe, dbHealth.getState);
}

/** Tells the repair about an error from a query or from the native writer; only corruption starts anything. */
export const reportDatabaseError = (error: unknown): void => dbHealth.report(error);

/**
 * At a start, before anything opens `joyofit.db`: puts in the database a repair prepared but could not swap in. Nothing here
 * throws; when it cannot, the marker stays and the next start tries again.
 */
async function applyPendingDatabaseSwap(): Promise<void> {
  const prepared = dbHealth.pendingSwap();
  if (prepared === null) return;
  try {
    await applyPendingSwap(recoveryEnv, DATABASE_NAME, prepared);
    dbHealth.clearPendingSwap();
  } catch {
    // Kept for the next start.
  }
}

/**
 * The schema, on a connection of its own that is closed again: what opening the database used to do on the app's handle. With
 * `check` it then runs `PRAGMA quick_check`, because building the schema reads only a few pages and a file whose damage is
 * elsewhere opens fine (the native writer meets it later, on its own reads). True when nothing is wrong or the check could not
 * say; false when the file is damaged. A check that outlasts `QUICK_CHECK_BUDGET_MS` lets the app open and starts the repair
 * itself when it ends damaged (no file swap then: the app's handle is open by that time).
 */
async function buildSchemaOnce(check: boolean): Promise<boolean> {
  const db = await openDatabaseAsync(DATABASE_NAME, { useNewConnection: true });
  let closeNow = true;
  try {
    await buildAppSchema(db);
    if (!check) return true;
    await db.execAsync('PRAGMA busy_timeout = 5000');
    const verdict = quickCheck(db);
    const budget = new Promise<'late'>((resolve) => setTimeout(() => resolve('late'), QUICK_CHECK_BUDGET_MS));
    const first = await Promise.race([verdict, budget]);
    if (first === 'late') {
      closeNow = false;
      void verdict
        .then(async (late) => {
          await db.closeAsync().catch(() => undefined);
          if (late === 'damaged') void dbHealth.repair();
        })
        .catch(() => undefined);
      return true;
    }
    return first !== 'damaged';
  } finally {
    if (closeNow) await db.closeAsync().catch(() => undefined);
  }
}

/**
 * Gets `joyofit.db` ready before the app's handle opens it: finishes a swap a repair left for this start, builds the schema,
 * and when that or the quick check says the file is damaged runs the repair once and builds again. `SQLiteProvider` cannot do
 * this itself: after a failed open it keeps the failed promise and every remount gets the same error. False when the file is
 * still unusable after the repair (the notice says what happened); any other error is thrown as it was.
 */
export async function prepareDatabase(onRepairing: () => void): Promise<boolean> {
  await applyPendingDatabaseSwap();
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      // After a repair the second pass only builds the schema: the repair ran the full integrity check already.
      if (await buildSchemaOnce(attempt === 0)) return true;
    } catch (e) {
      if (!isCorruptionError(e)) throw e;
    }
    onRepairing();
    const result = await dbHealth.repair({ canSwap: true });
    if (result.kind === 'failed') return false;
  }
  return false;
}

/**
 * Sends every corruption error of the native writer to the repair, from the calls that fail and from the events it emits;
 * returns the function that stops it. The Kotlin side meets a damaged file before JS does (JS opens fine while the damage is in
 * pages it does not read), so this is the other half of the start check.
 */
export function startNativeErrorWatch(): () => void {
  return watchNativeErrors({ addListener: (event, listener) => HuaweiWear.addListener(event, listener), onCallError: onNativeCallError }, reportDatabaseError);
}
