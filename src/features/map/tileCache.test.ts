import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';

import { LruCache, createTileSource, isAbortError } from './tileCache';

const fixture = new Uint8Array(readFileSync(`${import.meta.dir}/__fixtures__/tile.pbf`));
const TEMPLATE = 'https://tiles.example/planet/v1/{z}/{x}/{y}.pbf';

interface Calls {
  tilejson: number;
  tiles: string[];
}

function fakeFetch(
  calls: Calls,
  tile: (url: string, signal?: AbortSignal | null) => Promise<Response> | Response = () =>
    new Response(fixture),
): typeof fetch {
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith('/planet')) {
      calls.tilejson++;
      return Response.json({ tiles: [TEMPLATE] });
    }
    calls.tiles.push(url);
    return tile(url, init?.signal);
  }) as typeof fetch;
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('LruCache', () => {
  test('evicts the least recently used entry', () => {
    const c = new LruCache<string, number>(2);
    c.set('a', 1);
    c.set('b', 2);
    c.get('a');
    c.set('c', 3);
    expect(c.get('b')).toBeUndefined();
    expect(c.get('a')).toBe(1);
    expect(c.size).toBe(2);
  });
});

describe('tile source', () => {
  test('fetches TileJSON once, builds the URL, dedupes in-flight and caches', async () => {
    const calls: Calls = { tilejson: 0, tiles: [] };
    const src = createTileSource({ fetchImpl: fakeFetch(calls) });
    const [a, b] = await Promise.all([src.tile(14, 13060, 8471), src.tile(14, 13060, 8471)]);
    expect(a).toBe(b);
    expect(a?.layers.water).toBeDefined();
    await src.tile(14, 13060, 8471);
    await src.tile(14, 13061, 8471);
    expect(calls.tilejson).toBe(1);
    expect(calls.tiles).toEqual([
      'https://tiles.example/planet/v1/14/13060/8471.pbf',
      'https://tiles.example/planet/v1/14/13061/8471.pbf',
    ]);
  });

  test('renders overzoomed tiles from the zoom-14 ancestor and caches the result', async () => {
    const calls: Calls = { tilejson: 0, tiles: [] };
    const src = createTileSource({ fetchImpl: fakeFetch(calls) });
    expect(src.peekRendered(15, 26120, 16942)).toBeUndefined();
    const r = await src.rendered(15, 26120, 16942);
    expect(r.z).toBe(15);
    expect(calls.tiles).toEqual(['https://tiles.example/planet/v1/14/13060/8471.pbf']);
    expect(src.peekRendered(15, 26120, 16942)).toBe(r);
    await src.rendered(15, 26121, 16943); // sibling sub-tile reuses the decoded ancestor
    expect(calls.tiles.length).toBe(1);
  });

  test('gunzips a body the runtime did not decode', async () => {
    const calls: Calls = { tilejson: 0, tiles: [] };
    const src = createTileSource({
      fetchImpl: fakeFetch(calls, () => new Response(gzipSync(fixture))),
    });
    const t = await src.tile(14, 1, 1);
    expect(t?.layers.transportation).toBeDefined();
  });

  test('404 and 204 are empty tiles, other errors reject and are retried', async () => {
    const calls: Calls = { tilejson: 0, tiles: [] };
    let fail = true;
    const src = createTileSource({
      fetchImpl: fakeFetch(calls, (url) => {
        if (url.endsWith('/1/1.pbf')) return new Response(null, { status: 404 });
        if (fail) return new Response('boom', { status: 500 });
        return new Response(fixture);
      }),
    });
    expect(await src.tile(14, 1, 1)).toBeNull();
    expect((await src.rendered(14, 1, 1)).layers).toEqual([]);
    await expect(src.tile(14, 2, 2)).rejects.toThrow('HTTP 500');
    fail = false;
    expect((await src.tile(14, 2, 2))?.layers.water).toBeDefined();
  });

  test('a failed TileJSON is retried next time', async () => {
    let n = 0;
    const src = createTileSource({
      fetchImpl: (async (input: string | URL | Request) => {
        const url = String(input);
        if (url.endsWith('/planet')) {
          return n++ === 0 ? new Response('no', { status: 503 }) : Response.json({ tiles: [TEMPLATE] });
        }
        return new Response(fixture);
      }) as typeof fetch,
    });
    await expect(src.tile(14, 3, 3)).rejects.toThrow('TileJSON');
    expect((await src.tile(14, 3, 3))?.layers.water).toBeDefined();
  });

  test('aborting the only waiter aborts the request; a shared request survives one abort', async () => {
    const calls: Calls = { tilejson: 0, tiles: [] };
    let aborted = 0;
    const src = createTileSource({
      fetchImpl: fakeFetch(calls, (_url, signal) => {
        return new Promise<Response>((resolve, reject) => {
          const t = setTimeout(() => resolve(new Response(fixture)), 30);
          signal?.addEventListener('abort', () => {
            aborted++;
            clearTimeout(t);
            reject(Object.assign(new Error('Aborted'), { name: 'AbortError' }));
          });
        });
      }),
    });

    const solo = new AbortController();
    const p = src.tile(14, 5, 5, solo.signal);
    await wait(5);
    solo.abort();
    const err = await p.catch((e: unknown) => e);
    expect(isAbortError(err)).toBe(true);
    await wait(5);
    expect(aborted).toBe(1);

    const one = new AbortController();
    const first = src.tile(14, 6, 6, one.signal);
    const second = src.tile(14, 6, 6);
    await wait(5);
    one.abort();
    expect(isAbortError(await first.catch((e: unknown) => e))).toBe(true);
    expect((await second)?.layers.water).toBeDefined();
    expect(aborted).toBe(1);
    expect(calls.tiles.filter((u) => u.endsWith('/6/6.pbf')).length).toBe(1);
  });

  test('an already aborted signal rejects without fetching', async () => {
    const calls: Calls = { tilejson: 0, tiles: [] };
    const src = createTileSource({ fetchImpl: fakeFetch(calls) });
    const c = new AbortController();
    c.abort();
    await expect(src.tile(14, 7, 7, c.signal)).rejects.toThrow('Aborted');
    expect(calls.tiles.length).toBe(0);
  });
});
