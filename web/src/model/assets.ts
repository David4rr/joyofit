import { surfaceToPng, type Surface } from "@/render/canvas";
import type { AssetImage } from "@/render/shapes";

/**
 * Uploaded images (photo backgrounds, stickers, custom hands). Blobs live in IndexedDB so a project
 * survives a reload without bloating localStorage; elements only hold an asset id. The decoded bitmaps
 * are cached here for the renderer.
 *
 * Lifecycle: only assets the open project references are decoded at start (`loadProjectAssets`); everything else in
 * IndexedDB is deleted, but only by the one document that holds the exclusive Web Lock `joyofit-studio-assets` (it queues for it, so a
 * reloading page waits for the old document to unload), from the state live when the lock is granted (open project, undo history,
 * saved project), and never when the saved project did not restore or the lock API is missing. When a project is replaced, `retainAssets` keeps what the open project and its undo history
 * still use, deletes the rest from IndexedDB and closes their bitmaps. Artwork drawn by code (template dials) stays in
 * memory until a project that uses it is opened, so previewing a template stores nothing.
 */
export interface AssetRecord {
  id: string;
  name: string;
  type: string;
  blob: Blob;
}

interface Loaded {
  record: AssetRecord;
  image: AssetImage;
  /** True when the record is in IndexedDB. */
  persisted: boolean;
}

const DB_NAME = "joyofit-studio";
const STORE = "assets";
const loaded = new Map<string, Loaded>();
const listeners = new Set<() => void>();
let version = 0;

function bump(): void {
  version++;
  for (const l of listeners) l();
}

export function subscribeAssets(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function assetsVersion(): number {
  return version;
}

function openDb(): Promise<IDBDatabase> {
  const { promise, resolve, reject } = Promise.withResolvers<IDBDatabase>();
  const req = indexedDB.open(DB_NAME, 1);
  req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: "id" });
  req.onsuccess = () => resolve(req.result);
  req.onerror = () => reject(req.error);
  return promise;
}

async function idb<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb();
  try {
    const { promise, resolve, reject } = Promise.withResolvers<T>();
    const req = run(db.transaction(STORE, mode).objectStore(STORE));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    return await promise;
  } finally {
    db.close();
  }
}

export function getAsset(id: string | null): AssetImage | null {
  return id ? (loaded.get(id)?.image ?? null) : null;
}

export function getAssetRecord(id: string): AssetRecord | null {
  return loaded.get(id)?.record ?? null;
}

/** Frees the pixels of a decoded bitmap. Canvases and the test images have nothing to free. */
function release(image: AssetImage): void {
  if ("close" in image.source) image.source.close();
}

async function decode(record: AssetRecord, persisted: boolean): Promise<void> {
  const bitmap = await createImageBitmap(record.blob);
  const previous = loaded.get(record.id);
  loaded.set(record.id, { record, image: { width: bitmap.width, height: bitmap.height, source: bitmap }, persisted });
  if (previous) release(previous.image);
}

/** Scales the longest side down to `maxSide` and re-encodes: JPEG for photos, PNG where transparency matters. */
async function normalise(file: Blob, maxSide: number, keepAlpha: boolean): Promise<{ blob: Blob; type: string }> {
  const bitmap = await createImageBitmap(file);
  try {
    const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
    const w = Math.max(1, Math.round(bitmap.width * scale));
    const h = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = new OffscreenCanvas(w, h);
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("2D canvas is not available");
    if (!keepAlpha) {
      ctx.fillStyle = "#000";
      ctx.fillRect(0, 0, w, h);
    }
    ctx.drawImage(bitmap, 0, 0, w, h);
    const type = keepAlpha ? "image/png" : "image/jpeg";
    return { blob: await canvas.convertToBlob({ type, quality: 0.9 }), type };
  } finally {
    bitmap.close();
  }
}

export async function addAssetFromFile(file: File, kind: "photo" | "sprite"): Promise<string> {
  const { blob, type } = await normalise(file, kind === "photo" ? 1600 : 1024, kind === "sprite");
  const record: AssetRecord = { id: crypto.randomUUID(), name: file.name, type, blob };
  await idb("readwrite", (s) => s.put(record));
  await decode(record, true);
  bump();
  return record.id;
}

const LOCK_NAME = "joyofit-studio-assets";
/** True once this tab holds the exclusive lock: only then may it delete stored records another tab could still use. */
let ownsStore = false;

/** The part of `navigator.locks` this module uses, so tests can stand in for it. */
export interface AssetLocks {
  request(name: string, callback: (lock: object) => Promise<unknown>): Promise<unknown>;
}

/** Where the stored records live; IndexedDB in the browser, a stand-in in tests. */
export interface AssetStore {
  keys(): Promise<string[]>;
  get(id: string): Promise<AssetRecord | undefined>;
  delete(id: string): Promise<void>;
}

const idbStore: AssetStore = {
  keys: async () => (await idb<IDBValidKey[]>("readonly", (s) => s.getAllKeys())).map(String),
  get: (id) => idb<AssetRecord | undefined>("readonly", (s) => s.get(id)),
  delete: async (id) => {
    await idb("readwrite", (s) => s.delete(id));
  },
};

export interface LoadOptions {
  /**
   * Ids still wanted, read when the lock is granted (so it reflects the open project, its undo history and the saved project at
   * that moment, not at start). Null skips the sweep: the saved project did not restore, so its images are still wanted.
   */
  liveIds: () => ReadonlySet<string> | null;
  /** `null` stands for a browser without the lock API; absent means the browser's. */
  locks?: AssetLocks | null;
  store?: AssetStore;
}

