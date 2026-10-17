import type { SleepScoreRow } from '@/db/queries';
import { buildNights } from '@/features/sleep/nights';
import type { SleepSegment } from '@/wear';

/** Nights with Automatic stress on that must pass before a watch that recorded none is called unable to. */
export const NIGHTS_TO_CHECK = 3;

export interface NightHrvInput {
  platform: 'android' | 'ios';
  /** Whether the watch listed the automatic stress command the last time it connected; null before any connect. */
  knownSupported: boolean | null;
  /** Automatic stress switch, as last set from this app. */
  enabled: boolean;
  /** Unix seconds of the calibration; null when none was stored. */
  calibratedAt: number | null;
  /** Sleep nights (naps left out) that ended after `calibratedAt`; every night in the window when it is null. */
  nightsSinceSetup: number;
  /** Night HRV rows that ended after `calibratedAt`; every one in the window when it is null. */
  nightRowsSinceSetup: number;
  /** There is a night HRV row anywhere in the readings window. */
  anyNightRowInHistory: boolean;
}

export type NightHrvAvailability =
  | { state: 'available' }
  | {
      state: 'ios' | 'unsupported' | 'off' | 'none-recorded' | 'waiting';
      message: string;
      detail: string;
    };

const ONE_MINUTE_STILL_WORKS = 'a 1-minute reading still works';

/**
 * Why night HRV is or is not arriving, so the app can say so instead of showing empty metrics. Night HRV only comes
 * from the watch's automatic stress records, which need the watch to list the command and the switch to be on.
 */
export function nightHrvAvailability(input: NightHrvInput): NightHrvAvailability {
  if (input.anyNightRowInHistory) return { state: 'available' };
  if (input.platform === 'ios') {
    return {
      state: 'ios',
      message: 'Night HRV is not read on iPhone yet',
      detail: `JoyoFit on iPhone does not read the watch's overnight HRV yet, but ${ONE_MINUTE_STILL_WORKS}.`,
    };
  }
  if (input.knownSupported === false) {
    return {
      state: 'unsupported',
      message: 'Night HRV not available on this watch',
      detail: `It does not offer automatic stress, which is where overnight HRV comes from, but ${ONE_MINUTE_STILL_WORKS}.`,
    };
  }
  if (!input.enabled) {
    return {
      state: 'off',
      message: 'Night HRV is off',
      detail: 'Turn on Automatic stress in Settings > Heart rate and sensors so the watch records HRV while you sleep.',
    };
  }
  if (input.nightsSinceSetup >= NIGHTS_TO_CHECK && input.nightRowsSinceSetup === 0) {
    return {
      state: 'none-recorded',
      message: 'Night HRV not available on this watch',
      detail: `Automatic stress has been on for ${input.nightsSinceSetup} nights and the watch recorded no HRV during sleep, so it may not measure it overnight; ${ONE_MINUTE_STILL_WORKS}.`,
    };
  }
  return {
    state: 'waiting',
    message: 'Night HRV: waiting for the first nights',
    detail: `Wear the watch asleep and sync. ${input.nightsSinceSetup} of ${NIGHTS_TO_CHECK} nights checked.`,
  };
}

/** Message and detail as one text; empty when night HRV is available. */
export function availabilityText(availability: NightHrvAvailability | null | undefined): string | null {
  if (!availability || availability.state === 'available') return null;
  return `${availability.message}. ${availability.detail}`;
}

/** Sleep nights (naps left out) that ended after `sinceSec`; with null, every night in `segments`. */
export function countNightsSince(
  segments: readonly SleepSegment[],
  scores: readonly SleepScoreRow[],
  sinceSec: number | null,
): number {
  return buildNights(segments, scores).filter((n) => !n.nap && (sinceSec === null || n.end > sinceSec)).length;
}

/** Empty-state text of the "HRV, nights" trend card. */
export function nightHrvTrendEmpty(availability: NightHrvAvailability | null | undefined): string {
  return availabilityText(availability) ?? 'No night HRV stored. Wear the watch asleep and sync.';
}

/** Empty-state text of the Recovery trend card. */
export function recoveryTrendEmpty(availability: NightHrvAvailability | null | undefined): string {
  if (availability && ['ios', 'unsupported', 'none-recorded'].includes(availability.state) && 'message' in availability) {
    return `No recovery yet. ${availability.message}, so it needs 1-minute readings: measure HRV for a minute on 5 different days.`;
  }
  return 'No recovery yet. Needs HRV readings (a night with the watch on, or a 1-minute reading) and 4 earlier ones of the same kind in the 30 days before.';
}
