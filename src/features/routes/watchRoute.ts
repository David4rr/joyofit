/** What a saved route becomes before it crosses the bridge to the watch. Pure; the native types are imported as types only. */
import { t } from '@/i18n';
import type { WatchRoute } from '@/wear';

import { simplifyRoute, type RoutePoint } from './routeModel';

/** Most points handed to the native side; it simplifies further to what the watch holds. */
export const MAX_WATCH_POINTS = 3000;

/** The watch takes 1 to 100 UTF-8 bytes of name. */
export const MAX_WATCH_NAME_BYTES = 100;

function utf8Bytes(codePoint: number): number {
  if (codePoint < 0x80) return 1;
  if (codePoint < 0x800) return 2;
  if (codePoint < 0x10000) return 3;
  return 4;
}

/** The number of bytes `text` takes in UTF-8. */
export function utf8Length(text: string): number {
  let bytes = 0;
  for (const ch of text) bytes += utf8Bytes(ch.codePointAt(0) as number);
  return bytes;
}

/** `text` cut to at most `maxBytes` UTF-8 bytes, never in the middle of a character, trimmed. */
export function truncateUtf8(text: string, maxBytes: number): string {
  let bytes = 0;
  let out = '';
  for (const ch of text) {
    const size = utf8Bytes(ch.codePointAt(0) as number);
    if (bytes + size > maxBytes) break;
    bytes += size;
    out += ch;
  }
  return out.trim();
}

/** The name the watch lists the route under. */
export function watchRouteName(name: string): string {
  return truncateUtf8(name.trim(), MAX_WATCH_NAME_BYTES) || t('routes:push.watchFallbackName');
}

/**
 * The route as the native `pushRoute` takes it: at most `MAX_WATCH_POINTS` points of the line's shape, flat
 * `lat, lon, alt` triples (altitude 0 when unknown), `hasAltitude` only when every point of the route has one.
 */
export function buildWatchRoute(name: string, points: readonly RoutePoint[]): WatchRoute {
  if (points.length < 2) throw new Error(t('routes:parse.tooFewForSave'));
  const hasAltitude = points.every((p) => p.alt !== null && Number.isFinite(p.alt));
  const flat: number[] = [];
  for (const p of simplifyRoute(points, MAX_WATCH_POINTS)) flat.push(p.lat, p.lon, hasAltitude ? (p.alt as number) : 0);
  return { name: watchRouteName(name), points: flat, hasAltitude, durationSec: 0 };
}

/** A different name for the same route: `Lari` becomes `Lari (2)`, `Lari (2)` becomes `Lari (3)`; still within the watch's name limit. */
export function alternativeName(name: string): string {
  const match = /^(.*?)\s*\((\d+)\)$/.exec(name.trim());
  const base = match ? match[1] : name.trim();
  const next = match ? Number(match[2]) + 1 : 2;
  const suffix = ` (${next})`;
  return `${truncateUtf8(base, MAX_WATCH_NAME_BYTES - suffix.length)}${suffix}`;
}
