/**
 * Pure helpers of the sensor screens: icons and labels per kind, signal strength from RSSI, the one-line live reading, the battery
 * line, the hint under a sensor that is quiet, and the wheel size field. Text goes through i18n at call time (never at module load).
 */
import type { IconName } from '@/components/IconChip';
import { fmtDecimal, fmtInt, fmtPercent, t } from '@/i18n';

import { WHEEL_CIRCUMFERENCE_MM, type SensorKind, type SensorReadings } from '../gatt';
import type { HubSnapshot, LinkInfo, ScanItem } from '../hub';
import type { Granted } from '../permissions';

/** The order sensor kinds are listed in everywhere: the same as `kindsOfServices`. */
const KIND_ORDER: readonly SensorKind[] = ['hr', 'power', 'csc', 'rsc'];

const KIND_ICON: Readonly<Record<SensorKind, IconName>> = {
  hr: 'heart',
  csc: 'speedometer',
  power: 'flash',
  rsc: 'walk',
};

export function sortKinds(kinds: readonly SensorKind[]): SensorKind[] {
  return KIND_ORDER.filter((kind) => kinds.includes(kind));
}

export function kindIcon(kind: SensorKind): IconName {
  return KIND_ICON[kind];
}

/** The glyph that stands for a sensor: its first kind's, or plain Bluetooth when the kinds are not known yet. */
export function sensorIcon(kinds: readonly SensorKind[]): IconName {
  const first = sortKinds(kinds)[0];
  return first ? KIND_ICON[first] : 'bluetooth';
}

export function kindLabel(kind: SensorKind): string {
  return t(`watch:sensors.kind.${kind}`);
}

/** "Detak jantung, Daya". */
export function kindsLabel(kinds: readonly SensorKind[]): string {
  return sortKinds(kinds).map(kindLabel).join(', ');
}

export type SignalLevel = 'strong' | 'good' | 'fair' | 'weak';

/** Four bars out of the RSSI in dBm: closer than about a metre is -60 or better; below -80 the link drops often. */
export function signalBars(rssi: number): 1 | 2 | 3 | 4 {
  if (rssi >= -60) return 4;
  if (rssi >= -70) return 3;
  if (rssi >= -80) return 2;
  return 1;
}

export function signalLevel(rssi: number): SignalLevel {
  return (['weak', 'fair', 'good', 'strong'] as const)[signalBars(rssi) - 1];
}

/** "Baterai 80%", or null while the sensor has not reported its level. */
export function batteryLabel(battery: number | null): string | null {
  return battery === null ? null : t('watch:sensors.battery', { value: fmtPercent(battery) });
}

/** A scan result's name; a sensor that advertises none is told apart by the tail of its id (the same tail pairing stores). */
export function scanName(item: Pick<ScanItem, 'id' | 'name'>): string {
  return item.name?.trim() || t('watch:sensors.unnamed', { tail: item.id.slice(-5) });
}

const MPS_TO_KMH = 3.6;

/**
 * What a sensor reads right now, one entry per value ("72 bpm", "185 W", "84 rpm", "28,4 km/j"). A heart rate whose strap has lost
 * skin contact is left out: the strap itself says that value is not to be trusted.
 */
export function readingParts(r: SensorReadings): string[] {
  const parts: string[] = [];
  if (r.hr !== undefined && r.hrContact !== 'lost') parts.push(t('common:units.bpm', { value: fmtInt(r.hr) }));
  if (r.watts !== undefined) parts.push(t('common:units.w', { value: fmtInt(r.watts) }));
  if (r.cadenceRpm !== undefined) parts.push(t('watch:sensors.reading.rpm', { value: fmtInt(r.cadenceRpm) }));
  if (r.speedMps !== undefined) parts.push(t('watch:sensors.reading.kmh', { value: fmtDecimal(r.speedMps * MPS_TO_KMH, 1) }));
  if (r.podSpeedMps !== undefined) parts.push(t('watch:sensors.reading.kmh', { value: fmtDecimal(r.podSpeedMps * MPS_TO_KMH, 1) }));
  if (r.podCadenceSpm !== undefined) parts.push(t('common:units.spm', { value: fmtInt(r.podCadenceSpm) }));
  return parts;
}

