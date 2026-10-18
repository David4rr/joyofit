/**
 * The recording device written into the FIT file Strava gets (`file_id` and the creator `device_info`): the watch
 * the workout came from, as the connected-device info names it. Pure, no React Native imports.
 *
 * Strava derives the device line of an activity from `file_id.manufacturer` + `product` against its own device table
 * (https://developers.strava.com/docs/uploads/ "Device Mapping"); `product_name` is only read by other tools. The FIT
 * SDK has a manufacturer id for Huawei (348) and none for Honor, and no product list for either, so:
 *
 * - a Huawei watch is written as manufacturer 348, the brand that really made it;
 * - anything else (Honor, unknown) keeps the development manufacturer 255: its brand is never replaced by another one;
 * - the product id is a stable 16-bit hash of the model name, because there is no Huawei-assigned number. It is not
 *   Huawei's id; it only keeps one model apart from another, which is what a Strava device mapping needs.
 */

/** FIT `manufacturer` of Huawei in the SDK profile (21.218). */
export const FIT_MANUFACTURER_HUAWEI = 348;
/** FIT `manufacturer` 255, "development": the one a company without an ANT+ assigned id may use. */
export const FIT_MANUFACTURER_DEVELOPMENT = 255;

export interface StravaDevice {
  /** The watch as its maker writes it, e.g. `HUAWEI WATCH FIT 4 Pro`. */
  name: string;
  /** FIT `manufacturer`. */
  manufacturer: number;
  /** FIT `product`: a hash of the model name, see above. */
  product: number;
  /** FIT `software_version` (hundredths of the firmware's major.minor), or null when the firmware is unknown. */
  softwareVersion: number | null;
}

/** The slice of the `device` table row (or the connected watch's info) this needs. */
export interface WatchInfo {
  /** The Bluetooth name, e.g. `HUAWEI WATCH FIT 4 Pro-40A`. */
  name: string;
  /** The watch's firmware, e.g. `5.1.0.222`. */
  softwareVersion: string | null;
}

/** The Bluetooth name without the unit suffix Huawei appends (`-40A`): the model name Strava and Huawei Health show. */
export function modelName(bluetoothName: string): string {
  return bluetoothName.trim().replace(/-[0-9A-Za-z]{2,4}$/, '').trim();
}

/** CRC-16/CCITT-FALSE of the lower-cased name: a stable number in 1..65534 (0 and 65535 are FIT's "none"). */
export function productId(model: string): number {
  let crc = 0xffff;
  for (const byte of new TextEncoder().encode(model.toLowerCase())) {
    crc ^= byte << 8;
    for (let bit = 0; bit < 8; bit++) crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
  }
  return (crc % 65_534) + 1;
}

/** `5.1.0.222` -> 501 (major.minor in hundredths: the field is a uint16 scaled by 100); null when there is no leading `major.minor`. */
export function softwareVersionOf(version: string | null | undefined): number | null {
  const match = version ? /^\s*(\d{1,3})(?:\.(\d{1,2}))?/.exec(version) : null;
  if (!match) return null;
  return Number(match[1]) * 100 + Number(match[2] ?? 0);
}

/** The device block of the file for a watch, or null when there is no named watch. */
export function stravaDevice(watch: WatchInfo | null | undefined): StravaDevice | null {
  const name = watch ? modelName(watch.name) : '';
  if (!name) return null;
  return {
    name,
    manufacturer: /^huawei\b/i.test(name) ? FIT_MANUFACTURER_HUAWEI : FIT_MANUFACTURER_DEVELOPMENT,
    product: productId(name),
    softwareVersion: softwareVersionOf(watch?.softwareVersion),
  };
}
