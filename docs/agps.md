# Satellite data (A-GPS) for the watch

The Huawei Watch Fit 4 Pro (and the rest of the family) shows a warning that its GNSS data has expired and says it needs Huawei Health.
That is the watch's satellite assistance data (ephemeris / almanac): Huawei Health normally downloads it and hands it to the watch every
few days. Without it GPS fixes get slow. JoyoFit does this job on Android and on iOS, with the same wire messages, constants and safety rules.

Code (Android): `modules/huawei-wear/android/.../Ephemeris.kt` (exchange, status, update now), `EphemerisDownload.kt` (HTTP, cache),
`AgpsSource.kt` (where the data comes from), `AgpsPolicy.kt` (schedule, validation), `AgpsStore.kt` (persisted state),
`AgpsModuleApi.kt` (JS API). Code (iOS, `modules/huawei-wear/ios`): `Ephemeris.swift` (`AgpsExchange`, `EphemerisLink`), `AgpsSource.swift`
(source, HTTP, Caches copy), `AgpsStore.swift`, `AgpsReachability.swift`, and in `HuaweiProtocol/Sources/HuaweiProtocol`: `AgpsWire.swift`
(`AgpsPolicy`, `AgpsMessages`) and `Packet+FileChunk.swift` (the `1C/05` frames). UI: `src/features/device/AgpsSection.tsx`, `agps.ts`.
Wire details: `protocol/README.md`, section "AGPS / ephemeris".

## Research findings

### What Gadgetbridge does

- Service `0x1F` (`Ephemeris`) with the file service `0x1C` (`EphemerisFileUpload`) carries it. **The watch drives**: it sends
  `1F/01` op 1 ("I need data"); the phone answers `100000` (or `100007` without network) and asks `1F/02` for the watch's parameters;
  the watch answers with a download **version**, a **tag list** and URLs; the phone says `1F/03` ready (3) / failed (4) / unsupported (5);
  the watch then pulls the files over `1C/01..06` (file list, consult, file info, data request, frames, done).
- Gadgetbridge does **not download anything**. `HuaweiEphemerisManager` reads a user-supplied `ephemeris.zip` (with `time` and
  `ephemeris_config.json`) that the user copies out of Huawei Health, and refuses it when older than 30 minutes. There is no public
  Gadgetbridge source to reuse.
- Service `0x18` (`GpsAndTime`, `SendGpsDataRequest`) is something else: the phone's *location* streamed to the watch during a workout.
  The Fit 4 Pro asks for it about every 20 s while an outdoor workout runs (`LiveWorkout.gpsPing`).
- The phone cannot push data unasked in any known command. Huawei Health's own trigger is not documented; JoyoFit adds a phone-started
  "update now" that sends only the same `1F/02` question the phone sends after op 1 (see "When data is sent").

### Download versions and sources

| Version | Tags | Source | JoyoFit |
|---|---|---|---|
| 0 | none (URLs in the consult) | Broadcom LTO file, `https://gllto.glpals.com/7day/v6/latest/lto.dat` | served |
| 3 | `HW_AGNSS` | Huawei geo server (`geo-dra.platform.hicloud.com`), path from the tag entry, gzip | served only when the user switches on "Pakai server satelit Huawei"; UNTESTED against the real server |
| 1, 2, 3 | `HW_PGNSS_PRED`, `HW_PGNSS_TRANS`, `HW_RSMC_*`, `HW_PRECSION_ION`, config-server ids | Huawei servers; the predictive kinds need Huawei's own decoder or an account credential | declined: state 4, the watch carries on without |

### The Broadcom LTO file (what is served by default)

- Public, plain GET, no account, no key, no app identification. Behind Cloudflare / CloudFront; answers `200`, `binary/octet-stream`.
- Measured 2026-10-18: **115 749 bytes**, starts `FF CA DE 00`, `Last-Modified` a few hours earlier (the file is regenerated several times a day),
  `cache-control: max-age=240`.
- It predicts **7 days** ahead (`/7day/`). The watch warns when its copy is older than that, so JoyoFit counts the data as expired 7 days
  after the server made it (`Last-Modified`, else the download time).
- Licence / terms: Broadcom publishes no terms on the endpoint and it is not a documented public API. JoyoFit treats it as the same
  best-effort public file Huawei Health fetches for older watches. The phone sends no location, no ID and no app name; the server sees the
  IP address (declared in `docs/play-store.md` and `LEGAL.md`). Risk: Broadcom can change or close it without notice; the failure is a
  logged, retried download, never a broken watch.
- Whether the Fit 4 Pro uses version 0 at all is **not yet confirmed**: see "Device findings".

### Huawei's endpoints (off by default)

If the watch asks for version 1 to 3, the data comes from servers run by the watch's maker. Using them is a risk decision for the
owner, not a technical one: `LEGAL.md` and the Play data-safety text say JoyoFit contacts no Huawei server. The code is in place behind
`AgpsStore.huaweiServers` (UI switch "Pakai server satelit Huawei", shown only once the watch has asked for that kind of data), off by
default, sends no Huawei-app identification, and serves only `HW_AGNSS`. Turning it on needs the changes in "Draft: documents to change
if the switch ships" below. The predictive kinds stay declined either way.

## Size, refresh, validity

| What | Value |
|---|---|
| File size | about 115 KB (accepted 16 KiB to 1 MiB for LTO; 4 MiB cap for any other file) |
| Validity | 7 days from the server's `Last-Modified` |
| Phone copy reused for | 6 h (`AgpsPolicy.CACHE_FRESH_MS`), so the watch's repeated asks do not refetch |
| Offered to the watch again after | 24 h (`DELIVER_EVERY_MS`) |
| Download retry after failures | 1 min, 5 min, 15 min, 1 h, then every 6 h; reset by a success or by "Perbarui sekarang" |

