/**
 * Runs one phone-recorded workout: owns the `Recorder`, wires it to the sensor hub and the native workout session (GPS, foreground
 * service), writes the crash journal and saves the result. Framework-free (no React, no Expo imports) so the whole flow runs under bun
 * test with fakes; `state/RecorderProvider.tsx` is the thin React shell around it.
 *
 * Phases: `idle` -> `prepare` -> `ready` (sensors connecting, GPS warming up, nothing recorded) -> `start` -> `active` (the Recorder runs,
 * paused or not) -> `finish` (saves) or `discard` -> `idle`. `cancel` leaves `ready` without a workout. After the app was killed
 * mid-workout `restore` brings the `active` phase back, paused.
 */
import type { LocationEvent, ValueEvent, WorkoutSessionOptions } from '../../../modules/ble-sensors/src/BleSensors.types';
import type { ManualSport } from '../workouts/manual';
import type { SavedSensor } from '../sensors/store';
import type { WorkoutSensor } from '../sensors/store';
import type { SensorKind } from '../sensors/gatt';
import { appendJournal, clearJournal, loadJournal, saveJournalState } from './journal';
import { Recorder, type LiveStats, type RecordedLap, type RecordedWorkout, type RecorderMeta, type RecorderStatus } from './recorder';
import type { EnergyProfile } from './energy';
import { saveRecordedWorkout, type SaveDb } from './save';
import type { SQLiteDatabase } from 'expo-sqlite';

export type RecordingPhase = 'idle' | 'ready' | 'active' | 'saving';

/** Outdoor sports record the phone's GPS; the others do not. */
export const GPS_SPORTS: readonly ManualSport[] = ['run', 'walk', 'ride', 'hike'];

export interface RecordingSnapshot {
  phase: RecordingPhase;
  sport: ManualSport | null;
  /** The phone's GPS is part of this recording. */
  gps: boolean;
  status: RecorderStatus;
  /** Null until `start`. Refreshed every second while active. */
  live: LiveStats | null;
  laps: RecordedLap[];
  /** Ids of the sensors this recording asked the radio to connect. */
  sensorIds: string[];
  /** Latest GPS fix, also before `start`, so the screen can say "GPS ready". */
  fix: { accuracyM: number | null; ageSec: number } | null;
  /** The foreground service was refused (Android): the workout runs, but may stop with the screen off. */
  noService: boolean;
  /** Error code of the last failed sensor connect (ERR_BLUETOOTH_OFF, ...), null while fine. */
  sensorError: string | null;
}

export interface FinishResult {
  workoutId: number;
}

export interface SessionApi {
  start(options: WorkoutSessionOptions): Promise<void>;
  update(text: string): Promise<void>;
  end(): Promise<void>;
}

export interface HubApi {
  onValue(listener: (e: ValueEvent) => void): () => void;
  onLocation(listener: (e: LocationEvent) => void): () => void;
  connect(id: string): Promise<void>;
  disconnect(id: string): Promise<void>;
}

export type RecordingDb = SaveDb & Pick<SQLiteDatabase, 'runAsync' | 'getFirstAsync' | 'getAllAsync'>;

export interface RecordingDeps {
  hub: HubApi;
  session: SessionApi;
  db: RecordingDb;
  now: () => number;
  profile: () => EnergyProfile;
  wheelCircumferenceM: () => number;
  /** The paired sensors right now (names for the workout's sensor list, `autoConnect`). */
  sensors: () => readonly SavedSensor[];
  /** Notification text (Android) for the live numbers. */
  notificationText: (live: LiveStats) => string;
  log?: (message: string) => void;
}

/** What the journal remembers of the controller besides the recorder. */
interface JournalMeta {
  recorder: RecorderMeta;
  sensorIds: string[];
  used: string[];
  title: string;
}

const JOURNAL_EVERY_S = 10;
const NOTIFICATION_EVERY_S = 5;

const codeOf = (error: unknown): string => String((error as { code?: unknown } | null)?.code ?? '');

export class RecordingController {
  private snap: RecordingSnapshot = idleSnapshot();
  private readonly listeners = new Set<() => void>();
  private recorder: Recorder | null = null;
  private title = '';
  private used = new Set<string>();
  private connected: string[] = [];
  private timer: ReturnType<typeof setInterval> | null = null;
  private ticks = 0;
  private lastFix: LocationEvent | null = null;
  /** A finished recording whose save failed: kept so the retry does not need the (already closed) recorder. */
  private pending: RecordedWorkout | null = null;
  private off: (() => void)[] = [];
  /** Journal writes run one after the other, never two statements at once. */
  private io: Promise<unknown> = Promise.resolve();

