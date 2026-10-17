/**
 * A small tolerant XML scanner for GPX and TCX: no DOM, no dependency, one pass. It reports tags and text in document
 * order and never throws; broken markup just ends the scan early. Element and attribute names are reported without
 * their namespace prefix and in lower case (`gpxtpx:HR` is `hr`), so `<ns3:hr>` and `<hr>` look the same. A DOCTYPE is
 * skipped, never expanded, so a file cannot define entities of its own.
 */
import type { RoutePoint } from './routeModel';

export interface XmlHandlers {
  /** An opening tag. `attrs` is the raw text after the name; read it with `parseAttrs` when needed. A self-closing tag is followed by its `close`. */
  open(name: string, attrs: string, selfClosing: boolean): void;
  close(name: string): void;
  /** Text between tags, entities decoded; CDATA arrives as it is. Whitespace-only text is not reported. */
  text(text: string): void;
}

/** What a route parser reads out of one file. */
export interface RawRoute {
  name: string | null;
  points: RoutePoint[];
}

/** `ns:Name` to `name`. */
export function localName(raw: string): string {
  const colon = raw.lastIndexOf(':');
  return (colon === -1 ? raw : raw.slice(colon + 1)).toLowerCase();
}

const ENTITY = /&(#x[0-9a-f]+|#[0-9]+|amp|lt|gt|quot|apos);/gi;
const NAMED: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

/** The five XML entities and numeric references; anything else is left as written. */
export function decodeEntities(text: string): string {
  if (!text.includes('&')) return text;
  return text.replace(ENTITY, (whole, body: string) => {
    const lower = body.toLowerCase();
    if (lower in NAMED) return NAMED[lower];
    const code = lower.startsWith('#x') ? parseInt(lower.slice(2), 16) : parseInt(lower.slice(1), 10);
    if (!Number.isFinite(code) || code < 1 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) return whole;
    return String.fromCodePoint(code);
  });
}

const ATTR = /([^\s=/]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;

/** The attributes of a tag as `name -> value`, names without prefix and in lower case, values decoded. */
export function parseAttrs(raw: string): Record<string, string> {
  const out: Record<string, string> = {};
  ATTR.lastIndex = 0;
  for (let m = ATTR.exec(raw); m !== null; m = ATTR.exec(raw)) {
    const key = localName(m[1]);
    if (!(key in out)) out[key] = decodeEntities(m[2] ?? m[3] ?? '');
  }
  return out;
}

/** The index of the `>` that ends the tag starting at `from`, skipping `>` inside quoted attribute values; -1 when there is none. */
function tagEnd(xml: string, from: number): number {
  let quote = '';
  for (let i = from; i < xml.length; i++) {
    const c = xml[i];
    if (quote) {
      if (c === quote) quote = '';
    } else if (c === '"' || c === "'") quote = c;
    else if (c === '>') return i;
  }
  return -1;
}

/** Past a `<!DOCTYPE ...>`, including an internal subset in brackets. */
function afterDoctype(xml: string, from: number): number {
  const bracket = xml.indexOf('[', from);
  const plain = xml.indexOf('>', from);
  if (plain === -1) return xml.length;
  if (bracket === -1 || bracket > plain) return plain + 1;
  const subsetEnd = xml.indexOf(']', bracket);
  if (subsetEnd === -1) return xml.length;
  const close = xml.indexOf('>', subsetEnd);
  return close === -1 ? xml.length : close + 1;
}

/** Walks `xml` once and calls `handlers` for every tag and text. */
export function scanXml(xml: string, handlers: XmlHandlers): void {
  const n = xml.length;
  let i = 0;
  const emitText = (raw: string) => {
    if (/\S/.test(raw)) handlers.text(decodeEntities(raw));
  };
  while (i < n) {
    const lt = xml.indexOf('<', i);
    if (lt === -1) {
      emitText(xml.slice(i));
      return;
    }
    if (lt > i) emitText(xml.slice(i, lt));

    if (xml.startsWith('<!--', lt)) {
      const end = xml.indexOf('-->', lt + 4);
      if (end === -1) return;
      i = end + 3;
    } else if (xml.startsWith('<![CDATA[', lt)) {
      const end = xml.indexOf(']]>', lt + 9);
      const body = xml.slice(lt + 9, end === -1 ? n : end);
      if (/\S/.test(body)) handlers.text(body);
      if (end === -1) return;
      i = end + 3;
    } else if (xml.startsWith('<?', lt)) {
      const end = xml.indexOf('?>', lt + 2);
      if (end === -1) return;
      i = end + 2;
    } else if (xml.startsWith('<!', lt)) {
      i = afterDoctype(xml, lt + 2);
    } else {
      const end = tagEnd(xml, lt + 1);
      if (end === -1) return;
      i = end + 1;
      const body = xml.slice(lt + 1, end);
      if (body.startsWith('/')) {
        handlers.close(localName(body.slice(1).trim()));
        continue;
      }
      const selfClosing = body.endsWith('/');
      const inner = selfClosing ? body.slice(0, -1) : body;
      const space = inner.search(/\s/);
      const name = localName(space === -1 ? inner : inner.slice(0, space));
      if (name === '') continue;
      handlers.open(name, space === -1 ? '' : inner.slice(space), selfClosing);
      if (selfClosing) handlers.close(name);
    }
  }
}

/** A latitude or longitude attribute or element text as a number; NaN when it is empty or not a number. */
export function parseNumber(text: string | undefined): number {
  if (text === undefined) return Number.NaN;
  const trimmed = text.trim();
  return trimmed === '' ? Number.NaN : parseFloat(trimmed);
}
