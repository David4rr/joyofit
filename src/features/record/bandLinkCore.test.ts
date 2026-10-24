import { describe, expect, it } from 'bun:test';

import type { WatchWorkoutOutcome, WatchWorkoutResult, WatchWorkoutStatus } from '../../../modules/huawei-wear/src/HuaweiWear.types';
import { BandLink, bandHeartRateHex, bandSportCode, type BandLinkNative } from './bandLinkCore';

class FakeNative implements BandLinkNative {
  calls: string[] = [];
  startOutcome: WatchWorkoutOutcome = 'confirmed';
  startCode: number | null = 100000;
  throwOnStart = false;
  /** Outcome of a pause or resume: a refused one leaves the band's state as it was. */
  operatorOutcome: WatchWorkoutOutcome = 'confirmed';
  status: WatchWorkoutStatus = { connected: true, supported: true, active: false, sport: null, state: null, watchOperator: null };

  getWatchWorkout() {
    return this.status;
  }
  async startWatchWorkout(sport: number): Promise<WatchWorkoutResult> {
    this.calls.push(`start ${sport}`);
    if (this.throwOnStart) throw new Error('boom');
    if (this.startOutcome === 'confirmed' || this.startOutcome === 'sent') this.status = { ...this.status, active: true, sport, state: 'running' };
    return { outcome: this.startOutcome, code: this.startCode };
  }
  async pauseWatchWorkout(): Promise<WatchWorkoutResult> {
    this.calls.push('pause');
    if (this.operatorOutcome !== 'refused') this.status = { ...this.status, state: 'paused' };
    return { outcome: this.operatorOutcome, code: null };
  }
  async resumeWatchWorkout(): Promise<WatchWorkoutResult> {
    this.calls.push('resume');
    if (this.operatorOutcome !== 'refused') this.status = { ...this.status, state: 'running' };
    return { outcome: this.operatorOutcome, code: null };
  }
  async stopWatchWorkout(): Promise<WatchWorkoutResult> {
    this.calls.push('stop');
    this.status = { ...this.status, active: false, state: null };
    return { outcome: 'confirmed', code: null };
  }
}

function make(native: FakeNative | null = new FakeNative(), enabled = true) {
  const stops: string[] = [];
  let listener: ((bpm: number, ts: number) => void) | null = null;
  const band = new BandLink({
    native: () => native,
    enabled: () => enabled,
    heartRate: (l) => {
      listener = l;
      return () => {
        stops.push('hr off');
        listener = null;
      };
    },
  });
  return { band, native, stops, reading: (bpm: number) => listener?.(bpm, 1) };
}

describe('bandSportCode', () => {
  it('uses the Huawei sport types of the sport table', () => {
    expect(bandSportCode('run')).toBe(1);
    expect(bandSportCode('walk')).toBe(2);
    expect(bandSportCode('ride')).toBe(3);
    expect(bandSportCode('treadmill')).toBe(5);
    expect(bandSportCode('indoorRide')).toBe(7);
    expect(bandSportCode('hike')).toBe(14);
  });

  it('has none for a sport the band has no workout for', () => {
    expect(bandSportCode('other')).toBeNull();
  });
});

describe('bandHeartRateHex', () => {
  it('is a heart-rate measurement with an 8-bit value', () => {
    expect(bandHeartRateHex(150)).toBe('0096');
  });

  it('refuses a reading that is no heart rate', () => {
    expect(bandHeartRateHex(0)).toBeNull();
    expect(bandHeartRateHex(300)).toBeNull();
    expect(bandHeartRateHex(Number.NaN)).toBeNull();
  });
});

describe('begin', () => {
  it('a confirmed start is linked, with the sport of the workout', async () => {
    const { band, native } = make();
    expect(await band.begin('run', () => {})).toBe('linked');
    expect(native!.calls).toEqual(['start 1']);
    expect(band.getSnapshot()).toMatchObject({ phase: 'linked', code: null });
  });

  it('a refusal keeps its code and the phone goes on alone', async () => {
    const native = new FakeNative();
    native.startOutcome = 'refused';
    native.startCode = 123002;
    const { band } = make(native);
    expect(await band.begin('run', () => {})).toBe('refused');
    expect(band.getSnapshot()).toMatchObject({ phase: 'refused', code: 123002 });
  });

  it('a start the band did not confirm is treated as not started', async () => {
    const native = new FakeNative();
    native.startOutcome = 'sent';
    const { band } = make(native);
    expect(await band.begin('run', () => {})).toBe('refused');
  });

  it('a throwing native call does not reject', async () => {
    const native = new FakeNative();
    native.throwOnStart = true;
    const { band } = make(native);
    expect(await band.begin('run', () => {})).toBe('refused');
  });

  it('a band that does not list the command, or is not connected, is unavailable', async () => {
    for (const outcome of ['unsupported', 'not_connected'] as const) {
      const native = new FakeNative();
      native.startOutcome = outcome;
      const { band } = make(native);
      expect(await band.begin('run', () => {})).toBe('unavailable');
    }
  });

  it('a build without the native functions is unavailable', async () => {
    const { band } = make(null);
    expect(await band.begin('run', () => {})).toBe('unavailable');
  });

  it('the setting off, or a sport without a band workout, is off and asks for nothing', async () => {
    const off = make(new FakeNative(), false);
    expect(await off.band.begin('run', () => {})).toBe('off');
    expect(off.native!.calls).toEqual([]);
    const other = make();
    expect(await other.band.begin('other', () => {})).toBe('off');
    expect(other.native!.calls).toEqual([]);
  });

  it('takes over a workout the phone already owns on the band instead of starting again', async () => {
    const native = new FakeNative();
    native.status = { ...native.status, active: true, sport: 1, state: 'paused' };
    const { band } = make(native);
    expect(await band.begin('run', () => {})).toBe('linked');
    expect(native.calls).toEqual([]);
    // Agreed state is the band's: a resume is sent, a pause is not.
    await band.setPaused(true);
    expect(native.calls).toEqual([]);
    await band.setPaused(false);
    expect(native.calls).toEqual(['resume']);
  });

  it('passes the heart rate on, also when the band refused to start', async () => {
    const native = new FakeNative();
    native.startOutcome = 'refused';
    const { band, reading } = make(native);
    const seen: number[] = [];
    await band.begin('run', (bpm) => seen.push(bpm));
    reading(142);
    expect(seen).toEqual([142]);
    expect(band.getSnapshot().hr).toBe(142);
  });
});

