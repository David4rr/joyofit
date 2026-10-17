import type { AppInstallStatusEvent, FuelLinkStatus, WatchAppDeviceParams, WatchAppInfo, WatchAppList } from '@/wear';

/** The bundle name of the JoyoFit Fuel watch app (`watchapp/fuel/`); also the package in the watch's app list. */
export const FUEL_PACKAGE = 'com.joyodigitama.joyofit.fuel';

/** The answer to a ping that says the watch app is installed and reachable. */
export const PING_PRESENT = 0xca;

/** One line about the watch's app runtime: "Lite Wearable, API 7, OS 6.1.0, 408x480 rect, debug". Null when the watch reported none. */
export function paramsLine(params: WatchAppDeviceParams | null): string | null {
  if (!params) return null;
  const parts = [
    params.typeName === 'liteWearable' ? 'Lite Wearable' : `app type ${params.type}`,
    `API ${params.osApiLevel}`,
    params.osVersion ? `OS ${params.osVersion}` : null,
    params.width > 0 && params.height > 0 ? `${params.width}x${params.height}${params.screenShape ? ` ${params.screenShape}` : ''}` : null,
    params.buildType || null,
  ];
  return parts.filter((part): part is string => part !== null).join(', ');
}

/** The Fuel app in the watch's list, if it is there. */
export function findFuel(list: WatchAppList | null): WatchAppInfo | null {
  return list?.apps.find((app) => app.packageName === FUEL_PACKAGE) ?? null;
}

/** A fingerprint in groups of eight characters so it can be compared by eye; copy the ungrouped value. */
export function groupFingerprint(fingerprint: string): string {
  return fingerprint.replace(/(.{8})(?=.)/g, '$1 ');
}

export type FuelReach = 'unknown' | 'reachable' | 'silent';

/** What the last ping says: `reachable` = answered 0xca, `silent` = answered something else, `unknown` = no answer yet. */
export function fuelReach(link: FuelLinkStatus | null): FuelReach {
  if (!link || link.pingCode === null) return 'unknown';
  return (link.pingCode & 0xff) === PING_PRESENT ? 'reachable' : 'silent';
}

/** The text under the progress bar while the app is installed: bytes while the file goes over, then the watch's own reports. */
export function installStageText(bytes: { bytes: number; total: number } | null, report: AppInstallStatusEvent | null): string {
  if (report) {
    switch (report.phase) {
      case 'progress':
        return `The watch is installing the app: ${report.status}%`;
      case 'installStarted':
        return 'The watch started installing the app';
      case 'installed':
        return 'The watch installed the app';
      case 'installFailed':
        return 'The watch refused the app';
      default:
        return `The watch reported ${report.status}`;
    }
  }
  if (bytes && bytes.total > 0) {
    const percent = Math.min(100, Math.round((bytes.bytes / bytes.total) * 100));
    return `Sending the app: ${percent}% (${bytes.bytes.toLocaleString()} of ${bytes.total.toLocaleString()} bytes)`;
  }
  return 'Waiting for the watch to accept the file';
}

/** 0 to 100 for the bar: the file transfer is the first half, the watch's install percentage the second. */
export function installPercent(bytes: { bytes: number; total: number } | null, report: AppInstallStatusEvent | null): number {
  if (report) {
    if (report.phase === 'progress') return 50 + Math.round(report.status / 2);
    if (report.phase === 'installed') return 100;
    return 50;
  }
  if (bytes && bytes.total > 0) return Math.min(50, Math.round((bytes.bytes / bytes.total) * 50));
  return 0;
}
