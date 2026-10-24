/**
 * The band beside a phone-recorded workout (Huawei Health's "connected GPS" run): when a GPS or treadmill workout starts on the phone,
 * the band is told to start the same sport (`17/01`, `modules/huawei-wear/.../WatchWorkout.kt`); the phone's GPS reaches it over the link
 * the band asks for itself (`18/02` -> `18/03`, `WorkoutLink.kt`); the band's heart rate comes back as the recording's heart rate; pause,
 * resume and stop go both ways. Nothing here may get in the way of the recording: a band that refuses, does not answer or is not there
 * leaves the phone recording alone, and the screen says so in one line (`snapshot.phase`).
 *
 * UNVERIFIED on a band: the start command is refused with 123002 on a Fit 4 Pro (`docs/strength.md`) and has not been tried on a Band 11.
 * Framework-free (no React, no Expo imports): the native module is injected so the whole flow runs under bun test. The app's instance, the
 * setting and the hook are in `bandLink.ts`. See `docs/live-run.md`.
 */
import type { WatchWorkoutResult, WatchWorkoutStatus } from '../../../modules/huawei-wear/src/HuaweiWear.types';
import { bytesToHex } from '../sensors/gatt';
import { SPORT_ROWS, type ManualSport } from '../workouts/manual';

export interface BandLinkNative {
  getWatchWorkout(): WatchWorkoutStatus;
  startWatchWorkout(sport: number): Promise<WatchWorkoutResult>;
  pauseWatchWorkout(): Promise<WatchWorkoutResult>;
  resumeWatchWorkout(): Promise<WatchWorkoutResult>;
  stopWatchWorkout(): Promise<WatchWorkoutResult>;
}

/**
 * `off`: no band in this recording (the setting is off, the sport has none, nothing started). `starting`: the start command is on its way.
 * `linked`: the band confirmed the start. `refused`: the band answered no, or did not confirm (the phone records alone). `unavailable`: no
 * band connected, the band cannot be told to start, or this build cannot (the phone records alone). `ended`: the band stopped its workout
 * itself; the phone recording is paused for the person to finish or go on.
 */
export type BandLinkPhase = 'off' | 'starting' | 'linked' | 'refused' | 'unavailable' | 'ended';

export interface BandLinkSnapshot {
  phase: BandLinkPhase;
  /** The result code of a refusal, else null. */
  code: number | null;
  /** The band's latest heart rate while this recording runs, null before the first reading. */
  hr: number | null;
}

const OFF: BandLinkSnapshot = { phase: 'off', code: null, hr: null };

/** What the band did on its own since the last `poll`: the person pressed pause, resume or stop on it. */
export type BandOrder = 'pause' | 'resume' | 'stop';

export interface BandLinkDeps {
  /** The native module, or null on a binary without the functions (or no Huawei module at all). */
  native: () => BandLinkNative | null;
  /** The person's setting "start the band with the run". */
  enabled: () => boolean;
  /**
   * Asks for the band's heart rate for the recording; calls `listener` with every reading. Returns what stops it. Never throws: a band
   * that is not there simply gives no readings.
   */
  heartRate: (listener: (bpm: number, ts: number) => void) => () => void;
  log?: (message: string) => void;
}

/**
 * The Huawei sport the band is told to start for a phone sport (the sport table of `WorkoutSportTypes.kt`: 1 run, 2 walk, 3 ride, 5 treadmill
 * run, 7 indoor ride, 14 hike). Null for a sport the band has no matching workout for. Huawei Health itself passes 1, 2, 3, 5 and 7 through;
 * 14 is the one value here it was not seen to send.
 */
export function bandSportCode(sport: ManualSport): number | null {
  if (sport === 'other') return null;
  return SPORT_ROWS[sport].type;
}

/** A heart-rate reading as the recorder's `2a37` characteristic (flags 0: 8-bit value), or null for a reading that is no heart rate. */
export function bandHeartRateHex(bpm: number): string | null {
  if (!Number.isFinite(bpm) || bpm < 30 || bpm > 250) return null;
  return bytesToHex(new Uint8Array([0x00, Math.round(bpm)]));
}

const errorText = (e: unknown): string => String((e as { message?: unknown } | null)?.message ?? e);

export class BandLink {
  private snap: BandLinkSnapshot = OFF;
  private readonly listeners = new Set<() => void>();
  private queue: Promise<unknown> = Promise.resolve();
  /** Commands in flight: the band's state is in motion then, and `poll` must not mistake our own command for the band's. */
  private busy = 0;
  /** What the band was last told (or last said): the state the recording and the band agree on. */
  private agreed: 'running' | 'paused' = 'running';
  private stopHeartRate: (() => void) | null = null;

  constructor(private readonly deps: BandLinkDeps) {}

  getSnapshot = (): BandLinkSnapshot => this.snap;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  private set(patch: Partial<BandLinkSnapshot>): void {
    this.snap = { ...this.snap, ...patch };
    for (const listener of this.listeners) listener();
  }

  private run<T>(job: () => Promise<T>): Promise<T> {
    this.busy += 1;
    const next = this.queue.then(job, job).finally(() => {
      this.busy -= 1;
    });
    this.queue = next.catch(() => undefined);
    return next;
  }

