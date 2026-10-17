/**
 * Route navigation on the watch (P2P module `fitness` <-> `in.huawei.fitness`, business types 5 and 6; Huawei Health's "Send to
 * wearable" of a saved route, and what Gadgetbridge's `HuaweiP2PFitnessData.sendTrack` does). Layout of the file and the
 * handshake: `protocol/README.md`, section "Routes". Native code: `P2pController.pushRoute`, `RouteFile.kt` / `RouteFile.swift`.
 * UNVERIFIED on a watch until the Observations of that section say otherwise.
 */

/** What the watch lists for routes (Huawei Health's `RouteTransferDataHolder` gates). */
export interface RoutesStatus {
  /** The P2P service is available on the current link (the watch is connected and lists 34/01). */
  p2p: boolean;
  /** ExpandCapability 70 (`isSupportRouteDeliver`): the watch takes routes. Without it `pushRoute` rejects with ERR_UNSUPPORTED. */
  deliver: boolean;
  /** ExpandCapability 216: the version-2 file (altitude profile and marker points). Without it the version-1 file (plain line) is sent. */
  altitude: boolean;
  /** ExpandCapability 218: the watch shows a route picture (the route-draw handshake, business types 100 to 102). Not used by JoyoFit yet. */
  image: boolean;
  /** ExpandCapability 272: route scene types (running, cycling, walking) on the watch. Not used by JoyoFit yet. */
  sceneTypes: boolean;
  /** ExpandCapability 318: climb / slope data for cycling routes. Not used by JoyoFit yet. */
  climb: boolean;
}

/**
 * A route to send. `points` is flat: `lat, lon, altitude` for every point (degrees, degrees, metres), so `points.length` is
 * three times the point count; `altitude` is ignored (use 0) when `hasAltitude` is false. At least 2 points, none at 0,0.
 */
export interface WatchRoute {
  /** The name the watch lists the route under: 1 to 100 UTF-8 bytes. A route with the same name already on the watch is not sent again. */
  name: string;
  points: number[];
  hasAltitude: boolean;
  /** Seconds the route took when it was recorded (0 for a planned route). */
  durationSec: number;
}

/** Why the watch refused a route (`RoutePushResult` is only returned for a route that was sent or already there). */
export type RoutePushRefusal = 'full' | 'name-too-long' | 'failed';

export interface RoutePushResult {
  /** The route is on the watch. */
  ok: boolean;
  /** The watch answered the handshake with "already there" (code 3): nothing was uploaded. */
  alreadyOnWatch: boolean;
  /** Code of the watch's handshake answer (1 go on, 2 route list full, 3 already there, 4 failed, 5 name too long); null when it sent none. */
  handshakeCode: number | null;
  /** How many points the watch said it can hold (the file is simplified to at most max(this, 200)); null when it did not say. */
  maxPoints: number | null;
  /** File layout sent: 1 plain line, 2 with altitude profile. 0 when nothing was uploaded. */
  version: 0 | 1 | 2;
  /** Points in the file after simplification; 0 when nothing was uploaded. */
  sentPoints: number;
  /** Bytes of the P2P file (header included); 0 when nothing was uploaded. */
  bytes: number;
  /** Tag 0x02 of the watch's 28/07 upload result (Huawei Health reads 1 as accepted); null when it sent none. */
  uploadStatus: number | null;
  /** Code of the watch's final answer (type 6; 1 saved); null when it sent none within 10 s. */
  answerCode: number | null;
}
