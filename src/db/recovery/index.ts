import Storage from 'expo-sqlite/kv-store';
import { File } from 'expo-file-system';
import { defaultDatabaseDirectory, openDatabaseAsync } from 'expo-sqlite';
import { useSyncExternalStore } from 'react';

import { buildAppSchema, DATABASE_NAME } from '@/db/appSchema';
import { isDisconnectedByUser, setDisconnectedByUser } from '@/state/disconnectedByUser';
import { HuaweiWear, hasNative, nativeDatabaseControl, onNativeCallError } from '@/wear';

import { isCorruptionError } from './corruption';
import { holdQueries } from './gate';
import { createDbHealth, type DbHealthState } from './health';
import { watchNativeErrors } from './nativeErrors';
import { applyPendingSwap, quickCheck, recoverDatabase } from './recover';
import { recoveryEnv } from './env';
import { recordRepairLine, startRepairLog } from './repairLog';

/** How long a start waits for the quick check before it opens the app anyway; a check that is still running reports when it ends. */
const QUICK_CHECK_BUDGET_MS = 2000;

/** How long a step of stopping the native writers may take. */
const STEP_TIMEOUT_MS = 10_000;

/** The sizes of the database files at the start of a repair: a full phone is one way the repair fails. */
function logFileSizes(): void {
  for (const suffix of ['', '-wal', '-shm']) {
    try {
      const file = new File(`file://${defaultDatabaseDirectory}/${DATABASE_NAME}${suffix}`);
      recordRepairLine(`${DATABASE_NAME}${suffix}: ${file.exists ? `${file.size} bytes` : 'absent'}`);
    } catch (e) {
      recordRepairLine(`${DATABASE_NAME}${suffix}: size unknown (${e instanceof Error ? e.message : String(e)})`);
    }
  }
}

/**
 * Gets every native writer off `joyofit.db` for the time of a repair, and returns what lets them back. The Kotlin side opens the
 * file with a SQLite library of its own that does not wait for the app's locks, so anything it writes while the file is replaced
 * lands in the new file too: the foreground service is stopped, the watch link is closed (the sync, the Healthy Living data and
 * the Health Connect export all run on the link) and the app's own reconnect is held off, then the native connection itself is
 * closed on binaries that can (`releaseDatabase`). Each step is independent; a step that fails is logged and the next one runs.
 */
async function pauseNativeWriter(): Promise<() => Promise<void>> {
  startRepairLog();
  const resumes: (() => Promise<void>)[] = [];
  const step = async (what: string, run: () => Promise<void>): Promise<boolean> => {
    try {
      // A native call that never answers must not hold the repair (and its spinner) forever.
      await Promise.race([run(), new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`no answer after ${STEP_TIMEOUT_MS} ms`)), STEP_TIMEOUT_MS))]);
      recordRepairLine(`native writers: ${what}`);
      return true;
    } catch (e) {
      recordRepairLine(`native writers: ${what} failed: ${e instanceof Error ? e.message : String(e)}`);
      return false;
    }
  };

  const heldBefore = await isDisconnectedByUser();
  if (await step('app reconnect held off', () => setDisconnectedByUser(true))) {
    if (!heldBefore) resumes.unshift(() => setDisconnectedByUser(false));
  }
  let backgroundOwnsLink = false;
  if (hasNative('getBackgroundStatus') && hasNative('setBackgroundEnabled')) {
    const { enabled, address } = HuaweiWear.getBackgroundStatus();
    if (enabled && address !== null) {
      if (await step('background service stopped', () => HuaweiWear.setBackgroundEnabled(null))) {
        backgroundOwnsLink = true;
        resumes.unshift(() => HuaweiWear.setBackgroundEnabled(address));
      }
    }
  }
  if (hasNative('getState') && hasNative('disconnect') && HuaweiWear.getState() !== 'disconnected') {
    const connected = hasNative('getDevice') ? HuaweiWear.getDevice() : null;
    if (await step('watch link closed', () => HuaweiWear.disconnect()) && connected !== null && !backgroundOwnsLink) {
      // Without the service nothing else brings the link back after the repair.
      resumes.unshift(async () => {
        void HuaweiWear.connect(connected.address).catch(() => undefined);
      });
    }
  }
  const control = nativeDatabaseControl();
  if (control !== null && (await step('native connection closed', control.release))) resumes.unshift(control.resume);
  return async () => {
    for (const resume of resumes) await resume().catch((e: unknown) => recordRepairLine(`native writers: resume failed: ${e instanceof Error ? e.message : String(e)}`));
  };
}

export { isCorruptionError } from './corruption';
export type { DbHealthState, RepairNotice } from './health';

/**
 * The one repair coordinator of the app. Notes are kept in the key-value store (its own small database file, so a damaged
 * `joyofit.db` cannot take them with it).
 */
export const dbHealth = createDbHealth({
  recover: (options) => {
    logFileSizes();
    return recoverDatabase(recoveryEnv, DATABASE_NAME, options);
  },
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
  // The foreground service may already be running with its connection open: the file must not be replaced under it.
  const resume = await pauseNativeWriter().catch(() => null);
  try {
    recordRepairLine(`applying the prepared database ${prepared}`);
    await applyPendingSwap(recoveryEnv, DATABASE_NAME, prepared);
    recordRepairLine('prepared database swapped in');
    dbHealth.clearPendingSwap();
  } catch (e) {
    recordRepairLine(`swapping in the prepared database failed: ${e instanceof Error ? e.message : String(e)}`);
  } finally {
    await resume?.().catch(() => undefined);
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
          if (late === 'damaged') {
            recordRepairLine('late quick_check says the file is damaged');
            void dbHealth.repair();
          }
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
      recordRepairLine('start check: quick_check says the file is damaged');
    } catch (e) {
      if (!isCorruptionError(e)) throw e;
      recordRepairLine(`start check: building the schema met corruption: ${e instanceof Error ? e.message : String(e)}`);
    }
    onRepairing();
    const result = await dbHealth.repair({ canSwap: true });
    recordRepairLine(`repair finished: ${result.kind}${result.kind === 'failed' ? ` (${result.reason})` : ''}`);
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
