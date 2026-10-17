import { describe, expect, test } from 'bun:test';

import { createGeocodeClient, normalizeQuery, parsePlaces, searchUrl } from './geocodeClient';
import type { FetchLike } from './http';
import { createThrottle } from './throttle';

const answer = [
  {
    lat: '-7.9797',
    lon: '112.6304',
    name: 'Alun-Alun Kota Malang',
    display_name: 'Alun-Alun Kota Malang, Klojen, Malang, Jawa Timur, Indonesia',
  },
  { lat: '-7.98', lon: '112.63', name: '', display_name: 'Jalan Ijen, Malang, Jawa Timur, Indonesia' },
  { lat: 'x', lon: '1', display_name: 'Broken' },
  { lat: '95', lon: '1', display_name: 'Off the globe' },
];

describe('normalizeQuery', () => {
  test('trims and squeezes spaces', () => {
    expect(normalizeQuery('  alun   alun \n malang ')).toBe('alun alun malang');
  });

  test('null when too short or too long', () => {
    expect(normalizeQuery('ab')).toBeNull();
    expect(normalizeQuery('   a  ')).toBeNull();
    expect(normalizeQuery('x'.repeat(101))).toBeNull();
    expect(normalizeQuery('abc')).toBe('abc');
  });
});

describe('searchUrl', () => {
  test('is a Nominatim search with at most 5 results, in Indonesian, text encoded', () => {
    expect(searchUrl('alun alun & kota')).toBe(
      'https://nominatim.openstreetmap.org/search?q=alun%20alun%20%26%20kota&format=jsonv2&limit=5&accept-language=id',
    );
  });
});

describe('parsePlaces', () => {
  test('keeps places with a usable coordinate and splits the name from the address', () => {
    expect(parsePlaces(answer)).toEqual([
      {
        name: 'Alun-Alun Kota Malang',
        detail: 'Klojen, Malang, Jawa Timur, Indonesia',
        lat: -7.9797,
        lon: 112.6304,
      },
      { name: 'Jalan Ijen', detail: 'Malang, Jawa Timur, Indonesia', lat: -7.98, lon: 112.63 },
    ]);
  });

  test('anything but a list is a parse error', () => {
    expect(() => parsePlaces({ error: 'x' })).toThrow(expect.objectContaining({ kind: 'parse' }));
  });
});

describe('createGeocodeClient', () => {
  function setup(respond: FetchLike) {
    let time = 0;
    const calls: { url: string; headers: Record<string, string>; at: number }[] = [];
    const fetch: FetchLike = (url, init) => {
      calls.push({ url, headers: init.headers, at: time });
      return respond(url, init);
    };
    const client = createGeocodeClient({
      fetch,
      userAgent: 'JoyoFit/1.0 (https://joyofit.app)',
      referer: 'https://joyofit.app',
      throttle: createThrottle({
        minIntervalMs: 1100,
        now: () => time,
        sleep: async (ms) => {
          time += ms;
        },
      }),
    });
    return { client, calls };
  }
  const respondOk: FetchLike = async () => ({ ok: true, status: 200, json: async () => answer });

  test('sends the identifying headers and returns places', async () => {
    const { client, calls } = setup(respondOk);
    const places = await client.search('alun alun malang');
    expect(places).toHaveLength(2);
    expect(calls[0].headers['User-Agent']).toBe('JoyoFit/1.0 (https://joyofit.app)');
    expect(calls[0].headers.Referer).toBe('https://joyofit.app');
  });

  test('caches by normalized text, ignoring case', async () => {
    const { client, calls } = setup(respondOk);
    await client.search('Alun Alun');
    await client.search('  alun   alun ');
    expect(calls).toHaveLength(1);
  });

  test('keeps searches 1.1 s apart', async () => {
    const { client, calls } = setup(respondOk);
    await Promise.all([client.search('malang'), client.search('surabaya')]);
    expect(calls.map((c) => c.at)).toEqual([0, 1100]);
  });

  test('refuses a text that is too short without a request', async () => {
    const { client, calls } = setup(respondOk);
    await expect(client.search('ab')).rejects.toMatchObject({ kind: 'parse' });
    expect(calls).toHaveLength(0);
  });

  test('a server error is an http error and is not cached', async () => {
    let fail = true;
    const { client, calls } = setup(async (url, init) =>
      fail ? { ok: false, status: 503, json: async () => ({}) } : respondOk(url, init),
    );
    await expect(client.search('malang')).rejects.toMatchObject({ kind: 'http', status: 503 });
    fail = false;
    expect(await client.search('malang')).toHaveLength(2);
    expect(calls).toHaveLength(2);
  });
});
