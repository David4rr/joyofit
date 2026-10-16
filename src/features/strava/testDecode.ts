/**
 * Test-only: reads a FIT file back with Garmin's own SDK (`@garmin/fitsdk`, a devDependency), so the tests check our
 * encoder against an independent decoder. Never imported by app code.
 */
import { Decoder, type FitMessages, Stream } from '@garmin/fitsdk';

export interface DecodedFit {
  /** `isFIT()`, and the header and file CRC both match. */
  integrity: boolean;
  errors: string[];
  /** Timestamps are seconds since the FIT epoch, enums are numbers, scale and offset are applied. */
  messages: FitMessages;
}

export function decodeFit(bytes: Uint8Array): DecodedFit {
  const decoder = new Decoder(Stream.fromByteArray(Array.from(bytes)));
  const integrity = decoder.isFIT() && decoder.checkIntegrity();
  const { messages, errors } = decoder.read({ convertDateTimesToDates: false, convertTypesToStrings: false });
  return { integrity, errors: errors.map(String), messages };
}

type DecodedRecord = NonNullable<FitMessages['recordMesgs']>[number];
type DecodedEvent = NonNullable<FitMessages['eventMesgs']>[number];

/** Strava's rest threshold for foot sports, metres per second. */
const STOPPED_BELOW_MS = 0.5;
/** Speed is taken over about this many seconds of records, as GPS noise makes one-second speeds meaningless. */
const SPEED_WINDOW_S = 10;

/** Decoded without `convertDateTimesToDates`, so a timestamp is a number of seconds although the SDK types it as a Date. */
const at = (message: { timestamp?: unknown }): number => Number(message.timestamp ?? 0);

/**
 * An estimate of the moving time Strava shows for a file, from what its support page says
 * (https://support.strava.com/en-us/articles/15401804-moving-time-speed-and-pace-calculations): a file with timer stop
 * events keeps the device's pauses and removes nothing else (the timer time is the moving time); a file without any is
 * measured from the recorded distance, a record counting as moving while the speed over the last ten seconds is at least
 * 0.5 m/s. The stream branch gives 32:24 for the first FIT of the owner's walk, for which Strava showed 32:33.
 */
export function estimateMovingTime(
  records: readonly DecodedRecord[],
  events: readonly DecodedEvent[],
): { seconds: number; from: 'timer events' | 'record stream' } {
  const timer = events.filter((e) => e.event === 0 || String(e.event) === 'timer').sort((a, b) => at(a) - at(b));
  const isStart = (e: DecodedEvent) => e.eventType === 0 || String(e.eventType) === 'start';
  if (timer.filter((e) => !isStart(e)).length > 1) {
    // Timer start / stop pairs: `start`, `stop_all`, `start`, `stop_all`, ...
    let seconds = 0;
    let running: number | null = null;
    for (const e of timer) {
      if (isStart(e)) running ??= at(e);
      else if (running !== null) {
        seconds += at(e) - running;
        running = null;
      }
    }
    return { seconds, from: 'timer events' };
  }
  let seconds = 0;
  for (let i = 1; i < records.length; i++) {
    const now = records[i] as DecodedRecord;
    let j = i - 1;
    while (j > 0 && at(now) - at(records[j] as DecodedRecord) < SPEED_WINDOW_S) j -= 1;
    const then = records[j] as DecodedRecord;
    const speed = ((now.distance ?? 0) - (then.distance ?? 0)) / Math.max(1, at(now) - at(then));
    if (speed >= STOPPED_BELOW_MS) seconds += at(now) - at(records[i - 1] as DecodedRecord);
  }
  return { seconds, from: 'record stream' };
}
