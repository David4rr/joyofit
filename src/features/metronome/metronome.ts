/**
 * The cadence metronome, shared by the live screen of a watch-started workout and the Run recorder.
 *
 * Each beat is a short vibration (`Vibration` from React Native): the app has no audio package, and adding one is a native change
 * that cannot ship over the air. One engine for the whole app, so the beat goes on while the person moves between screens; it
 * stops when switched off, or when the workout screen that started it reports the workout over (`useStopMetronomeWhen`).
 *
 * Limit: beats are scheduled from JS timers. They keep going with the screen off only while the app process and its JS thread are
 * kept alive, which on Android is the case during a recording (foreground service); on a watch-started workout the screen
 * holds the device awake instead (see `LiveWorkoutScreen`). Android may still throttle timers of an app it has put to sleep.
 * The on/off state is not stored: the metronome is always off after the app starts. Only the tempo is kept.
 */
import Storage from 'expo-sqlite/kv-store';
import { useEffect, useSyncExternalStore } from 'react';
import { Vibration } from 'react-native';

import { BEAT_PULSE_MS, beatIntervalMs, clampBpm, DEFAULT_BPM, nextBeatAt } from './metronomeModel';

const BPM_KEY = 'joyofit.metronome.bpm';

export interface MetronomeState {
  enabled: boolean;
  bpm: number;
}

function readBpm(): number {
  try {
    const text = Storage.getItemSync(BPM_KEY);
    return text === null ? DEFAULT_BPM : clampBpm(Number(text));
  } catch {
    return DEFAULT_BPM;
  }
}

let state: MetronomeState | null = null;
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setTimeout> | undefined;
let dueAt = 0;

function current(): MetronomeState {
  state ??= { enabled: false, bpm: readBpm() };
  return state;
}

function commit(next: MetronomeState): void {
  state = next;
  listeners.forEach((listener) => listener());
}

function beat(): void {
  Vibration.vibrate(BEAT_PULSE_MS);
  const now = Date.now();
  dueAt = nextBeatAt(dueAt, now, beatIntervalMs(current().bpm));
  timer = setTimeout(beat, Math.max(0, dueAt - now));
}

function stopTimer(): void {
  clearTimeout(timer);
  timer = undefined;
}

export const metronome = {
  get: current,
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  setEnabled(enabled: boolean): void {
    const now = current();
    if (now.enabled === enabled) return;
    commit({ ...now, enabled });
    stopTimer();
    if (enabled) {
      dueAt = Date.now();
      beat();
    } else {
      Vibration.cancel();
    }
  },
  /** The new tempo takes effect from the next beat. */
  setBpm(bpm: number): void {
    const next = clampBpm(bpm);
    commit({ ...current(), bpm: next });
    try {
      Storage.setItemSync(BPM_KEY, String(next));
    } catch {
      // The tempo still applies for this session.
    }
  },
};

export function useMetronome(): MetronomeState {
  return useSyncExternalStore(metronome.subscribe, current, current);
}

/** Switches the metronome off once `over` is true (the workout ended) and when the calling screen goes away for good. */
export function useStopMetronomeWhen(over: boolean): void {
  useEffect(() => {
    if (over) metronome.setEnabled(false);
  }, [over]);
}

/** Switches the metronome off when the calling screen unmounts: the Run recorder's live view exists only while recording. */
export function useStopMetronomeOnUnmount(): void {
  useEffect(() => () => metronome.setEnabled(false), []);
}