  /**
   * The recording of `sport` started: tells the band (when the setting is on and the sport has a band workout) and starts reading its
   * heart rate. Resolves with the phase it ended in; never rejects. `onHeartRate` gets every reading.
   */
  begin(sport: ManualSport, onHeartRate: (bpm: number, ts: number) => void): Promise<BandLinkPhase> {
    return this.run(async () => {
      const code = bandSportCode(sport);
      if (!this.deps.enabled() || code === null) {
        this.set({ ...OFF });
        return 'off';
      }
      this.set({ phase: 'starting', code: null, hr: null });
      this.stopHeartRate?.();
      this.stopHeartRate = this.deps.heartRate((bpm, ts) => {
        this.set({ hr: bpm });
        onHeartRate(bpm, ts);
      });
      const native = this.deps.native();
      if (native === null) {
        this.set({ phase: 'unavailable' });
        return 'unavailable';
      }
      // A workout the phone owns on the band already (the screens reloaded, the app did not restart): take it over.
      const open = native.getWatchWorkout();
      if (open.active) {
        this.agreed = open.state === 'paused' ? 'paused' : 'running';
        this.set({ phase: 'linked' });
        return 'linked';
      }
      let result: WatchWorkoutResult;
      try {
        result = await native.startWatchWorkout(code);
      } catch (e) {
        this.deps.log?.(`band start failed: ${errorText(e)}`);
        this.set({ phase: 'refused' });
        return 'refused';
      }
      this.deps.log?.(`band start (type ${code}): ${result.outcome}${result.code !== null ? ` (${result.code})` : ''}`);
      this.agreed = 'running';
      switch (result.outcome) {
        case 'confirmed':
          this.set({ phase: 'linked' });
          return 'linked';
        case 'sent':
        case 'refused':
          this.set({ phase: 'refused', code: result.code });
          return 'refused';
        default:
          this.set({ phase: 'unavailable' });
          return 'unavailable';
      }
    });
  }

  /**
   * A recording the app lost came back (the app was killed mid-run): the heart rate is asked again, and a workout the band still has open
   * from this process is taken over. Otherwise the band is not told anything new (the start belongs to "Mulai").
   */
  adopt(sport: ManualSport, onHeartRate: (bpm: number, ts: number) => void): Promise<BandLinkPhase> {
    return this.run(async () => {
      if (!this.deps.enabled() || bandSportCode(sport) === null) return 'off';
      this.stopHeartRate?.();
      this.stopHeartRate = this.deps.heartRate((bpm, ts) => {
        this.set({ hr: bpm });
        onHeartRate(bpm, ts);
      });
      const open = this.deps.native()?.getWatchWorkout();
      if (open?.active) {
        this.agreed = open.state === 'paused' ? 'paused' : 'running';
        this.set({ phase: 'linked', code: null });
        return 'linked';
      }
      this.set({ phase: 'off', code: null });
      return 'off';
    });
  }

  /** Follows the recording's pause: true pauses the band's workout, false resumes it. Nothing is sent when the band is not linked or already agrees. */
  setPaused(paused: boolean): Promise<void> {
    return this.run(async () => {
      if (this.snap.phase !== 'linked') return;
      const want = paused ? 'paused' : 'running';
      if (this.agreed === want) return;
      const native = this.deps.native();
      if (native === null) return;
      this.agreed = want;
      try {
        const result = await (paused ? native.pauseWatchWorkout() : native.resumeWatchWorkout());
        this.deps.log?.(`band ${paused ? 'pause' : 'resume'}: ${result.outcome}`);
      } catch (e) {
        this.deps.log?.(`band ${paused ? 'pause' : 'resume'} failed: ${errorText(e)}`);
      }
      // Whatever the band answered, it is the truth: a refused pause leaves it running, and the next poll must not read that as an order.
      const state = native.getWatchWorkout().state;
      if (state !== null) this.agreed = state;
    });
  }

  /**
   * What the band did on its own since the last call, for the recording to follow. Call about once a second while recording. A pause
   * or resume on the band, or a stop (the band's workout is gone), each come once.
   */
  poll(): BandOrder | null {
    if (this.snap.phase !== 'linked' || this.busy > 0) return null;
    const native = this.deps.native();
    if (native === null) return null;
    const status = native.getWatchWorkout();
    if (!status.active) {
      this.set({ phase: 'ended' });
      return 'stop';
    }
    if (status.state === 'paused' && this.agreed !== 'paused') {
      this.agreed = 'paused';
      return 'pause';
    }
    if (status.state === 'running' && this.agreed !== 'running') {
      this.agreed = 'running';
      return 'resume';
    }
    return null;
  }

  /** The recording is over (saved, discarded or left): stops the band's workout and its heart rate, back to `off`. Resolves when the band has been told. */
  end(): Promise<void> {
    this.stopHeartRate?.();
    this.stopHeartRate = null;
    return this.run(async () => {
      const { phase } = this.snap;
      this.set({ ...OFF });
      if (phase !== 'linked' && phase !== 'refused') return;
      const native = this.deps.native();
      if (native === null) return;
      try {
        const result = await native.stopWatchWorkout();
        this.deps.log?.(`band stop: ${result.outcome}`);
      } catch (e) {
        this.deps.log?.(`band stop failed: ${errorText(e)}`);
      }
    });
  }
}