export interface StartResult {
  /**
   * Settles with the ids deleted once this tab was granted the exclusive lock and swept. Settles with none at once without the lock
   * API, and never settles while another document holds the lock.
   */
  swept: Promise<string[]>;
}

/**
 * Start of a session: decodes the assets the open project references, then queues for the exclusive Web Lock (no `ifAvailable`: a
 * document being replaced by a reload still holds it until it unloads). When granted, this tab keeps the lock until it unloads,
 * `retainAssets` may delete, and the stored records no live state uses are deleted. Without the lock API nothing is ever deleted.
 */
export async function loadProjectAssets(ids: readonly string[], options: LoadOptions): Promise<StartResult> {
  const store = options.store ?? idbStore;
  try {
    const stored = new Set(await store.keys());
    await Promise.all(
      ids
        .filter((id) => stored.has(id))
        .map(async (id) => {
          const record = await store.get(id);
          if (record) await decode(record, true).catch(() => undefined);
        }),
    );
  } catch {
    // IndexedDB can be unavailable (private mode): the project still opens, uploaded images are just missing.
  }
  bump();

  const locks = options.locks === undefined ? (typeof navigator === "undefined" ? null : (navigator.locks ?? null)) : options.locks;
  if (!locks) return { swept: Promise.resolve([]) };
  const swept = Promise.withResolvers<string[]>();
  const forever = Promise.withResolvers<void>();
  locks
    .request(LOCK_NAME, async () => {
      ownsStore = true;
      try {
        const keep = options.liveIds();
        const stored = keep ? await store.keys() : [];
        const gone = stored.filter((id) => !keep!.has(id));
        await Promise.all(gone.map((id) => store.delete(id).catch(() => undefined)));
        swept.resolve(gone);
      } catch {
        swept.resolve([]);
      }
      return forever.promise;
    })
    .catch(() => swept.resolve([]));
  return { swept: swept.promise };
}

/**
 * A project was replaced. Keeps the assets in `keep` (the open project and everything its undo history can still show),
 * writes those that only live in memory so they survive a reload, and deletes the stored records of the rest.
 */
export async function retainAssets(keep: ReadonlySet<string>): Promise<void> {
  const work: Array<Promise<unknown>> = [];
  for (const [id, entry] of loaded) {
    if (keep.has(id)) {
      if (!entry.persisted) {
        work.push(
          idb("readwrite", (s) => s.put(entry.record)).then(
            () => {
              entry.persisted = true;
            },
            () => undefined,
          ),
        );
      }
    } else if (entry.persisted && ownsStore) {
      loaded.delete(id);
      release(entry.image);
      work.push(idb("readwrite", (s) => s.delete(id)).catch(() => undefined));
    }
  }
  await Promise.all(work);
  bump();
}

export function blobToDataUrl(blob: Blob): Promise<string> {
  const { promise, resolve, reject } = Promise.withResolvers<string>();
  const reader = new FileReader();
  reader.onload = () => resolve(String(reader.result));
  reader.onerror = () => reject(reader.error);
  reader.readAsDataURL(blob);
  return promise;
}

export async function assetsToDataUrls(ids: string[]): Promise<Record<string, { name: string; dataUrl: string }>> {
  const out: Record<string, { name: string; dataUrl: string }> = {};
  for (const id of ids) {
    const rec = loaded.get(id)?.record;
    if (rec) out[id] = { name: rec.name, dataUrl: await blobToDataUrl(rec.blob) };
  }
  return out;
}

export async function importAssetDataUrls(assets: Record<string, { name: string; dataUrl: string }>): Promise<void> {
  for (const [id, a] of Object.entries(assets)) {
    const blob = await (await fetch(a.dataUrl)).blob();
    const record: AssetRecord = { id, name: a.name, type: blob.type, blob };
    const stored = await idb("readwrite", (s) => s.put(record)).then(
      () => true,
      () => false,
    );
    await decode(record, stored);
  }
  bump();
}

/** Registers an already encoded blob in memory. `retainAssets` stores it once a project that uses it is open. */
export async function addAssetFromBlob(blob: Blob, name: string): Promise<string> {
  const record: AssetRecord = { id: crypto.randomUUID(), name, type: blob.type, blob };
  await decode(record, false);
  bump();
  return record.id;
}

/** Test seam: registers an in-memory image under a fixed id. */
export function registerAssetImage(id: string, image: AssetImage): void {
  const previous = loaded.get(id);
  loaded.set(id, { record: { id, name: id, type: "image/png", blob: new Blob() }, image, persisted: false });
  if (previous && previous.image.source !== image.source) release(previous.image);
  bump();
}

/** Test seam: ids of the assets currently held, and whether each is stored. */
export function loadedAssets(): Array<{ id: string; persisted: boolean }> {
  return [...loaded].map(([id, entry]) => ({ id, persisted: entry.persisted }));
}

/**
 * Registers artwork drawn by code (template dials, sample backdrops). In a browser it is encoded like an upload so it can
 * be stored and embedded in project files; without IndexedDB (tests) it is kept as the canvas itself.
 */
export async function addGeneratedAsset(surface: Surface, name: string): Promise<string> {
  if (typeof indexedDB === "undefined") {
    const id = crypto.randomUUID();
    registerAssetImage(id, { width: surface.width, height: surface.height, source: surface as unknown as CanvasImageSource });
    return id;
  }
  const png = await surfaceToPng(surface);
  return addAssetFromBlob(new Blob([png as BlobPart], { type: "image/png" }), name);
}