describe('pause and resume', () => {
  it('are sent once per change, and only to a linked band', async () => {
    const { band, native } = make();
    await band.begin('run', () => {});
    await band.setPaused(true);
    await band.setPaused(true);
    await band.setPaused(false);
    await band.setPaused(false);
    expect(native!.calls).toEqual(['start 1', 'pause', 'resume']);
  });

  it('send nothing to a band that refused the start', async () => {
    const native = new FakeNative();
    native.startOutcome = 'refused';
    const { band } = make(native);
    await band.begin('run', () => {});
    await band.setPaused(true);
    expect(native.calls).toEqual(['start 1']);
  });

  it('a refused pause is not read back as the band resuming', async () => {
    const { band, native } = make();
    await band.begin('run', () => {});
    native!.operatorOutcome = 'refused';
    await band.setPaused(true);
    expect(band.poll()).toBeNull();
  });
});

describe('poll', () => {
  it('reports a pause, a resume and a stop the person did on the band, each once', async () => {
    const { band, native } = make();
    await band.begin('run', () => {});
    expect(band.poll()).toBeNull();
    native!.status = { ...native!.status, state: 'paused' };
    expect(band.poll()).toBe('pause');
    expect(band.poll()).toBeNull();
    native!.status = { ...native!.status, state: 'running' };
    expect(band.poll()).toBe('resume');
    expect(band.poll()).toBeNull();
    native!.status = { ...native!.status, active: false, state: null };
    expect(band.poll()).toBe('stop');
    expect(band.getSnapshot().phase).toBe('ended');
    expect(band.poll()).toBeNull();
  });

  it('does not take our own command for the band: nothing while a command is in flight', async () => {
    const { band, native } = make();
    await band.begin('run', () => {});
    const pending = band.setPaused(true);
    // The band's state has not caught up with the command yet; the poll is silent meanwhile.
    expect(band.poll()).toBeNull();
    await pending;
    expect(native!.calls).toEqual(['start 1', 'pause']);
    expect(band.poll()).toBeNull();
  });

  it('is silent when the band is not linked', async () => {
    const native = new FakeNative();
    native.startOutcome = 'refused';
    const { band } = make(native);
    await band.begin('run', () => {});
    expect(band.poll()).toBeNull();
  });
});

describe('end', () => {
  it('stops a linked band and its heart rate, back to off', async () => {
    const { band, native, stops } = make();
    await band.begin('run', () => {});
    await band.end();
    expect(native!.calls).toEqual(['start 1', 'stop']);
    expect(stops).toEqual(['hr off']);
    expect(band.getSnapshot()).toEqual({ phase: 'off', code: null, hr: null });
  });

  it('also releases a start the band never confirmed, so the live mirror works again', async () => {
    const native = new FakeNative();
    native.startOutcome = 'sent';
    const { band } = make(native);
    await band.begin('run', () => {});
    await band.end();
    expect(native.calls).toEqual(['start 1', 'stop']);
  });

  it('does not stop a workout the band ended itself, and does nothing when idle', async () => {
    const { band, native } = make();
    await band.begin('run', () => {});
    native!.status = { ...native!.status, active: false, state: null };
    band.poll();
    await band.end();
    expect(native!.calls).toEqual(['start 1']);
    await band.end();
    expect(native!.calls).toEqual(['start 1']);
  });
});

describe('adopt', () => {
  it('takes over an open band workout without starting anything', async () => {
    const native = new FakeNative();
    native.status = { ...native.status, active: true, sport: 1, state: 'running' };
    const { band } = make(native);
    expect(await band.adopt('run', () => {})).toBe('linked');
    expect(native.calls).toEqual([]);
    await band.setPaused(true);
    expect(native.calls).toEqual(['pause']);
  });

  it('is off when the band has no workout of ours, but the heart rate is asked', async () => {
    const { band, native, reading } = make();
    const seen: number[] = [];
    expect(await band.adopt('run', (bpm) => seen.push(bpm))).toBe('off');
    reading(120);
    expect(seen).toEqual([120]);
    expect(native!.calls).toEqual([]);
  });
});
