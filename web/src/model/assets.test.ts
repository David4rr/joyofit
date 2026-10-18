import { describe, expect, it, vi } from "vitest";
import { getAsset, loadedAssets, loadProjectAssets, registerAssetImage, retainAssets, type AssetLocks } from "./assets";

function image(close: () => void) {
  return { width: 4, height: 4, source: { close } as unknown as CanvasImageSource };
}

describe("asset lifecycle", () => {
  it("closes the bitmap an entry replaces", () => {
    const closeOld = vi.fn();
    const closeNew = vi.fn();
    registerAssetImage("lifecycle-a", image(closeOld));
    registerAssetImage("lifecycle-a", image(closeNew));
    expect(closeOld).toHaveBeenCalledTimes(1);
    expect(closeNew).not.toHaveBeenCalled();
    expect(getAsset("lifecycle-a")?.width).toBe(4);
  });

  it("keeps memory-only artwork when a project is replaced, so a previewed template can still be opened", async () => {
    const close = vi.fn();
    registerAssetImage("lifecycle-b", image(close));
    await retainAssets(new Set());
    expect(close).not.toHaveBeenCalled();
    expect(loadedAssets().find((a) => a.id === "lifecycle-b")).toEqual({ id: "lifecycle-b", persisted: false });
  });
});

describe("sweep of stored images", () => {
  function fakeStore(ids: string[]) {
    const deleted: string[] = [];
    return {
      deleted,
      store: { keys: async () => ids, get: async () => undefined, delete: async (id: string) => void deleted.push(id) },
    };
  }
  /** A lock manager that grants at once, or keeps the request queued until `grant()` (another document holds the lock). */
  function lockManager(grantNow: boolean) {
    const queued: Array<(lock: object) => Promise<unknown>> = [];
    const locks: AssetLocks = {
      request: (_name, callback) => {
        if (grantNow) return callback({});
        queued.push(callback);
        return Promise.withResolvers<void>().promise;
      },
    };
    return { locks, grant: () => queued.forEach((cb) => void cb({})) };
  }
  const settle = () => new Promise((r) => setTimeout(r, 0));

  it("deletes what no live state uses once the lock is granted", async () => {
    const { store, deleted } = fakeStore(["keep-me", "orphan-1", "orphan-2"]);
    const { locks } = lockManager(true);
    const { swept } = await loadProjectAssets([], { liveIds: () => new Set(["keep-me"]), locks, store });
    expect((await swept).sort()).toEqual(["orphan-1", "orphan-2"]);
    expect(deleted.sort()).toEqual(["orphan-1", "orphan-2"]);
  });

  it("waits while another document holds the lock, then sweeps with the live ids of that moment", async () => {
    const { store, deleted } = fakeStore(["from-start", "added-meanwhile", "orphan"]);
    const { locks, grant } = lockManager(false);
    let live = new Set(["from-start"]);
    const { swept } = await loadProjectAssets(["from-start"], { liveIds: () => live, locks, store });
    await settle();
    expect(deleted).toEqual([]);
    // The user kept working while the old document was still unloading: the keep set is read at grant time.
    live = new Set(["from-start", "added-meanwhile"]);
    grant();
    expect(await swept).toEqual(["orphan"]);
    expect(deleted).toEqual(["orphan"]);
  });

  it("deletes nothing when the browser has no lock API", async () => {
    const { store, deleted } = fakeStore(["orphan"]);
    const { swept } = await loadProjectAssets([], { liveIds: () => new Set(), locks: null, store });
    expect(await swept).toEqual([]);
    expect(deleted).toEqual([]);
  });

  it("deletes nothing when the saved project did not restore, even with the lock", async () => {
    const { store, deleted } = fakeStore(["still-in-the-saved-json"]);
    const { locks } = lockManager(true);
    const { swept } = await loadProjectAssets([], { liveIds: () => null, locks, store });
    expect(await swept).toEqual([]);
    expect(deleted).toEqual([]);
  });
});
