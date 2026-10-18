import { EMPTY_GEAR_DOC, mergeGearDocs, sameGearDoc, type GearDoc } from './model';

/** The server's answer to `GET /v1/gear`. */
export interface RemoteGear {
  rev: number;
  doc: GearDoc | null;
}

/** The four things a gear sync does to the outside, so the loop below runs under `bun test` without a database or a server. */
export interface GearSyncIo {
  fetchRemote: () => Promise<RemoteGear>;
  /** `PUT /v1/gear`: `conflict` is a stale `baseRev` (409), `locked` an account that is not Pro (402). Other failures throw. */
  putRemote: (baseRev: number, doc: GearDoc) => Promise<'ok' | 'conflict' | 'locked'>;
  readLocal: () => Promise<GearDoc>;
  writeLocal: (doc: GearDoc) => Promise<void>;
}

const MAX_ATTEMPTS = 3;

/**
 * Brings the phone and the cloud copy of the gear to one document: merge per record (newest edit wins), store what changed
 * here, then upload the result unless the cloud already has exactly it. A stale `baseRev` (another phone wrote in between)
 * is merged again with what is there now. Returns what happened. An account that is not Pro only reads: it still gets the
 * gear of a new phone, but its changes stay local.
 */
export async function syncGearDoc(io: GearSyncIo): Promise<'unchanged' | 'uploaded' | 'downloaded' | 'local-only'> {
  let changedHere = false;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const remote = await io.fetchRemote();
    const local = await io.readLocal();
    const merged = mergeGearDocs(local, remote.doc ?? EMPTY_GEAR_DOC);
    if (!sameGearDoc(merged, local)) {
      await io.writeLocal(merged);
      changedHere = true;
    }
    if (remote.doc === null ? merged.gear.length === 0 && merged.defaults.length === 0 && merged.assignments.length === 0 : sameGearDoc(merged, remote.doc)) {
      return changedHere ? 'downloaded' : 'unchanged';
    }
    const outcome = await io.putRemote(remote.rev, merged);
    if (outcome === 'ok') return 'uploaded';
    if (outcome === 'locked') return changedHere ? 'downloaded' : 'local-only';
  }
  throw new Error('gear changed on another phone too often'); // i18n-ok: logged, never shown
}
