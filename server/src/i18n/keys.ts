/** Key bookkeeping shared by the parity test and `scripts/i18n-keys.ts`. Pure: no I/O, no Worker APIs. */

export type Tree = { [key: string]: string | Tree };
/** namespace -> parsed JSON file. */
export type Namespaces = Record<string, Tree>;

const PLURAL_SUFFIX = /_(zero|one|two|few|many|other)$/;

/** `ns:path.to.key` -> text, for every leaf of every namespace. */
export function flatten(namespaces: Namespaces): Map<string, string> {
  const out = new Map<string, string>();
  const walk = (ns: string, tree: Tree, prefix: string) => {
    for (const [key, value] of Object.entries(tree)) {
      if (typeof value === "string") out.set(`${ns}:${prefix}${key}`, value);
      else walk(ns, value, `${prefix}${key}.`);
    }
  };
  for (const [ns, tree] of Object.entries(namespaces)) walk(ns, tree, "");
  return out;
}

/** The keys `locale` must have, given the source language's keys: a plural base gets one key per plural category of `locale`. */
export function expectedKeys(sourceKeys: Iterable<string>, locale: string): Set<string> {
  const keys = [...sourceKeys];
  const pluralBases = new Set(keys.filter((k) => PLURAL_SUFFIX.test(k)).map((k) => k.replace(PLURAL_SUFFIX, "")));
  const categories = new Intl.PluralRules(locale).resolvedOptions().pluralCategories;
  const out = new Set<string>();
  for (const key of keys) {
    const base = key.replace(PLURAL_SUFFIX, "");
    if (pluralBases.has(base)) for (const category of categories) out.add(`${base}_${category}`);
    else out.add(key);
  }
  return out;
}

export interface KeyReport {
  missing: string[];
  orphan: string[];
}

/** Compares one locale with the source (`id`). The source itself is checked against its own plural categories. */
export function compare(source: Namespaces, other: Namespaces, locale: string): KeyReport {
  const sourceKeys = [...flatten(source).keys()];
  const expected = expectedKeys(sourceKeys, locale);
  const actual = new Set(flatten(other).keys());
  return {
    missing: [...expected].filter((k) => !actual.has(k)).sort(),
    orphan: [...actual].filter((k) => !expected.has(k)).sort(),
  };
}

/** `{{param}}` names used by a string. */
export function paramsOf(text: string): string[] {
  return [...new Set([...text.matchAll(/\{\{\s*(\w+)\s*\}\}/g)].map((m) => m[1]!))].sort();
}
