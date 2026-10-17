import { describe, expect, it } from 'bun:test';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

import { BUNDLE_NAME, PEER_FINGERPRINT, PEER_PKG } from '../entry/src/main/js/default/common/config.js';

const ROOT = resolve(import.meta.dir, '..');
const MAIN = join(ROOT, 'entry/src/main');
const JS = join(MAIN, 'js/default');

/** Every @system.* module the app may import: the ones the Lite Wearable docs list and this README documents. */
const ALLOWED_SYSTEM = ['@system.app', '@system.brightness', '@system.router', '@system.sensor', '@system.storage', '@system.vibrator'];

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

const config = JSON.parse(readFileSync(join(MAIN, 'config.json'), 'utf8'));
const pages: string[] = config.module.js[0].pages;
const sources = walk(JS).filter((f) => f.endsWith('.js'));
/** wearengine.js is the placeholder for Huawei's own file, which imports @system.wearengine; the placeholder itself imports nothing. */
const checked = sources.filter((f) => !f.endsWith('common/wearengine.js'));

function stripCommentsAndStrings(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '')
    .replace(/'(?:\\.|[^'\\\n])*'/g, "''")
    .replace(/"(?:\\.|[^"\\\n])*"/g, '""')
    .replace(/`(?:\\.|[^`\\])*`/g, '``');
}

describe('config.json', () => {
  it('is a Lite Wearable app with the contract bundleName', () => {
    expect(config.app.bundleName).toBe('com.joyodigitama.joyofit.fuel');
    expect(config.app.bundleName).toBe(BUNDLE_NAME);
    expect(config.module.deviceType).toEqual(['liteWearable']);
    expect(config.module.distro).toEqual({ deliveryWithInstall: true, moduleName: 'entry', moduleType: 'entry' });
    expect(config.module.js[0].name).toBe(config.module.abilities[0].name);
  });

  it('asks for the heart-rate permission', () => {
    const names = config.module.reqPermissions.map((p: { name: string }) => p.name);
    expect(names).toContain('ohos.permission.READ_HEALTH_DATA');
    expect(names).toContain('ohos.permission.VIBRATE');
  });

  it('authorises the JoyoFit peer with the same fingerprint as config.js', () => {
    const entry = config.module.metaData.customizeData.find((m: { name: string }) => m.name === 'supportLists');
    expect(entry.value).toBe(`${PEER_PKG}:${PEER_FINGERPRINT}`);
    expect(PEER_PKG).toBe('com.joyodigitama.joyofit');
  });

  it('lists the four pages, home first', () => {
    expect(pages).toEqual(['pages/index/index', 'pages/session/session', 'pages/summary/summary', 'pages/profile/profile']);
  });

  it('has a label of at most 22 characters (install error 40 otherwise) from string.json', () => {
    const ref: string = config.module.abilities[0].label;
    expect(ref.startsWith('$string:')).toBe(true);
    const strings = JSON.parse(readFileSync(join(MAIN, 'resources/base/element/string.json'), 'utf8')).string;
    const entry = strings.find((s: { name: string }) => s.name === ref.slice('$string:'.length));
    expect(entry).toBeDefined();
    expect(entry.value.length).toBeLessThanOrEqual(22);
  });
});

describe('pages', () => {
  it('every page in config.json has its .hml, .css and .js', () => {
    for (const page of pages) {
      for (const ext of ['hml', 'css', 'js']) {
        expect(existsSync(join(JS, `${page}.${ext}`))).toBe(true);
      }
    }
  });

  it('every page folder is listed in config.json', () => {
    const listed = new Set(pages.map((p) => p.split('/')[1]));
    const folders = readdirSync(join(JS, 'pages'));
    expect(folders.sort()).toEqual([...listed].sort());
  });

  it('every <text> has a width and a height (Lite Wearable gives 0 otherwise)', () => {
    for (const page of pages) {
      const hml = readFileSync(join(JS, `${page}.hml`), 'utf8');
      const css = readFileSync(join(JS, `${page}.css`), 'utf8');
      const rules = new Map<string, string>();
      for (const m of css.matchAll(/\.([\w-]+)\s*\{([^}]*)\}/g)) rules.set(m[1], (rules.get(m[1]) ?? '') + m[2]);
      for (const m of hml.matchAll(/<text\b([^>]*)>/g)) {
        const attrs = m[1];
        const cls = (attrs.match(/class="([^"]*)"/)?.[1] ?? '').split(/\s+/).filter(Boolean);
        const inline = attrs.match(/style="([^"]*)"/)?.[1] ?? '';
        const props = cls.map((c) => rules.get(c) ?? '').join(';') + ';' + inline;
        expect({ page, text: m[0], width: /(^|[;\s])width\s*:/.test(props) }).toEqual({ page, text: m[0], width: true });
        expect({ page, text: m[0], height: /(^|[;\s])height\s*:/.test(props) }).toEqual({ page, text: m[0], height: true });
      }
    }
  });

  it('uses px lengths only, no vp, fp or percent that older API levels lack', () => {
    for (const f of walk(JS).filter((p) => p.endsWith('.css'))) {
      const css = readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
      expect(css).not.toMatch(/\d(vp|fp|%)/);
    }
  });

  it('keeps each page with its imports under the 48 KB single-page limit (install error 34)', () => {
    for (const page of pages) {
      const seen = new Set<string>();
      const visit = (file: string) => {
        if (seen.has(file)) return;
        seen.add(file);
        const src = readFileSync(file, 'utf8');
        for (const m of src.matchAll(/from\s+'(\.[^']+)'/g)) visit(resolve(dirname(file), m[1]));
      };
      visit(join(JS, `${page}.js`));
      const total = [...seen].reduce((n, f) => n + statSync(f).size, 0);
      expect(total).toBeLessThan(48 * 1024);
    }
  });
});

describe('imports', () => {
  it('every @system.* import is in the allowed list', () => {
    const used = new Set<string>();
    for (const f of checked) {
      for (const m of readFileSync(f, 'utf8').matchAll(/from\s+'(@[^']+)'/g)) {
        used.add(m[1]);
        expect({ file: f.slice(ROOT.length), module: m[1], allowed: ALLOWED_SYSTEM.includes(m[1]) }).toEqual({
          file: f.slice(ROOT.length),
          module: m[1],
          allowed: true,
        });
      }
    }
    // Every allowed module is really used, so the list cannot rot.
    expect([...used].sort()).toEqual([...ALLOWED_SYSTEM].sort());
  });

  it('every relative import resolves to a file and nothing else is imported', () => {
    for (const f of checked) {
      for (const m of readFileSync(f, 'utf8').matchAll(/(?:^|\n)\s*import\b[^'"]*?from\s+'([^']+)'/g)) {
        const spec = m[1];
        if (spec.startsWith('@system.')) continue;
        expect(spec.startsWith('.')).toBe(true);
        expect(existsSync(resolve(dirname(f), spec))).toBe(true);
      }
    }
  });

  it('wearengine.js is the placeholder, not a vendored copy of Huawei\'s file', () => {
    const src = readFileSync(join(JS, 'common/wearengine.js'), 'utf8');
    expect(src).toContain('Placeholder');
    expect(src).not.toContain('@system.wearengine');
  });
});

describe('JS subset for the Lite Wearable runtime', () => {
  it('avoids syntax and built-ins outside the documented ES6 subset', () => {
    const banned: [RegExp, string][] = [
      [/\bawait\b/, 'await'],
      [/\basync\b/, 'async'],
      [/\bPromise\b/, 'Promise'],
      [/\bnew\s+(Map|Set|WeakMap|WeakSet|Proxy)\b/, 'Map/Set/Proxy'],
      [/\bSymbol\b/, 'Symbol'],
      [/function\s*\*|\byield\b/, 'generators'],
      [/\.\.\.[\w$(\[{]/, 'spread or rest'],
      [/\?\./, 'optional chaining'],
      [/\?\?/, 'nullish coalescing'],
      [/\*\*/, 'exponent operator'],
      [/\.(padStart|padEnd|includes|flatMap|flat|fromEntries|replaceAll|at)\(/, 'newer string/array methods'],
      [/\bObject\.(assign|entries|values|fromEntries)\b/, 'newer Object methods'],
      [/\btoLocale\w*\(/, 'toLocale*'],
    ];
    for (const f of checked) {
      const src = stripCommentsAndStrings(readFileSync(f, 'utf8'));
      for (const [re, what] of banned) {
        expect({ file: f.slice(ROOT.length), what, found: re.test(src) }).toEqual({ file: f.slice(ROOT.length), what, found: false });
      }
    }
  });

  it('keeps the math and profile modules free of the clock and other globals', () => {
    for (const name of ['fuel.js', 'profile.js', 'format.js']) {
      const src = stripCommentsAndStrings(readFileSync(join(JS, 'common', name), 'utf8'));
      expect({ name, found: /\b(Date|setTimeout|setInterval|console|globalThis|Math\.random|storage)\b/.test(src) }).toEqual({ name, found: false });
    }
  });
});

describe('icons', () => {
  function pngSize(file: string): [number, number] {
    const b = readFileSync(file);
    expect(b.subarray(1, 4).toString('ascii')).toBe('PNG');
    return [b.readUInt32BE(16), b.readUInt32BE(20)];
  }

  it('are the 114 and 80 px icons the template ships', () => {
    const media = join(MAIN, 'resources/base/media');
    expect(config.module.abilities[0].icon).toBe('$media:icon');
    expect(pngSize(join(media, 'icon.png'))).toEqual([114, 114]);
    expect(pngSize(join(media, 'icon_small.png'))).toEqual([80, 80]);
  });
});