/** The parts on one line, or null when there is nothing to show. */
export function readingLine(r: SensorReadings): string | null {
  const parts = readingParts(r);
  return parts.length === 0 ? null : parts.join(' · ');
}

export type LinkHint = 'signalLost' | 'failed' | 'contactLost' | 'waitingHr' | 'waitingBike' | 'waitingPod';

/**
 * Why a sensor row has no number, or null when there is nothing to add. `error` is the link's last failure: a link that is trying
 * again with an error lost its signal, one that gave up never got through.
 */
export function linkHint(link: Pick<LinkInfo, 'state' | 'error' | 'contact' | 'preview'>, kinds: readonly SensorKind[]): LinkHint | null {
  if (link.state === 'connecting') return link.error ? 'signalLost' : null;
  if (link.state === 'disconnected') return link.error ? 'failed' : null;
  if (link.contact === 'lost' || link.preview.hrContact === 'lost') return 'contactLost';
  if (readingParts(link.preview).length > 0) return null;
  const first = sortKinds(kinds)[0];
  if (first === 'hr') return 'waitingHr';
  if (first === 'rsc') return 'waitingPod';
  return first ? 'waitingBike' : null;
}

export const WHEEL_MIN_MM = 1000;
export const WHEEL_MAX_MM = 3000;

/** A wheel circumference typed in millimetres; null when it is not a whole number in the range a bike wheel can have. */
export function parseWheelMm(text: string): number | null {
  const clean = text.trim();
  if (!/^\d{4}$/.test(clean)) return null;
  const mm = Number(clean);
  return mm >= WHEEL_MIN_MM && mm <= WHEEL_MAX_MM ? mm : null;
}

export type WheelPreset = keyof typeof WHEEL_CIRCUMFERENCE_MM;

export const WHEEL_PRESETS = Object.keys(WHEEL_CIRCUMFERENCE_MM) as WheelPreset[];

/** The preset a circumference belongs to, or null for a custom size. */
export function wheelPresetOf(mm: number): WheelPreset | null {
  return WHEEL_PRESETS.find((name) => WHEEL_CIRCUMFERENCE_MM[name] === mm) ?? null;
}

/** A speed or power sensor is what turns the wheel size into speed and distance. */
export function needsWheelSize(kinds: readonly SensorKind[]): boolean {
  return kinds.includes('csc') || kinds.includes('power');
}

/** The `code` of an error from the native module (ERR_BLUETOOTH_OFF, ...); anything without one counts as unknown. */
export function errorCode(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string') return error.code;
  return 'ERR_UNKNOWN';
}

export type RadioProblem = 'permission' | 'unsupported' | 'bluetoothOff' | 'scanFailed' | 'connectFailed';

export interface RadioFailure {
  code: string;
  /** What the person was doing when it failed. */
  during: 'scan' | 'connect';
}

/**
 * The one thing to tell the person about the radio, most blocking first: no permission, no Bluetooth LE, Bluetooth off, then a scan
 * or connect that failed for another reason. `permission` is the answer of the last permission prompt, `failure` the last error a
 * call threw; the hub's own `bluetooth` and `scanError` fields cover what the radio reports by itself.
 */
export function radioProblem(
  hub: Pick<HubSnapshot, 'bluetooth' | 'scanError'>,
  permission: Granted | null,
  failure: RadioFailure | null,
): RadioProblem | null {
  if (permission === 'denied' || permission === 'blocked' || hub.bluetooth === 'unauthorized') return 'permission';
  if (hub.bluetooth === 'unsupported') return 'unsupported';
  if (hub.bluetooth === 'off') return 'bluetoothOff';
  const code = hub.scanError ?? failure?.code ?? null;
  if (code === null) return null;
  if (code === 'ERR_BLUETOOTH_PERMISSION') return 'permission';
  if (code === 'ERR_BLUETOOTH_OFF') return 'bluetoothOff';
  return hub.scanError === null && failure?.during === 'connect' ? 'connectFailed' : 'scanFailed';
}
