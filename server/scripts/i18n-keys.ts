#!/usr/bin/env bun
/**
 * Key parity of the Worker's translations (`src/i18n/locales/<locale>/<namespace>.json`): `id` is the source, every
 * other locale must have each key (a plural key once per plural category of that locale) and nothing else.
 * Prints the report and exits 1 on any finding. Run from anywhere: `bun run server/scripts/i18n-keys.ts`.
 */
import { readdirSync } from "node:fs";
import { join } from "node:path";

import { compare, type Namespaces } from "../src/i18n/keys";

const ROOT = join(import.meta.dir, "..", "src", "i18n", "locales");
const SOURCE = "id";

async function load(locale: string): Promise<Namespaces> {
  const dir = join(ROOT, locale);
  const out: Namespaces = {};
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".json")).sort()) out[file.replace(/\.json$/, "")] = await Bun.file(join(dir, file)).json();
  return out;
}

const locales = readdirSync(ROOT).filter((d) => d !== SOURCE).sort();
const source = await load(SOURCE);
const lines: string[] = ["Translation keys (server)"];
let findings = 0;

// The source is judged against its own plural categories first (an `_one` key in Indonesian is an orphan).
const own = compare(source, source, SOURCE);
if (own.missing.length + own.orphan.length > 0) {
  lines.push(`  ${SOURCE}: ${own.missing.length} missing, ${own.orphan.length} orphan`);
  for (const key of own.missing) lines.push(`missing  ${key}`);
  for (const key of own.orphan) lines.push(`orphan   ${key}`);
  findings += own.missing.length + own.orphan.length;
}

for (const locale of locales) {
  const report = compare(source, await load(locale), locale);
  lines.push(`  ${locale}: ${report.missing.length} missing, ${report.orphan.length} orphan`);
  for (const key of report.missing) lines.push(`missing  ${key}`);
  for (const key of report.orphan) lines.push(`orphan   ${key}`);
  findings += report.missing.length + report.orphan.length;
}

console.log(lines.join("\n"));
process.exit(findings > 0 ? 1 : 0);
