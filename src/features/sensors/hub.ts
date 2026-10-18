/**
 * The JS side of the `BleSensors` native module: one place that listens to its events and keeps what screens and the recorder need.
 *
 * - `getSnapshot()` / `subscribe()` (for `useSyncExternalStore`): Bluetooth state, scan results, and per sensor the link state, battery,
 *   manufacturer, model and a live preview of its readings. Updates caused by sensor values are throttled to one a second, so a
 *   chest strap does not re-render a screen at its own rate.
 * - `onValue()` / `onLocation()`: raw events for the recorder, unthrottled and in arrival order.
 * - `onInfo()`: battery / manufacturer / model, so the provider can persist them.
 *
 * The native module is injected, so the hub runs under bun test with a fake. No React Native imports.
 */
import {
  CHARACTERISTIC,
  type BluetoothState,
  type ConnectionEvent,
  type LocationEvent,
  type ScanResultEvent,
  type ScanStateEvent,
  type SensorLinkState,
  type ValueEvent,
} from '../../../modules/ble-sensors/src/BleSensors.types';
import {
  DEFAULT_WHEEL_CIRCUMFERENCE_MM,
  kindsOfServices,
  hexToBytes,
  parseBatteryLevel,
  parseInfoString,
  SensorTracker,
  type SensorContact,
  type SensorKind,
  type SensorReadings,
} from './gatt';

/** The slice of the native module the hub uses (the module satisfies it structurally). */
export interface BleSensorsApi {
  addListener(name: string, listener: (event: never) => void): { remove(): void };
  bluetoothState(): Promise<BluetoothState>;
  startScan(): Promise<void>;
  stopScan(): Promise<void>;
  connect(id: string): Promise<void>;
  disconnect(id: string): Promise<void>;
  disconnectAll(): Promise<void>;
  connectionStates(): Promise<ConnectionEvent[]>;
}

export interface ScanItem {
  id: string;
  name: string | null;
  rssi: number;
  kinds: SensorKind[];
  /** Epoch ms of the last advertisement. */
  seenAt: number;
}

export interface LinkInfo {
  id: string;
  state: SensorLinkState;
  kinds: SensorKind[];
  /** The last failure (English, for the log), null while fine. */
  error: string | null;
  battery: number | null;
  manufacturer: string | null;
  model: string | null;
  /** Latest readings of this sensor alone, for a "live" line on the sensor screen. */
  preview: SensorReadings;
  contact: SensorContact | null;
}

export interface HubSnapshot {
  bluetooth: BluetoothState;
  scanning: boolean;
  /** The error code a scan ended with (ERR_BLUETOOTH_PERMISSION, ...), null otherwise. */
  scanError: string | null;
  /** Sensors heard during the current or last scan, strongest first. */
  results: ScanItem[];
  links: Record<string, LinkInfo>;
}

export interface SensorInfo {
  id: string;
  battery?: number;
  manufacturer?: string;
  model?: string;
  /** Kinds the GATT discovery found, when a connection reports them. */
  kinds?: SensorKind[];
}

const PREVIEW_INTERVAL_MS = 1000;
/** A scan result not heard for this long drops out of the list while scanning. */
const RESULT_TTL_MS = 15_000;

export class SensorHub {
  private snapshot: HubSnapshot = { bluetooth: 'unknown', scanning: false, scanError: null, results: [], links: {} };
  private readonly listeners = new Set<() => void>();
  private readonly valueListeners = new Set<(e: ValueEvent) => void>();
  private readonly locationListeners = new Set<(e: LocationEvent) => void>();
  private readonly infoListeners = new Set<(i: SensorInfo) => void>();
  private readonly found = new Map<string, ScanItem>();
  private readonly trackers = new Map<string, SensorTracker>();
  private subscriptions: { remove(): void }[] = [];
  private previewTimer: ReturnType<typeof setTimeout> | null = null;
  private wheelCircumferenceM = DEFAULT_WHEEL_CIRCUMFERENCE_MM / 1000;

  constructor(
    private readonly native: () => BleSensorsApi,
    private readonly now: () => number = Date.now,
  ) {}

