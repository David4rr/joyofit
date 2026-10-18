import { afterEach, describe, expect, it } from 'bun:test';

import type { LocationEvent, ValueEvent, WorkoutSessionOptions } from '../../../modules/ble-sensors/src/BleSensors.types';
import { bytesToHex } from '../sensors/gatt';
import { ensureSensorSchema, type SavedSensor } from '../sensors/store';
import { RecordingController, type HubApi, type SessionApi } from './controller';
import { ensureRecordingSchema, loadJournal } from './journal';
import { openDb } from './testDb';

const T0 = 1_700_000_000_000;

const strap: SavedSensor = {
  id: 'AA:BB:CC:DD:EE:01',
  name: 'Polar H10 1234',
  alias: 'My strap',
  kinds: ['hr'],
  addedAt: 0,
  lastSeen: null,
  battery: null,
  batteryAt: null,
  manufacturer: null,
  model: null,
  autoConnect: true,
};
const idle: SavedSensor = { ...strap, id: 'AA:BB:CC:DD:EE:02', name: 'Old TICKR', alias: null, autoConnect: false };

class FakeHub implements HubApi {
  values: ((e: ValueEvent) => void)[] = [];
  fixes: ((e: LocationEvent) => void)[] = [];
  connects: string[] = [];
  disconnects: string[] = [];
  failConnect: string | null = null;
  onValue(l: (e: ValueEvent) => void) {
    this.values.push(l);
    return () => (this.values = this.values.filter((x) => x !== l));
  }
  onLocation(l: (e: LocationEvent) => void) {
    this.fixes.push(l);
    return () => (this.fixes = this.fixes.filter((x) => x !== l));
  }
  async connect(id: string) {
    if (this.failConnect) throw Object.assign(new Error('bt'), { code: this.failConnect });
    this.connects.push(id);
  }
  async disconnect(id: string) {
    this.disconnects.push(id);
  }
  emitValue(id: string, characteristic: string, hex: string, ts: number) {
    for (const l of this.values) l({ id, ts, service: '', characteristic, value: hex });
  }
  emitFix(ts: number, meters: number) {
    for (const l of this.fixes) l({ ts, lat: 10 + meters / 111_194.93, lon: 20, alt: 100, accuracy: 5, speed: 3, bearing: null });
  }
}

class FakeSession implements SessionApi {
  starts: WorkoutSessionOptions[] = [];
  updates: string[] = [];
  ended = 0;
  failWith: string | null = null;
  async start(o: WorkoutSessionOptions) {
    if (this.failWith) throw Object.assign(new Error('x'), { code: this.failWith });
    this.starts.push(o);
  }
  async update(text: string) {
    this.updates.push(text);
  }
  async end() {
    this.ended += 1;
  }
}

async function setup(sensors: SavedSensor[] = [strap, idle]) {
  const { db, all } = openDb();
  await ensureSensorSchema(db as never);
  await ensureRecordingSchema(db as never);
  const hub = new FakeHub();
  const session = new FakeSession();
  let clock = T0;
  const logs: string[] = [];
  const controller = new RecordingController({
    hub,
    session,
    db,
    now: () => clock,
    profile: () => ({ weightKg: 70, age: 35, sex: 'male' }),
    wheelCircumferenceM: () => 2.105,
    sensors: () => sensors,
    notificationText: (live) => `${live.movingSec}s`,
    log: (m) => logs.push(m),
  });
  /** Advances the fake clock and runs the controller's own tick for every second. */
  const run = (seconds: number, perSecond?: (clockMs: number) => void) => {
    for (let i = 0; i < seconds; i++) {
      clock += 1000;
      perSecond?.(clock);
      controller.tick();
    }
  };
  return { controller, hub, session, db, all, logs, run, clock: () => clock };
}

const hr = (bpm: number) => bytesToHex(new Uint8Array([0x00, bpm]));

let live: RecordingController | null = null;
afterEach(async () => {
  // stop the interval of a controller a test left running
  await live?.discard().catch(() => {});
  live = null;
});