## When data is sent

1. **When the watch asks** (`1F/01` op 1): the whole exchange above, answered from the phone copy when it is under 6 h old.
2. **Kept ready**: every completed sync, app or background (Android `WearRuntime.syncComplete` -> `EphemerisLink.onSyncCycle`; iOS the same
   names in `WearRuntime.handleSyncComplete`), refreshes the phone
   copy when it is missing or 6 h old, with the retry schedule, so the watch's next ask is answered at once. Only while the watch has not asked
   for another kind of data.
3. **"Perbarui sekarang"** (Watch tab, Data satelit): downloads fresh data, and with a watch connected asks the watch for its parameters
   (`1F/02`, phone-started) and carries on if it answers. If the watch stays silent for 15 s the data stays ready on the phone and the row says so.
4. **Before a phone-started outdoor workout**: a workout recorded by the phone uses the phone's GPS, not the watch's, so the watch's data does
   not matter there. The workouts that use it are the ones started on the watch; they trigger the watch's own ask (item 1).

## Watch safety rules

- A file is validated before it is offered: size bounds, the LTO header `FF CA DE`, and for other files not empty / not a web page or JSON.
  A bad download is never cached and never sent.
- Every watch request is bounded: data per answer (1 MiB), frames per answer (65 535, and at least one byte each), offsets and names checked;
  anything else is answered `100001` and ends that transfer.
- A transfer that goes silent for 30 s is dropped and recorded as a timeout; a "ready" nobody collects within 60 s is dropped. The download has a
  120 s timeout.
- Cancelling in the app, or a failed download, tells the watch "failed" (state 4) so it does not wait; a lost connection drops everything.
- Nothing here touches pairing, bonding or keys. It uses the already authenticated session, only the services `1F` and `1C`.
- A delivery is recorded only when the watch closed the transfer after every byte had been sent.

## Device findings (Fit 4 Pro, Seiya-B29F)

See the section at the end; updated with each device run.

## Draft: documents to change if the switch ships

Not applied. Apply together with the owner's yes.

`LEGAL.md`, "What JoyoFit is", replace the bullet "It does **not** use a Huawei account ..." with:

```diff
-- It does **not** use a Huawei account, Huawei Health, Huawei cloud services or any Huawei server. The only server contacted
-  for satellite-assist data is Broadcom's public file server (`gllto.glpals.com`), with a plain request and no
-  identification of any app.
+- It does **not** use a Huawei account, Huawei Health or Huawei cloud services. For satellite-assist data it contacts Broadcom's
+  public file server (`gllto.glpals.com`) and, only if you switch on "Use Huawei satellite servers", the public satellite-data address
+  of the watch maker, with a plain request that identifies no app and carries no account or location.
```

`docs/play-store.md`, the satellite-assist note:

```diff
-- Satellite-assist (AGPS): at the watch's request the phone downloads the public Broadcom LTO file ... JoyoFit does not contact Huawei servers; any other assist data the watch asks for is declined. ...
+- Satellite-assist (AGPS): at the watch's request the phone downloads the public Broadcom LTO file ... Only if the user switches on "Use Huawei satellite servers" (off by default) the phone also downloads the watch maker's public satellite file from `geo-dra.platform.hicloud.com`; that server sees the IP address. No account, location or ID is sent in either case, so the declarations above do not change.
```

`site/src/Privasi.tsx`: the same sentence (the page mirrors `play-store.md`). `protocol/README.md` AGPS section: "Every other download version ... JoyoFit does not contact those" becomes "... only with the switch on".

## iOS

The Swift port mirrors the Kotlin code one to one: `AgpsExchange` (an actor; the watch's messages go through one inbox and are handled in
order, the download runs on its own task), `EphemerisLink` (a `LinkObserver` attached to every new session by `WearRuntime`, poked after every
completed sync), `AgpsStore` (UserDefaults suite `joyofit_agps`), `NetworkAgpsSource`, `AgpsPolicy` and `AgpsMessages`. The constants, outcome
strings, wire bytes and safety rules are the Android ones, and the Swift tests (`AgpsTests`, `AgpsExchangeTests`) are ports of `AgpsTest` and
`AgpsExchangeTest` with the same cases and spec bytes. JS API: `getAgps`, `refreshAgps`, `cancelAgps`, `setAgpsHuaweiServers` on the Swift module;
the Watch tab row shows on iOS wherever `HuaweiWear.getAgps` exists.

Differences, all forced by the platform:

- **Network**: `URLSession` with an ephemeral configuration, no cookies, credentials or cache, https only, bodies capped while they arrive
  (a delegate cancels the request once the cap is passed), 30 s without data and 120 s overall. URLSession's default `User-Agent` names the
  app, so it is replaced by the plain `CFNetwork`; no other identifying header is sent. The Android `HttpURLConnection` sends only its
  platform agent.
- **Copy on the phone**: the `Caches/agps` directory (iOS may empty it; that costs a refetch), pruned after a day, aged by the file's
  modification time.
- **Online check**: `NWPathMonitor` instead of `ConnectivityManager`.
- **Watch address**: the stored file name the watch is told (`sha256(address) + name`) is built from the peripheral identifier iOS gives the
  app, since iOS never exposes the watch's Bluetooth address. The watch only stores the file under the name it is given.
- **Background**: the prefetch after a sync runs on the process's own task. An iOS background sync that ends the app's run time may suspend
  it mid-download; the next sync tries again (the download timeout and the retry schedule are unchanged).
- **Not verified on a device**: like the Android side, UNVERIFIED on the Fit 4 Pro until a device run; this file's "Device findings" section is
  the place for it.
