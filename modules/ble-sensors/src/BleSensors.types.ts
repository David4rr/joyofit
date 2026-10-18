export type BluetoothState = 'on' | 'off' | 'unauthorized' | 'unsupported' | 'unknown';

/** 16-bit assigned numbers as 4 lowercase hex digits; the native side maps them to the 128-bit Bluetooth base UUID. */
export const SERVICE = {
  heartRate: '180d',
  cyclingSpeedCadence: '1816',
  cyclingPower: '1818',
  runningSpeedCadence: '1814',
  battery: '180f',
  deviceInformation: '180a',
} as const;

/** The characteristics the native side subscribes to (notify/indicate) or reads once per (re)connect. */
export const CHARACTERISTIC = {
  heartRateMeasurement: '2a37',
  cscMeasurement: '2a5b',
  cyclingPowerMeasurement: '2a63',
  rscMeasurement: '2a53',
  batteryLevel: '2a19',
  manufacturerName: '2a29',
  modelNumber: '2a24',
} as const;

/**
 * Per service: which characteristics the native side handles and how. `notify` = enable notifications (indications when the sensor
 * offers only those), `read` = read once after (re)connecting. Battery level is read once AND subscribed when the sensor can notify.
 * The same table is implemented in Kotlin (SensorProfile.kt) and Swift (SensorProfile.swift); keep the three in step.
 */
export const SENSOR_CHARACTERISTICS = [
  { service: SERVICE.heartRate, characteristic: CHARACTERISTIC.heartRateMeasurement, mode: 'notify' },
  { service: SERVICE.cyclingSpeedCadence, characteristic: CHARACTERISTIC.cscMeasurement, mode: 'notify' },
  { service: SERVICE.cyclingPower, characteristic: CHARACTERISTIC.cyclingPowerMeasurement, mode: 'notify' },
  { service: SERVICE.runningSpeedCadence, characteristic: CHARACTERISTIC.rscMeasurement, mode: 'notify' },
  { service: SERVICE.battery, characteristic: CHARACTERISTIC.batteryLevel, mode: 'read+notify' },
  { service: SERVICE.deviceInformation, characteristic: CHARACTERISTIC.manufacturerName, mode: 'read' },
  { service: SERVICE.deviceInformation, characteristic: CHARACTERISTIC.modelNumber, mode: 'read' },
] as const;

export interface ScanResultEvent {
  /** Android: MAC address. iOS: CBPeripheral identifier (a UUID, stable on this phone only). */
  id: string;
  /** The advertised or cached name; null when the sensor does not advertise one. */
  name: string | null;
  rssi: number;
  /** The supported services the advertisement lists, as 4-digit hex (`SERVICE`). Sensors that leave the list out are not found by the filter. */
  services: string[];
}

export interface ScanStateEvent {
  scanning: boolean;
  /** An error code (ERR_BLUETOOTH_PERMISSION, ERR_BLUETOOTH_OFF, ...) when the scan ended because of it. */
  error: string | null;
}

export type SensorLinkState = 'connecting' | 'connected' | 'disconnected';

export interface ConnectionEvent {
  id: string;
  state: SensorLinkState;
  /** Set when `state` is `connected`: the supported services the GATT discovery found (4-digit hex). */
  services: string[];
  /** The last failure, human readable English for the log (not shown to users); null while fine. */
  error: string | null;
}

/** One notification or read result. `value` is the raw characteristic value as lowercase hex without separators. */
export interface ValueEvent {
  id: string;
  /** Milliseconds since the epoch, taken on the radio thread when the value arrived (not when JS got it). */
  ts: number;
  service: string;
  characteristic: string;
  value: string;
}

export interface LocationEvent {
  /** Milliseconds since the epoch of the fix itself (Location.getTime / CLLocation.timestamp). */
  ts: number;
  lat: number;
  lon: number;
  /** Metres above sea level, null when the fix has none. */
  alt: number | null;
  /** Horizontal accuracy in metres (68 % radius), null when unknown. */
  accuracy: number | null;
  /** Ground speed in m/s, null when the platform has none. */
  speed: number | null;
  bearing: number | null;
}

export type LocationPermission = 'granted' | 'denied' | 'undetermined';

export interface WorkoutSessionOptions {
  /** Notification title (Android), e.g. "Lari". */
  title: string;
  /** Notification text (Android) before the first `updateWorkoutSession`. */
  text: string;
  /** Record GPS: starts location updates and, on Android, the location foreground type. */
  gps: boolean;
}

export type BleSensorsModuleEvents = {
  onScanResult: (event: ScanResultEvent) => void;
  onScanState: (event: ScanStateEvent) => void;
  onConnection: (event: ConnectionEvent) => void;
  onValue: (event: ValueEvent) => void;
  onLocation: (event: LocationEvent) => void;
  onBluetoothState: (event: { state: BluetoothState }) => void;
};