  constructor(private readonly deps: RecordingDeps) {}

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): RecordingSnapshot => this.snap;

  private publish(patch: Partial<RecordingSnapshot> = {}): void {
    const now = this.deps.now();
    const fix = this.lastFix
      ? { accuracyM: this.lastFix.accuracy, ageSec: Math.max(0, Math.floor((now - this.lastFix.ts) / 1000)) }
      : null;
    const recorder = this.recorder;
    this.snap = {
      ...this.snap,
      status: recorder?.status ?? 'idle',
      live: recorder && recorder.status !== 'idle' ? recorder.live(now) : null,
      laps: recorder ? [...recorder.meta().laps] : [],
      fix,
      ...patch,
    };
    for (const l of this.listeners) l();
  }

  // -------------------------------------------------------------------------------------------------------------------
  // lifecycle

  /**
   * Gets ready: starts the native session (GPS for outdoor sports, the foreground service) and connects the paired sensors that are set
   * to auto-connect. Rejects with ERR_LOCATION_PERMISSION when an outdoor sport has no precise location; ask first
   * (`ensureLocation`). Does nothing when a recording is already prepared or running.
   */
  async prepare(sport: ManualSport, title: string): Promise<void> {
    if (this.snap.phase !== 'idle') return;
    const gps = GPS_SPORTS.includes(sport);
    this.title = title;
    this.lastFix = null;
    this.used = new Set();
    this.attach();
    const noService = await this.beginSession(gps, title);
    const ids = this.deps.sensors().filter((s) => s.autoConnect).map((s) => s.id);
    this.snap = { ...idleSnapshot(), phase: 'ready', sport, gps, noService };
    this.beginTimer();
    const sensorError = await this.connectAll(ids);
    this.publish({ sensorIds: ids, sensorError });
  }

  /** Leaves `ready` without recording anything. */
  async cancel(): Promise<void> {
    if (this.snap.phase !== 'ready') return;
    await this.teardown();
    this.snap = idleSnapshot();
    this.publish();
  }

  /** Starts the clock. */
  start(): void {
    const { phase, sport, gps } = this.snap;
    if (phase !== 'ready' || sport === null) return;
    const recorder = new Recorder({ sport, gps, wheelCircumferenceM: this.deps.wheelCircumferenceM(), profile: this.deps.profile() });
    this.recorder = recorder;
    recorder.start(this.deps.now());
    this.snap = { ...this.snap, phase: 'active' };
    this.beginTimer();
    this.persist();
    this.publish();
  }

  pause(): void {
    this.recorder?.pause(this.deps.now());
    this.persist();
    this.publish();
  }

  resume(): void {
    this.recorder?.resume(this.deps.now());
    this.persist();
    this.publish();
  }

  lap(): void {
    this.recorder?.lap(this.deps.now());
    this.persist();
    this.publish();
  }

  /** Brings back a recording the app lost (killed, crashed, phone restarted). True when there was one. */
  async restore(): Promise<boolean> {
    if (this.snap.phase !== 'idle') return false;
    const journal = await loadJournal<JournalMeta>(this.deps.db, 'phone');
    if (!journal) return false;
    const { recorder: meta, sensorIds, used, title } = journal.meta;
    if (meta.status === 'finished' || meta.status === 'idle') {
      await clearJournal(this.deps.db, 'phone');
      return false;
    }
    this.title = title;
    this.used = new Set(used);
    this.lastFix = null;
    this.attach();
    const recorder = Recorder.restore(meta, journal.samples);
    this.recorder = recorder;
    const noService = await this.beginSession(meta.config.gps, title);
    this.snap = { ...idleSnapshot(), phase: 'active', sport: meta.config.sport, gps: meta.config.gps, noService, sensorIds };
    const sensorError = await this.connectAll(sensorIds);
    this.beginTimer();
    this.publish({ sensorError });
    return true;
  }

  /** Ends the workout and saves it. Null when nothing was recorded (then it is discarded). */
  async finish(): Promise<FinishResult | null> {
    const recorder = this.recorder;
    if (this.snap.phase !== 'active' || !recorder) return null;
    this.publish({ phase: 'saving' });
    const workout = this.pending ?? recorder.finish(this.deps.now());
    this.pending = workout;
    await this.flush();
    let result: FinishResult | null = null;
    try {
      if (workout) {
        const saved = this.deps.sensors();
        const sensors: WorkoutSensor[] = [...this.used].map((id) => {
          const s = saved.find((x) => x.id === id);
          return { id, name: s ? (s.alias?.trim() || s.name) : id, kinds: (s?.kinds ?? []) as SensorKind[] };
        });
        result = { workoutId: await saveRecordedWorkout(this.deps.db, workout, sensors) };
      }
    } catch (error) {
      // Nothing is lost: the journal still holds the samples and `pending` the finished workout. Back to `active` with status
      // `finished`: the screen offers to save again.
      this.deps.log?.(`saving the recording failed: ${String(error)}`);
      this.snap = { ...this.snap, phase: 'active' };
      this.publish();
      throw error;
    }
    this.pending = null;
    await this.discardJournal();
    await this.teardown();
    this.snap = idleSnapshot();
    this.publish();
    return result;
  }

  /** Throws the recording away. */
  async discard(): Promise<void> {
    if (this.snap.phase === 'idle') return;
    await this.flush();
    this.pending = null;
    await this.discardJournal();
    await this.teardown();
    this.snap = idleSnapshot();
    this.publish();
  }

  /** One second of the clock; also called when the app comes back to the foreground to fill the seconds a throttled thread missed. */
  tick(): void {
    // While getting ready nothing is recorded, but the GPS age on the screen keeps counting.
    if (this.snap.phase === 'ready') {
      this.publish();
      return;
    }
    const recorder = this.recorder;
    if (!recorder || this.snap.phase !== 'active') return;
    const now = this.deps.now();
    recorder.tick(now);
    this.ticks += 1;
    if (this.ticks % JOURNAL_EVERY_S === 0) this.persist();
    if (this.ticks % NOTIFICATION_EVERY_S === 0 && recorder.status === 'recording') {
      void this.deps.session.update(this.deps.notificationText(recorder.live(now))).catch(() => {});
    }
    this.publish();
  }

  // -------------------------------------------------------------------------------------------------------------------
  // internals

  private attach(): void {
    this.detach();
    this.off = [
      this.deps.hub.onValue((e) => {
        if (this.recorder && this.snap.phase === 'active' && this.recorder.sensor(e.characteristic, e.value, e.ts)) this.used.add(e.id);
      }),
      this.deps.hub.onLocation((e) => {
        this.lastFix = e;
        if (this.recorder && this.snap.phase === 'active') {
          this.recorder.fix({ ts: e.ts, lat: e.lat, lon: e.lon, alt: e.alt, accuracy: e.accuracy, speed: e.speed });
        }
        if (this.snap.phase === 'ready') this.publish();
      }),
    ];
  }

  private detach(): void {
    for (const off of this.off) off();
    this.off = [];
  }

  private beginTimer(): void {
    clearInterval(this.timer ?? undefined);
    this.ticks = 0;
    this.timer = setInterval(() => this.tick(), 1000);
  }

  /** True when the Android foreground service was refused. */
  private async beginSession(gps: boolean, title: string): Promise<boolean> {
    try {
      await this.deps.session.start({ title, text: title, gps });
      return false;
    } catch (error) {
      if (codeOf(error) === 'ERR_SERVICE_NOT_ALLOWED') {
        this.deps.log?.('the foreground service was refused; recording without it');
        return true;
      }
      this.detach();
      throw error;
    }
  }

  /** Connects every id; the first error code is kept (the rest are logged), none stops the others. */
  private async connectAll(ids: readonly string[]): Promise<string | null> {
    let first: string | null = null;
    this.connected = [...ids];
    await Promise.all(
      ids.map(async (id) => {
        try {
          await this.deps.hub.connect(id);
        } catch (error) {
          first ??= codeOf(error) || String(error);
          this.deps.log?.(`connect ${id} failed: ${String(error)}`);
        }
      }),
    );
    return first;
  }

  private persist(): void {
    const recorder = this.recorder;
    if (!recorder) return;
    const samples = recorder.drainNew();
    const meta: JournalMeta = { recorder: recorder.meta(), sensorIds: this.snap.sensorIds, used: [...this.used], title: this.title };
    const now = this.deps.now();
    this.io = this.io
      .then(() => appendJournal(this.deps.db, 'phone', samples))
      .then(() => saveJournalState(this.deps.db, 'phone', meta, now))
      .catch((e) => this.deps.log?.(`journal write failed: ${String(e)}`));
  }

  private async flush(): Promise<void> {
    this.persist();
    await this.io;
  }

  private async discardJournal(): Promise<void> {
    await this.io;
    await clearJournal(this.deps.db, 'phone');
  }

  private async teardown(): Promise<void> {
    clearInterval(this.timer ?? undefined);
    this.timer = null;
    this.detach();
    this.recorder = null;
    await Promise.all(
      this.connected.map((id) =>
        this.deps.hub.disconnect(id).catch((e) => this.deps.log?.(`disconnect ${id} failed: ${String(e)}`)),
      ),
    );
    this.connected = [];
    await this.deps.session.end().catch((e) => this.deps.log?.(`ending the session failed: ${String(e)}`));
  }
}

function idleSnapshot(): RecordingSnapshot {
  return { phase: 'idle', sport: null, gps: false, status: 'idle', live: null, laps: [], sensorIds: [], fix: null, noService: false, sensorError: null };
}
