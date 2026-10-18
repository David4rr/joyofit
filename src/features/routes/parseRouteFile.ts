import { t } from '@/i18n';

import { parseGpx } from './gpx';
import type { RoutePoint, RouteSource } from './routeModel';
import { cleanRouteName } from './routeStorage';
import { parseTcx } from './tcx';

export type RouteFileFormat = Extract<RouteSource, 'gpx' | 'tcx'>;

export interface ParsedRouteFile {
  format: RouteFileFormat;
  /** The name inside the file; null when it has none. */
  name: string | null;
  /** At least 2 points, valid coordinates, no consecutive repeats. */
  points: RoutePoint[];
}

export type ParseRouteResult =
  | { ok: true; route: ParsedRouteFile }
  | { ok: false; reason: 'empty' | 'unrecognized' | 'too-few-points'; message: string };

const SNIFF_CHARS = 16_384;
const GPX_ROOT = /<\s*(?:[\w.-]+:)?gpx[\s>/]/i;
const TCX_ROOT = /<\s*(?:[\w.-]+:)?TrainingCenterDatabase[\s>/]/i;

/** UTF-8 text of `bytes`; a byte-order mark is dropped and a byte that is not valid UTF-8 becomes U+FFFD. */
export function decodeUtf8(bytes: Uint8Array): string {
  const text = new TextDecoder('utf-8').decode(bytes);
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

/** `gpx` or `tcx` from the root element near the start of the text; null when it is neither. */
export function sniffRouteFormat(text: string): RouteFileFormat | null {
  const head = text.slice(0, SNIFF_CHARS);
  const gpx = head.search(GPX_ROOT);
  const tcx = head.search(TCX_ROOT);
  if (gpx === -1 && tcx === -1) return null;
  if (tcx === -1) return 'gpx';
  if (gpx === -1) return 'tcx';
  return gpx < tcx ? 'gpx' : 'tcx';
}

/** Reads the line out of GPX or TCX text. */
export function parseRouteText(text: string): ParseRouteResult {
  if (text.trim() === '') return { ok: false, reason: 'empty', message: t('routes:parse.empty') };
  const format = sniffRouteFormat(text);
  if (format === null) return { ok: false, reason: 'unrecognized', message: t('routes:parse.unrecognized') };
  const raw = format === 'gpx' ? parseGpx(text) : parseTcx(text);
  if (raw.points.length < 2) {
    const found = raw.points.length;
    const message = found === 0 ? t('routes:parse.noPoints') : t('routes:parse.tooFewPoints', { count: found });
    return { ok: false, reason: 'too-few-points', message };
  }
  const name = raw.name === null ? '' : cleanRouteName(raw.name);
  return { ok: true, route: { format, name: name === '' ? null : name, points: raw.points } };
}

/** Reads the line out of the bytes of a GPX or TCX file. */
export function parseRouteFile(bytes: Uint8Array): ParseRouteResult {
  if (bytes.length === 0) return { ok: false, reason: 'empty', message: t('routes:parse.empty') };
  return parseRouteText(decodeUtf8(bytes));
}