describe('prepare and cancel', () => {
  it('starts the native session, connects only the auto-connect sensors and reports readiness', async () => {
    const { controller, hub, session, run } = await setup();
    live = controller;
    await controller.prepare('run', 'Lari');
    expect(session.starts).toEqual([{ title: 'Lari', text: 'Lari', gps: true }]);
    expect(hub.connects).toEqual([strap.id]);
    const s = controller.getSnapshot();
    expect(s).toMatchObject({ phase: 'ready', sport: 'run', gps: true, sensorIds: [strap.id], status: 'idle', live: null });
    hub.emitFix(T0, 0);
    expect(controller.getSnapshot().fix).toEqual({ accuracyM: 5, ageSec: 0 });
    // nothing is recorded yet, but the age of the fix keeps counting on screen
    run(3);
    expect(controller.getSnapshot().fix).toEqual({ accuracyM: 5, ageSec: 3 });
    expect(controller.getSnapshot().live).toBeNull();
  });

  it('an indoor sport asks for no GPS', async () => {
    const { controller, session } = await setup();
    live = controller;
    await controller.prepare('treadmill', 'Treadmill');
    expect(session.starts[0]!.gps).toBe(false);
  });

  it('cancel disconnects and ends the session without saving anything', async () => {
    const { controller, hub, session, all } = await setup();
    await controller.prepare('run', 'Lari');
    await controller.cancel();
    expect(hub.disconnects).toEqual([strap.id]);
    expect(session.ended).toBe(1);
    expect(controller.getSnapshot().phase).toBe('idle');
    expect(all('SELECT * FROM workouts')).toEqual([]);
  });

  it('keeps going when Android refuses the foreground service, and says so', async () => {
    const { controller, session } = await setup();
    live = controller;
    session.failWith = 'ERR_SERVICE_NOT_ALLOWED';
    await controller.prepare('ride', 'Ride');
    expect(controller.getSnapshot()).toMatchObject({ phase: 'ready', noService: true });
  });

  it('a missing location permission fails the prepare and leaves nothing running', async () => {
    const { controller, session, hub } = await setup();
    session.failWith = 'ERR_LOCATION_PERMISSION';
    await expect(controller.prepare('run', 'Lari')).rejects.toThrow();
    expect(controller.getSnapshot().phase).toBe('idle');
    expect(hub.values).toHaveLength(0);
  });

  it('a Bluetooth error does not stop the recording from being prepared', async () => {
    const { controller, hub } = await setup();
    live = controller;
    hub.failConnect = 'ERR_BLUETOOTH_OFF';
    await controller.prepare('run', 'Lari');
    expect(controller.getSnapshot()).toMatchObject({ phase: 'ready', sensorError: 'ERR_BLUETOOTH_OFF' });
  });
});

describe('a workout from start to saved', () => {
  it('records heart rate and GPS, laps, pauses, and saves it as a phone workout with its sensor', async () => {
    const { controller, hub, session, all, run } = await setup();
    await controller.prepare('run', 'Lari');
    controller.start();
    expect(controller.getSnapshot()).toMatchObject({ phase: 'active', status: 'recording' });

    let meters = 0;
    run(40, (clock) => {
      hub.emitValue(strap.id, '2a37', hr(150), clock);
      hub.emitFix(clock, (meters += 3));
    });
    controller.lap();
    expect(controller.getSnapshot().laps).toHaveLength(1);
    controller.pause();
    expect(controller.getSnapshot().status).toBe('paused');
    run(30); // paused: the clock keeps running, the recording does not
    controller.resume();
    run(20, (clock) => {
      hub.emitValue(strap.id, '2a37', hr(160), clock);
      hub.emitFix(clock, (meters += 3));
    });
    expect(session.updates.length).toBeGreaterThan(0);

    const result = await controller.finish();
    expect(result).not.toBeNull();
    const [row] = all<Record<string, unknown>>('SELECT * FROM workouts WHERE id = ?', result!.workoutId);
    expect(row).toMatchObject({ sport_name: 'Run', imported: 1, device: null, complete: 1 });
    expect(row!.distance).toBeGreaterThan(150);
    expect(row!.avg_hr).toBeGreaterThan(145);
    const summary = JSON.parse(row!.summary_json as string);
    expect(summary.source).toBe('phone');
    expect(summary.sensors).toEqual([{ id: strap.id, name: 'My strap', kinds: ['hr'] }]);
    expect(summary.laps).toHaveLength(2);
    expect(all('SELECT * FROM workout_sensor')).toHaveLength(1);
    // the journal is gone, the radio and the session are released, the controller is idle again
    expect(all('SELECT * FROM recording_state')).toEqual([]);
    expect(all('SELECT * FROM recording_journal')).toEqual([]);
    expect(hub.disconnects).toEqual([strap.id]);
    expect(session.ended).toBe(1);
    expect(controller.getSnapshot().phase).toBe('idle');
  });

  it('a sensor that never sent a heart rate is not listed on the workout', async () => {
    const { controller, run, all } = await setup();
    await controller.prepare('treadmill', 'Treadmill');
    controller.start();
    run(10);
    const result = await controller.finish();
    expect(all('SELECT * FROM workout_sensor WHERE workout_id = ?', result!.workoutId)).toEqual([]);
    expect(JSON.parse(all<{ summary_json: string }>('SELECT summary_json FROM workouts')[0]!.summary_json).kcalSource).toBe('met');
  });

  it('discard drops the journal and the radio but saves nothing', async () => {
    const { controller, run, all, session } = await setup();
    await controller.prepare('treadmill', 'Treadmill');
    controller.start();
    run(12);
    await controller.discard();
    expect(all('SELECT * FROM workouts')).toEqual([]);
    expect(all('SELECT * FROM recording_state')).toEqual([]);
    expect(session.ended).toBe(1);
    expect(controller.getSnapshot().phase).toBe('idle');
  });

  it('writes the journal every ten seconds', async () => {
    const { controller, run, all, db } = await setup();
    live = controller;
    await controller.prepare('treadmill', 'Treadmill');
    controller.start();
    run(25);
    await new Promise((r) => setTimeout(r, 20));
    expect(all<{ n: number }>('SELECT COUNT(*) AS n FROM recording_journal')[0]!.n).toBeGreaterThanOrEqual(20);
    expect(await loadJournal(db, 'phone')).not.toBeNull();
  });
});

