import { EMPTY_COACH_DOC, type CoachDoc } from './doc';
import { mergeCoachDocs, sameCoachDoc } from './merge';

/** The answer of JoyoRogo's `coach.getDoc`. */
export interface RemoteCoach {
  rev: number;
  doc: CoachDoc | null;
}

/** `coach.putDoc`: `conflict` is a stale `baseRev`, `locked` an account that is not Pro. */
export type PutResult = { status: 'ok'; rev: number } | { status: 'conflict'; rev: number; doc: CoachDoc | null } | { status: 'locked' };

export interface CoachSyncIo {
  fetchRemote: () => Promise<RemoteCoach>;
  putRemote: (baseRev: number, doc: CoachDoc) => Promise<PutResult>;
  readLocal: () => Promise<CoachDoc>;
  writeLocal: (doc: CoachDoc) => Promise<void>;
}

const MAX_ATTEMPTS = 3;

const isEmpty = (doc: CoachDoc): boolean => doc.plan === null && doc.planUpdatedAt === 0 && Object.keys(doc.done).length === 0 && Object.keys(doc.logs).length === 0;

/**
 * Brings the phone and the cloud copy of the coach document to one document: merge (`mergeCoachDocs`), store what
 * changed here, then upload unless the cloud already has exactly the result. A stale `baseRev` (another phone wrote in
 * between) is merged again with what is there now. An account that is not Pro only reads: a new phone still gets the plan,
 * but changes stay local.
 */
export async function syncCoachDoc(io: CoachSyncIo): Promise<'unchanged' | 'uploaded' | 'downloaded' | 'local-only'> {
  let changedHere = false;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const remote = await io.fetchRemote();
    const local = await io.readLocal();
    const merged = mergeCoachDocs(local, remote.doc ?? EMPTY_COACH_DOC);
    if (!sameCoachDoc(merged, local)) {
      await io.writeLocal(merged);
      changedHere = true;
    }
    if (remote.doc === null ? isEmpty(merged) : sameCoachDoc(merged, remote.doc)) return changedHere ? 'downloaded' : 'unchanged';
    const outcome = await io.putRemote(remote.rev, merged);
    if (outcome.status === 'ok') return 'uploaded';
    if (outcome.status === 'locked') return changedHere ? 'downloaded' : 'local-only';
  }
  throw new Error('coach plan changed on another phone too often'); // i18n-ok: logged, never shown
}

