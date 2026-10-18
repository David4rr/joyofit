import { fmtDate, fmtDateTime, t } from '@/i18n';

import type { RouteSource } from './routeModel';

/** `18 Okt 2026` / `Oct 18, 2026` from epoch milliseconds, local time. */
export function formatRouteDate(ms: number): string {
  return fmtDate(new Date(ms), 'medium');
}

/** `18 Okt 2026 14.05` / `Oct 18, 2026, 2:05 PM` from epoch milliseconds, local time. */
export function formatRouteDateTime(ms: number): string {
  return fmtDateTime(new Date(ms));
}

/** The name given to a route that has none. */
export const untitledRouteName = (ms: number) => t('routes:untitled', { date: formatRouteDate(ms) });

/** The chip on a route: where it came from. */
export const sourceLabel = (source: RouteSource) => t(`routes:source.${source}`);
