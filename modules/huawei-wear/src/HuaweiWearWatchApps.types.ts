/**
 * Watch apps (the 0x2a app service) and the JoyoFit Fuel link. UNVERIFIED on the Watch Fit 4 Pro: the layouts come from Gadgetbridge,
 * the install flow and the Fuel messages follow `protocol/README.md`. Native code: `WatchApps.kt`, `WatchAppPackage.kt`, `FuelLink.kt`.
 * Android only; iOS rejects these calls with ERR_UNSUPPORTED.
 */

/** What the watch reports about its app runtime (0x2a/0x06). */
export interface WatchAppDeviceParams {
  /** 38 = Lite Wearable. */
  type: number;
  typeName: 'liteWearable' | null;
  osApiLevel: number;
  osVersion: string;
  screenShape: string;
  width: number;
  height: number;
  buildLevel: number;
  buildType: string;
}

/** One app on the watch (0x2a/0x03). */
export interface WatchAppInfo {
  /** The package (bundle) name; pass it to `deleteWatchApp`. */
  packageName: string;
  /** The app's name from the watch; the package name when it gave none. */
  name: string;
  version: string;
  versionCode: number;
  /** Most watches report 0. */
  size: number;
  packageType: number;
}

export interface WatchAppList {
  /** The watch's app runtime; null when it did not answer 0x2a/0x06. */
  params: WatchAppDeviceParams | null;
  apps: WatchAppInfo[];
  /** Unix milliseconds when the list was read. */
  updatedAt: number;
}

/** What `inspectWatchApp` reads from a picked file, without touching the watch. */
export interface WatchAppPackageInfo {
  /** The package name inside the container; the upload is named `<packageName>_INSTALL`. */
  packageName: string;
  /** From config.json `app.bundleName`. */
  bundleName: string | null;
  vendor: string | null;
  /** From config.json `app.version.name`. */
  version: string | null;
  /** The container ends with the `hw signed app` signature trailer. An unsigned app is refused by the watch. */
  signed: boolean;
  /** Size of the container that is uploaded. */
  bytes: number;
  /** Name of the zip entry the container was taken from; null when the file was the container itself. */
  unwrappedFrom: string | null;
  /** `icon_small.png` of the container as base64, when it has one. */
  iconBase64: string | null;
}

/** What `installWatchApp` resolves with when the app was uploaded and the watch did not report a failure. */
export interface WatchAppInstallResult {
  /** The name the container was uploaded under, `<packageName>_INSTALL`. */
  fileName: string;
  packageName: string;
  name: string;
  version: string | null;
  bytes: number;
  signed: boolean;
  /** The status in the watch's end-of-transfer packet (1 = the file was accepted); null when it sent none. */
  uploadStatus: number | null;
  /** The last install state the watch reported: 102 installed; null when it reported none. */
  reportedStatus: number | null;
  /** The package is in the watch's app list afterwards. */
  listed: boolean;
  message: string;
  /** The list read after the install; null when the watch did not answer. */
  list: WatchAppList | null;
}

export type AppInstallPhase =
  | 'progress'
  | 'installStarted'
  | 'installed'
  | 'installFailed'
  | 'removeStarted'
  | 'removed'
  | 'removeFailed'
  | 'unknown';

/**
 * `onAppInstallStatus`: one 0x2a/0x02 report of the watch. `status` is a percentage up to 100 (`phase` `progress`) or 101 started,
 * 102 installed, 103 failed, 104 removal started, 105 removed, 106 removal failed.
 */
export interface AppInstallStatusEvent {
  status: number;
  /** The package the report names; empty when it names none. */
  packageName: string;
  phase: AppInstallPhase;
}

/** The numbers the JoyoFit Fuel watch app computes with (JSON `t: "profile"`). */
export interface FuelProfile {
  weightKg: number;
  age: number;
  sex: 'male' | 'female' | 'unknown';
  /** 220 - age. */
  maxHr: number;
  /** The newest resting heart rate JoyoFit has stored; null when none. */
  restHr: number | null;
  /** Unix milliseconds the profile went out with: moves whenever weight, age, sex, maxHr or restHr changes; 0 when no profile was ever saved. */
  at: number;
}

/** The link to the JoyoFit Fuel watch app (`com.joyodigitama.joyofit.fuel`) over P2P. */
export interface FuelLinkStatus {
  /** A watch is connected and lists the P2P service (0x34/0x01). */
  available: boolean;
  /** The link's service is registered on the current connection. */
  registered: boolean;
  /** Answer to the last ping; 0xca (202) means the watch app is installed and reachable. */
  pingCode: number | null;
  /** `pingCode` is 0xca; null before an answer. */
  reachable: boolean | null;
  phonePackage: string;
  watchPackage: string;
  /** SHA-256 of JoyoFit's signing certificate, uppercase hex without separators; null when it could not be read. */
  phoneFingerprint: string | null;
  /** The fingerprint typed by the user; empty means the bundle name is sent in its place. */
  watchFingerprint: string;
  /** Unix milliseconds of the watch app's last `hello`; null when it never sent one. */
  lastHelloAt: number | null;
  lastHelloVersion: string | null;
  /** The `at` of the profile the watch app held when it said hello. */
  lastHelloProfileAt: number | null;
  lastProfileSentAt: number | null;
  /** Unix milliseconds of the watch app's last `ack`; null when none. */
  lastAckAt: number | null;
  /** The `at` of the profile the watch app said it stored. */
  lastAckProfileAt: number | null;
  /** What would be sent now. */
  profile: FuelProfile;
}

export interface FuelProfileSendResult {
  /** False when the profile could not be sent (JoyoFit's signing certificate is unreadable). */
  sent: boolean;
  profile: FuelProfile;
}
