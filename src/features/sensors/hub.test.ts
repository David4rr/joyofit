import { describe, expect, it } from 'bun:test';

import type { ConnectionEvent } from '../../../modules/ble-sensors/src/BleSensors.types';
import { bytesToHex } from './gatt';
import { SensorHub, type BleSensorsApi, type SensorInfo } from './hub';

class FakeNative implements BleSensorsApi {
  handlers = new Map<string, (event: never) => void>();
  calls: string[] = [];
  states: ConnectionEvent[] = [];
  addListener(name: string, listener: (event: never) => void) {
    this.handlers.set(name, listener);
    return { remove: () => this.handlers.delete(name) };
  }
  emit(name: string, event: unknown) {
    this.handlers.get(name)!(event as never);
  }
  async bluetoothState() {
    return 'on' as const;
  }
  async startScan() {
    this.calls.push('startScan');
  }
  async stopScan() {
    this.calls.push('stopScan');
  }
  async connect(id: string) {
    this.calls.push(`connect ${id}`);
  }
  async disconnect(id: string) {
    this.calls.push(`disconnect ${id}`);
  }
  async disconnectAll() {
    this.calls.push('disconnectAll');
  }
  async connectionStates() {
    return this.states;
  }
}

const hex = (...b: number[]) => bytesToHex(new Uint8Array(b));

async function setup() {
  const native = new FakeNative();
  let clock = 1_000_000;
  const hub = new SensorHub(() => native, () => clock);
  await hub.start();
  return { native, hub, tick: (ms: number) => (clock += ms) };
}

describe('SensorHub', () => {
  it('lists scan results with their kinds, strongest first, de-duplicated', async () => {
    const { native, hub } = await setup();
    native.emit('onScanState', { scanning: true, error: null });
    native.emit('onScanResult', { id: 'A', name: 'Polar H10', rssi: -70, services: ['180d'] });
    native.emit('onScanResult', { id: 'B', name: null, rssi: -50, services: ['1816', '1818'] });
    native.emit('onScanResult', { id: 'A', name: 'Polar H10', rssi: -60, services: ['180d'] });
    const s = hub.getSnapshot();
    expect(s.scanning).toBe(true);
    expect(s.results.map((r) => [r.id, r.kinds, r.rssi])).toEqual([
      ['B', ['power', 'csc'], -50],
      ['A', ['hr'], -60],
    ]);
  });

  it('starting a new scan clears the old list', async () => {
    const { native, hub } = await setup();
    native.emit('onScanResult', { id: 'A', name: 'x', rssi: -60, services: ['180d'] });
    native.emit('onScanState', { scanning: true, error: null });
    expect(hub.getSnapshot().results).toEqual([]);
    native.emit('onScanState', { scanning: false, error: 'ERR_BLUETOOTH_OFF' });
    expect(hub.getSnapshot()).toMatchObject({ scanning: false, scanError: 'ERR_BLUETOOTH_OFF' });
  });

  it('tracks the link state, the kinds a connection found and persists them via onInfo', async () => {
    const { native, hub } = await setup();
    const infos: SensorInfo[] = [];
    hub.onInfo((i) => infos.push(i));
    native.emit('onConnection', { id: 'A', state: 'connecting', services: [], error: null });
    expect(hub.getSnapshot().links.A!.state).toBe('connecting');
    native.emit('onConnection', { id: 'A', state: 'connected', services: ['180d'], error: null });
    expect(hub.getSnapshot().links.A).toMatchObject({ state: 'connected', kinds: ['hr'] });
    expect(infos).toEqual([{ id: 'A', kinds: ['hr'] }]);
    native.emit('onConnection', { id: 'A', state: 'disconnected', services: [], error: 'link lost' });
    expect(hub.getSnapshot().links.A).toMatchObject({ state: 'disconnected', error: 'link lost', kinds: ['hr'] });
  });

  it('reads battery, manufacturer and model from the value stream and reports them', async () => {
    const { native, hub } = await setup();
    const infos: SensorInfo[] = [];
    hub.onInfo((i) => infos.push(i));
    native.emit('onValue', { id: 'A', ts: 1, service: '180f', characteristic: '2a19', value: hex(87) });
    native.emit('onValue', { id: 'A', ts: 2, service: '180a', characteristic: '2a29', value: hex(0x50, 0x6f, 0x6c, 0x61, 0x72, 0) });
    native.emit('onValue', { id: 'A', ts: 3, service: '180a', characteristic: '2a24', value: hex(0x48, 0x31, 0x30) });
    expect(hub.getSnapshot().links.A).toMatchObject({ battery: 87, manufacturer: 'Polar', model: 'H10' });
    expect(infos).toEqual([{ id: 'A', battery: 87 }, { id: 'A', manufacturer: 'Polar' }, { id: 'A', model: 'H10' }]);
  });

  it('hands every raw value and fix to the recorder immediately but throttles the preview to one a second', async () => {
    const { native, hub, tick } = await setup();
    const values: string[] = [];
    const fixes: number[] = [];
    hub.onValue((e) => values.push(e.value));
    hub.onLocation((e) => fixes.push(e.lat));
    native.emit('onConnection', { id: 'A', state: 'connected', services: ['180d'], error: null });
    native.emit('onValue', { id: 'A', ts: tick(0), service: '180d', characteristic: '2a37', value: hex(0, 140) });
    native.emit('onValue', { id: 'A', ts: tick(10), service: '180d', characteristic: '2a37', value: hex(0, 141) });
    native.emit('onLocation', { ts: 1, lat: 10, lon: 20, alt: null, accuracy: 5, speed: null, bearing: null });
    expect(values).toHaveLength(2);
    expect(fixes).toEqual([10]);
    // the preview is not published yet
    expect(hub.getSnapshot().links.A!.preview.hr).toBeUndefined();
    await new Promise((r) => setTimeout(r, 1100));
    expect(hub.getSnapshot().links.A!.preview.hr).toBe(141);
  });

  it('learns links that were already up (JS reload)', async () => {
    const native = new FakeNative();
    native.states = [{ id: 'Z', state: 'connected', services: ['1818'], error: null }];
    const hub = new SensorHub(() => native);
    await hub.start();
    expect(hub.getSnapshot().links.Z).toMatchObject({ state: 'connected', kinds: ['power'] });
  });

  it('commands go to the native module', async () => {
    const { native, hub } = await setup();
    await hub.startScan();
    await hub.stopScan();
    await hub.connect('A');
    await hub.disconnect('A');
    await hub.disconnectAll();
    expect(native.calls).toEqual(['startScan', 'stopScan', 'connect A', 'disconnect A', 'disconnectAll']);
    expect(await hub.refreshBluetooth()).toBe('on');
    expect(hub.getSnapshot().bluetooth).toBe('on');
  });
});
