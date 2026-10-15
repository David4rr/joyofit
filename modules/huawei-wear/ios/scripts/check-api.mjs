// Checks that the iOS module defines every member of the JS API (src/HuaweiWearModule.ts) and prints how each one is implemented.
//
//   node modules/huawei-wear/ios/scripts/check-api.mjs
//
// Exit code 1 when a TS member has no Swift definition (JS would hit an undefined function) or Swift defines something the TS does not declare.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const ts = readFileSync(join(here, '..', '..', 'src', 'HuaweiWearModule.ts'), 'utf8');
const swift = readFileSync(join(here, '..', 'HuaweiWearModule.swift'), 'utf8');

const body = ts.slice(ts.indexOf('declare class HuaweiWearModule'));
const declared = new Set();
for (const m of body.matchAll(/^  (?:readonly )?([A-Za-z0-9_]+)(?:\(|:)/gm)) declared.add(m[1]);

const defined = new Map();
for (const line of swift.split('\n')) {
  const m = line.match(/^\s*(AsyncFunction|Function|rejects|switchRejectingOn|Constant)\("([A-Za-z0-9_]+)"/);
  if (!m) continue;
  const [, kind, name] = m;
  let how;
  if (kind === 'rejects') how = 'unsupported (rejects ERR_UNSUPPORTED)';
  else if (kind === 'switchRejectingOn') how = 'off-switch (false resolves, true rejects ERR_UNSUPPORTED)';
  else if (kind === 'Constant') how = 'implemented (constant)';
  else if (line.includes('Inert.') || /-> \[?\[?String: Any\]?\]?\??\s*in\s*(nil|\[\])\s*\}/.test(line) || line.includes('-> Bool in false')) how = 'inert (disabled status)';
  else if (/in \}\s*$/.test(line) || /\(\) -> Void in \}/.test(line)) how = 'no-op (nothing running or stored)';
  else if (line.includes('Inert.cycle') || line.includes('in []')) how = 'inert (disabled status)';
  else how = 'implemented';
  defined.set(name, how);
}

let failed = false;
for (const name of declared) {
  if (!defined.has(name)) {
    console.error(`MISSING in Swift: ${name}`);
    failed = true;
  }
}
for (const name of defined.keys()) {
  if (!declared.has(name)) {
    console.error(`NOT in the TS API: ${name}`);
    failed = true;
  }
}
const groups = new Map();
for (const [name, how] of [...defined].sort()) {
  if (!groups.has(how)) groups.set(how, []);
  groups.get(how).push(name);
}
for (const [how, names] of groups) console.log(`${how} (${names.length}): ${names.join(', ')}`);
console.log(`TS members: ${declared.size}, Swift definitions: ${defined.size}`);
process.exit(failed ? 1 : 0);