describe('restore after the app was killed', () => {
  it('brings the recording back paused, reconnects its sensors and finishes with all samples', async () => {
    const first = await setup();
    await first.controller.prepare('treadmill', 'Treadmill');
    first.controller.start();
    first.run(30, (clock) => first.hub.emitValue(strap.id, '2a37', hr(140), clock));
    // the journal is written; the app dies (no finish, no discard)
    await new Promise((r) => setTimeout(r, 20));
    // a second controller on the same database, as after a restart
    const hub = new FakeHub();
    const session = new FakeSession();
    let clock = T0 + 10 * 60_000;
    const back = new RecordingController({
      hub,
      session,
      db: first.db,
      now: () => clock,
      profile: () => ({ weightKg: 70, age: 35, sex: 'male' }),
      wheelCircumferenceM: () => 2.105,
      sensors: () => [strap, idle],
      notificationText: () => '',
    });
    live = back;
    expect(await back.restore()).toBe(true);
    const s = back.getSnapshot();
    expect(s).toMatchObject({ phase: 'active', status: 'paused', sport: 'treadmill', sensorIds: [strap.id] });
    expect(hub.connects).toEqual([strap.id]);
    expect(session.starts).toHaveLength(1);
    back.resume();
    for (let i = 0; i < 10; i++) {
      clock += 1000;
      hub.emitValue(strap.id, '2a37', hr(150), clock);
      back.tick();
    }
    const result = await back.finish();
    const [row] = first.all<{ duration: number; summary_json: string }>('SELECT * FROM workouts WHERE id = ?', result!.workoutId);
    // 30 s before the kill (31 samples) and 10 s after the resume
    expect(row!.duration).toBeGreaterThanOrEqual(38);
    expect(JSON.parse(row!.summary_json).sensors).toHaveLength(1);
    live = null;
  });

  it('nothing to restore on a clean database', async () => {
    const { controller } = await setup();
    expect(await controller.restore()).toBe(false);
  });
});

describe('a failed save', () => {
  it('keeps the recording so the person can try again', async () => {
    const { controller, run, db, all } = await setup();
    await controller.prepare('treadmill', 'Treadmill');
    controller.start();
    run(15);
    const original = db.withExclusiveTransactionAsync.bind(db);
    let fail = true;
    (db as { withExclusiveTransactionAsync: unknown }).withExclusiveTransactionAsync = async (task: never) => {
      if (fail) throw new Error('disk full');
      return original(task);
    };
    await expect(controller.finish()).rejects.toThrow('disk full');
    expect(controller.getSnapshot()).toMatchObject({ phase: 'active', status: 'finished' });
    fail = false;
    const result = await controller.finish();
    expect(result).not.toBeNull();
    expect(all('SELECT * FROM workouts')).toHaveLength(1);
  });
});