  // -------------------------------------------------------------------------------------------------------------------
  // subscriptions

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): HubSnapshot => this.snapshot;

  onValue(listener: (e: ValueEvent) => void): () => void {
    this.valueListeners.add(listener);
    return () => this.valueListeners.delete(listener);
  }

  onLocation(listener: (e: LocationEvent) => void): () => void {
    this.locationListeners.add(listener);
    return () => this.locationListeners.delete(listener);
  }

  onInfo(listener: (i: SensorInfo) => void): () => void {
    this.infoListeners.add(listener);
    return () => this.infoListeners.delete(listener);
  }

  /** Wheel size (metres) used by the live previews; the recorder has its own tracker with the size of its workout. */
  setWheelCircumferenceM(metres: number): void {
    this.wheelCircumferenceM = metres;
  }

  // -------------------------------------------------------------------------------------------------------------------
  // native events

  /** Attaches the native listeners once and learns the links that are already up (after a JS reload). */
  async start(): Promise<void> {
    if (this.subscriptions.length > 0) return;
    const n = this.native();
    this.subscriptions = [
      n.addListener('onScanResult', (e: ScanResultEvent) => this.scanResult(e)),
      n.addListener('onScanState', (e: ScanStateEvent) => this.scanState(e)),
      n.addListener('onConnection', (e: ConnectionEvent) => this.connection(e)),
      n.addListener('onValue', (e: ValueEvent) => this.value(e)),
      n.addListener('onLocation', (e: LocationEvent) => {
        for (const l of this.locationListeners) l(e);
      }),
      n.addListener('onBluetoothState', (e: { state: BluetoothState }) => this.set({ bluetooth: e.state })),
    ];
    try {
      for (const state of await n.connectionStates()) this.connection(state);
    } catch {
      // the native side is not ready (no permission yet): the links show up with the first connect
    }
  }

  stop(): void {
    for (const s of this.subscriptions) s.remove();
    this.subscriptions = [];
    clearTimeout(this.previewTimer ?? undefined);
    this.previewTimer = null;
  }

  private set(patch: Partial<HubSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...patch };
    for (const l of this.listeners) l();
  }

  private scanResult(e: ScanResultEvent): void {
    const now = this.now();
    this.found.set(e.id, { id: e.id, name: e.name, rssi: e.rssi, kinds: kindsOfServices(e.services), seenAt: now });
    this.publishResults(now);
  }

  private publishResults(now: number): void {
    const items = [...this.found.values()].filter((r) => now - r.seenAt <= RESULT_TTL_MS).sort((a, b) => b.rssi - a.rssi);
    this.set({ results: items });
  }

  private scanState(e: ScanStateEvent): void {
    if (e.scanning) this.found.clear();
    this.set({ scanning: e.scanning, scanError: e.error, ...(e.scanning ? { results: [] } : {}) });
  }

  private link(id: string): LinkInfo {
    return (
      this.snapshot.links[id] ?? {
        id,
        state: 'disconnected',
        kinds: [],
        error: null,
        battery: null,
        manufacturer: null,
        model: null,
        preview: {},
        contact: null,
      }
    );
  }

  private setLink(info: LinkInfo): void {
    this.set({ links: { ...this.snapshot.links, [info.id]: info } });
  }

  private connection(e: ConnectionEvent): void {
    const prev = this.link(e.id);
    const kinds = e.state === 'connected' ? kindsOfServices(e.services) : prev.kinds;
    if (e.state === 'disconnected') this.trackers.delete(e.id);
    this.setLink({
      ...prev,
      state: e.state,
      kinds,
      error: e.error,
      ...(e.state === 'disconnected' ? { preview: {}, contact: null } : {}),
    });
    if (e.state === 'connected' && kinds.length > 0) this.emitInfo({ id: e.id, kinds });
  }

  private emitInfo(info: SensorInfo): void {
    for (const l of this.infoListeners) l(info);
  }

  private value(e: ValueEvent): void {
    for (const l of this.valueListeners) l(e);
    const characteristic = e.characteristic.toLowerCase();
    if (characteristic === CHARACTERISTIC.batteryLevel) {
      const level = parseBatteryLevel(hexToBytes(e.value));
      if (level === null) return;
      this.setLink({ ...this.link(e.id), battery: level });
      this.emitInfo({ id: e.id, battery: level });
      return;
    }
    if (characteristic === CHARACTERISTIC.manufacturerName || characteristic === CHARACTERISTIC.modelNumber) {
      const text = parseInfoString(hexToBytes(e.value));
      if (text === null) return;
      const field = characteristic === CHARACTERISTIC.manufacturerName ? 'manufacturer' : 'model';
      this.setLink({ ...this.link(e.id), [field]: text });
      this.emitInfo({ id: e.id, [field]: text });
      return;
    }
    let tracker = this.trackers.get(e.id);
    if (!tracker) {
      tracker = new SensorTracker(this.wheelCircumferenceM);
      this.trackers.set(e.id, tracker);
    }
    if (tracker.ingest(characteristic, e.value, e.ts)) this.schedulePreview();
  }

  /** At most one snapshot per second out of the value stream. */
  private schedulePreview(): void {
    if (this.previewTimer) return;
    this.previewTimer = setTimeout(() => {
      this.previewTimer = null;
      const now = this.now();
      const links = { ...this.snapshot.links };
      for (const [id, tracker] of this.trackers) {
        const link = links[id];
        if (!link) continue;
        const preview = tracker.read(now);
        links[id] = { ...link, preview, contact: preview.hrContact ?? link.contact };
      }
      this.set({ links });
    }, PREVIEW_INTERVAL_MS);
  }

  // -------------------------------------------------------------------------------------------------------------------
  // commands

  async refreshBluetooth(): Promise<BluetoothState> {
    const state = await this.native().bluetoothState();
    this.set({ bluetooth: state });
    return state;
  }

  async startScan(): Promise<void> {
    this.found.clear();
    this.set({ results: [], scanError: null });
    await this.native().startScan();
  }

  async stopScan(): Promise<void> {
    await this.native().stopScan();
  }

  connect(id: string): Promise<void> {
    return this.native().connect(id);
  }

  disconnect(id: string): Promise<void> {
    return this.native().disconnect(id);
  }

  disconnectAll(): Promise<void> {
    return this.native().disconnectAll();
  }
}
