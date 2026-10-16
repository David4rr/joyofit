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
