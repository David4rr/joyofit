# JoyoFit Fuel

A Huawei Lite Wearable (JS) watch app for the Watch Fit 4 and Fit 4 Pro. It reads heart rate on the watch and shows, live,
kcal burned and grams of fat and carbohydrate, with the same model as JoyoFit's live workout screen. Nothing here has run on
a watch or in a simulator yet; see [UNVERIFIED](#unverified).

DevEco Studio 3.1.1 project, SDK 6.0 (API 6), `deviceType` `liteWearable`, bundleName `com.joyodigitama.joyofit.fuel`.
License: AGPL-3.0-or-later, like the rest of the repository.

## What it does

- **Home**: the profile in use (weight, age, sex, maximum heart rate and where it came from), Start, Profile, Resume (only
  when an unfinished session is stored) and the phone link status. Swipe right leaves the app.
- **Session**: elapsed time, heart rate and zone, kcal, grams of fat and carbohydrate, a fat/carbohydrate share bar. Tap the
  numbers to pause or resume. Finish needs two taps within 3 seconds. The screen stays on while the session runs. The watch
  buzzes at start and finish.
- **Summary**: total kcal and time, fat and carbohydrate in grams and share, average and maximum heart rate, time in each
  Huawei heart-rate zone. Estimates only: the watch measures neither fat nor carbohydrate.
- **Profile**: weight (30 to 200 kg in 1 kg steps), age (10 to 99) or birth year, sex, maximum heart rate override
  (Auto = 220 − age, or 100 to 230), each with a picker.
- **Phone link** (optional): JoyoFit sends the profile it knows and the watch app acknowledges it; see
  [Phone link](#phone-link). Without the link the app uses the profile stored on the watch (defaults 70 kg, 35 y, sex not
  set, maximum 185).

Colours come from JoyoFit's palette (`src/theme/themes.ts`, classic dark) on a black AMOLED background: fat `#F0A23C`
(`workouts`), carbohydrate `#58C4DE` (`steps`), heart `#FF8FA4` (`heartText`), as on `LiveWorkoutScreen.tsx` and
`FuelBar.tsx`.

## Honest limits

- It is a separate app. It does not feed the watch's own workout app and cannot read it. Start it next to a workout you
  record with the native app; the two calories will not match.
- Huawei has no data fields: the native workout screens are firmware-owned. This app cannot add a field to them. A Lite
  Wearable JS app is the only programmable surface.
- No background execution. When the app is left (home screen, other app), the app process is destroyed
  ([lifecycle](#sources)). The session is saved and can be resumed from Home, but the time away is counted as a pause
  and no heart rate is read meanwhile. To record a whole workout the app has to stay in the foreground with the screen on,
  which costs battery.
- Heart rate comes from `sensor.subscribeHeartRate`, which Huawei documents as called about every 5 seconds. Each reading
  covers the time since the previous one. A gap over 2 minutes counts as a pause.
- Fat and carbohydrate are an estimate for motivation: no fitness, diet or protein term, and Keytel's equation is only
  roughly valid above about 90 bpm (below, the 1.2 kcal/min floor applies).
- Whether the heart-rate sensor can be subscribed while the watch's own workout app is recording is not known.

## The math

Same numbers as the phone, one function at a time (`entry/src/main/js/default/common/fuel.js`, tested against both):

| Part | Where on the phone |
|---|---|
| kcal per minute from heart rate: Keytel 2005, male and female equations divided by 4.184, unknown sex = mean of both, floor 1.2 kcal/min | `HeartRateEnergy.kcalPerMinute`, `modules/huawei-wear/android/src/main/java/com/joyodigitama/huaweiwear/LiveWorkoutCodec.kt` |
| fat share at a heart rate: Swain %HRmax → %VO2max, RER curve through (25, 0.78) (45, 0.83) (65, 0.88) (85, 0.95) (100, 1.00), `(1 − RER) / 0.3` | `SubstrateEstimator.fatShare` in the same file; same points as `RER_POINTS` in `src/features/workouts/substrate.ts` |
| maximum heart rate 220 − age, kept in 120..220 | `SubstrateEstimator.maxHeartRate` |
| zones: below 50 %, then 50/60/70/80/90 % of maximum | `zoneOf` in `substrate.ts` |
| 9 kcal per g fat, 4 kcal per g carbohydrate | `KCAL_PER_G_FAT`, `KCAL_PER_G_CARB` |
| defaults 35 y and 70 kg | `LiveWorkout.DEFAULT_AGE`, `DEFAULT_WEIGHT_KG` in `LiveWorkout.kt` |

A reading's slice (time since the previous reading) gets Keytel energy at the new reading's heart rate and that heart
rate's fat share, as `LiveWorkout.onHeartRate` does. `substrate.ts`, which splits a finished workout, gives a slice to the
reading at its start; with readings every 5 s the totals differ by one reading's shift. The phone caps one reading's
slice at 10 s, the watch counts up to 120 s (the contract rule).

## Project layout

```
watchapp/fuel/
  README.md
  icon.svg                         source of the two icons
  scripts/make-icons.ts            icon.svg -> icon.png (114) and icon_small.png (80), with @resvg/resvg-js from faces/
  build.gradle settings.gradle gradle.properties package.json
  entry/
    build.gradle proguard-rules.pro
    src/main/config.json           app, permissions, peer authorisation, pages
    src/main/resources/base/       element/string.json, media/icon.png, media/icon_small.png
    src/main/js/default/
      app.js
      common/fuel.js               the math and the session accumulator (pure, time injected)
      common/format.js             number and time text (pure)
      common/profile.js            profile, precedence of phone and watch copies (pure)
      common/store.js              @system.storage wrapper: profile, running session, last session
      common/link.js               Wear Engine P2P per contract, every call guarded
      common/config.js             PEER_PKG, PEER_FINGERPRINT, bundle name, version
      common/wearengine.js         PLACEHOLDER for Huawei's file, see Phone link
      pages/index|session|summary|profile/*.hml *.css *.js
  test/                            bun tests
```

Pages hand state to each other through `@system.storage` (keys `fuel.profile`, `fuel.session`, `fuel.last`), not through
module variables: Huawei's page-size limit is per page, which suggests every page is bundled with its own copy of its
imports.

## Build and sign

Needs Windows, DevEco Studio 3.1.1 and the HarmonyOS SDK 6.0 (API 6), and a verified Huawei developer account. None of
that is available in this repository's environment, so no `.hap` is built here and no signed package is committed.

1. DevEco Studio 3.1.1 and SDK 6.0: the Chinese archive of DevEco Studio has 3.1.1; the SDK 6.0 files and the Huawei
   DevEco Assistant APK are collected in `github.com/justvladcreate/Guide-to-develop-Litewearables-2026` (CC0). In
   DevEco: Tools → SDK Manager → point it at the unpacked SDK, tick 2.2.0 (API 6). If the build stops with
   `Cannot find module 'webpack.js'`, run `npm install --ignore-scripts` in the project folder (same guide).
2. Open `watchapp/fuel` in DevEco Studio. It resolves the Gradle plugins `com.huawei.ohos:hap:3.1.5.0` and
   `decctest:1.2.7.20` named in `build.gradle` (copied from the `espinr/litewearable` sample; DevEco may offer its own).
3. AppGallery Connect: create an app with package name `com.joyodigitama.joyofit.fuel`.
4. Register the watch's UDID (below) under Certificates, app IDs, and profiles → Devices. A debug profile lists at most
   10 UDIDs.
5. Request a debug certificate: in DevEco, File → Project Structure → Signing Configs, generate a key store and CSR, upload
   the CSR in AppGallery Connect, download the `.cer`. Request a debug profile (`.p7b`) for the app, the debug
   certificate and the watch's UDID. Configure the app's public key fingerprint in AppGallery Connect if it asks.
6. Enter key store, `.cer` and `.p7b` under Signing Configs, then Build → Build Hap(s)/APP(s) → Build Hap(s). The signed
   package is
   `build/outputs/hap/debug/liteWearable/entry-bin-debug-lite-signed.hap`
   (path from the justvladcreate guide).
7. Release alternative: an AppGallery release signed by Huawei, which installs on any watch. Add the `distroFilter`
   for the 408 × 480 rectangular screen that Huawei's guide describes for AppGallery distribution.

### Getting the watch's UDID

Huawei's procedure for sports watches (AppGallery Connect help, "Registering a Device"): install HUAWEI DevEco Assistant
and HUAWEI Health, open DevEco Assistant → **Lite Wearable** tab → **Connect** (opens HUAWEI Health) → Devices → Add →
Smart Watch → pick the model → **PAIR**. When pairing succeeds DevEco Assistant shows the model and the UDID with a Copy
button. The watch is therefore bound to HUAWEI Health for this step. Afterwards bind it to JoyoFit again (JoyoFit's
Watch → pairing flow, or remove it in HUAWEI Health first). The signed debug package only installs on a watch whose UDID
is in the profile.

## Install

Debug packages can be installed with Huawei's tooling (copy the `.hap` to `/sdcard/haps/` on the phone, DevEco
Assistant → Apps; that needs the watch bound to HUAWEI Health). With JoyoFit: Watch → Apps → **Install from file**, pick
the signed `.hap`. UNVERIFIED that the watch accepts a package over JoyoFit's file upload (file type 6, App service
`0x2a`, as Gadgetbridge does) and that the watch accepts a debug-signed package that way.

Install errors Huawei lists: 40 configuration file format error (label over 22 characters, icon larger than 114 × 114),
31 signature verification (UDID not in the signature, more than 10 UDIDs, certificate expired), 47 invalid
`app.apiVersion` (lower `compatibleSdkVersion` in `entry/build.gradle` from 6 to 3), 34 internal error (a single JS page
over 48 KB), 10 memory allocation, 15 maximum number of third-party apps, 16 version older than the installed one,
30 incomplete signature data.

## Phone link

The watch app and JoyoFit talk over Wear Engine P2P, which on the phone side is the `34/01` P2P service (`P2pStack`).
The contract, both sides must follow it exactly:

| What | Value |
|---|---|
| Watch app bundleName | `com.joyodigitama.joyofit.fuel` |
| Phone app package | `com.joyodigitama.joyofit` (`PEER_PKG`) |
| Phone fingerprint | SHA-256 of JoyoFit's APK signing certificate, uppercase hex, no separators (64 characters) |
| Messages | UTF-8 JSON, field `v` = 1, at most 1 KB |

- watch → phone `{"v":1,"t":"hello","ver":"1.0.0","profileAt":<ms, 0 if none>}` when the app starts.
- phone → watch `{"v":1,"t":"profile","weightKg":72.5,"age":34,"sex":"male"|"female"|"unknown","maxHr":186,"restHr":58|null,"at":<ms>}`,
  in reply to hello, after the link connects, on "Send profile now", and when the profile changes.
- watch → phone `{"v":1,"t":"ack","at":<at it stored>}` after storing a profile.
- `at` on the phone moves whenever any value of the sent tuple (weight, age, sex, `maxHr`, `restHr`) changes, not only
  on a weight, birth year or sex edit, so a changed resting heart rate or a new year's age also reaches the watch.
- Precedence: a received profile replaces the stored one only when its `at` is newer than the stored `at`. A watch that
  holds none yet (never edited, nothing received) takes any profile including `at` 0, which JoyoFit sends when it has no
  saved profile. An edit on the watch sets `at` to the watch clock and `src` `watch` (and still wins when the watch clock
  is behind: `at` becomes the stored `at` plus 1). One storage key `fuel.profile` holds the profile with `at` and `src`.
- `maxHr` from the phone is 220 − age. When it equals that, the watch keeps "automatic"; otherwise it keeps the value as
  the override.

The link runs on the home page only (it registers the receiver there and unregisters when the page is left). A session
page does not listen, so JoyoFit's availability ping answers only while Home is open, and a profile sent during a session
is taken the next time Home opens.

### Wear Engine SDK file (not vendored)

`common/wearengine.js` is a placeholder that exports `null` for `P2pClient`, `Message`, `Builder` and `PeerDeviceClient`.
With it the app builds and runs, the link reports "Phone link off: Wear Engine SDK not installed", and the watch uses the
profile stored on it.

Huawei's real `wearengine.js` is not in this repository. Huawei distributes it as a download, "Wear Engine SDK (Lite
Wearable Devices)", version 5.0.2.306, on
`developer.huawei.com/consumer/en/doc/connectivity-Library/litewearable-sdk-cn-0000001705004353` (zip checksum
SHA-256 `64130a347647f00d734662523b5a26daca015e87ece7d5d916f19753759a1b56`). A copy in
`Explore-In-HMOS-Wearable/sportwatch-wear-engine-lite-wearable-to-mobile` carries an Apache-2.0 header
("Copyright (c) 2021 Huawei Device Co., Ltd.", "Version: lite wearable 5.0.2.306"). It is not vendored here because the
license of the official download is not stated on the page, a third-party copy cannot be checked against Huawei's
checksum (which is for the zip), and the SDK is Huawei's to version. To use the link:

1. Download the zip from the page above, unpack `wearengine.js`.
2. Overwrite `entry/src/main/js/default/common/wearengine.js` with it. Its exports (`P2pClient`, `Message`, `Builder`,
   `PeerDeviceClient`) are the names `link.js` imports. Do not commit the file.
3. Huawei's note on that SDK: "use Compile SDK version 10 in DevEco Studio". The DevEco 3.1.1 / SDK 6.0 flow uses
   compile SDK 6, and the SDK file imports `@system.wearengine`. Whether the file builds and runs under API 6 is
   UNVERIFIED; the app does not depend on it.

### Fingerprints

1. `PEER_FINGERPRINT` (JoyoFit's certificate, for the watch): in JoyoFit open Watch → Apps → JoyoFit Fuel, tap Copy next
   to the phone fingerprint, and paste it in two places. `entry/src/main/js/default/common/config.js`:
   `PEER_FINGERPRINT`; `entry/src/main/config.json`: `module.metaData.customizeData` entry `supportLists`, value
   `com.joyodigitama.joyofit:<fingerprint>` (Wear Engine's authorisation of a phone app; the lite demos
   `hms-wear-engine-demo` and `sportwatch-wear-engine-lite-wearable-to-mobile` carry it). The placeholder
   `PASTE_JOYOFIT_SHA256_HERE` means "not set" and keeps the link off. `test/structure.test.ts` fails when the two copies
   differ. A JoyoFit build signed with another key (debug against release, Play against self-build) has another
   fingerprint.
2. Watch app fingerprint (the destination fingerprint JoyoFit sends): in JoyoFit open Watch → Apps → JoyoFit Fuel → "Watch
   app fingerprint". Huawei's own apps use `<bundleName>_<base64 public key of the signing certificate>`
   (`protocol/README.md`, P2P (b): `com.huawei.health.healthyliving_BBLV5…==`; 88 base64 characters is a 65-byte
   uncompressed EC point). For this app that would be `com.joyodigitama.joyofit.fuel_` followed by the certificate's
   public key, which for a certificate `debug.cer` you can derive with
   `openssl x509 -in debug.cer -noout -pubkey | openssl pkey -pubin -outform DER | tail -c 65 | base64 -w0`.
   UNVERIFIED: that this is the value the watch compares, and whether it compares at all. Left empty, JoyoFit sends the
   bundle name and logs that it did. The value changes between the debug and the release certificate.

## Tests

```
bun test ./watchapp/        # or: bun run test:watchapp
```

| File | What it checks |
|---|---|
| `test/fuel.test.ts` | Keytel and fat-share values from the Kotlin formulas (derivation in comments), the floor, clamps, zones, and equality with `src/features/workouts/substrate.ts` over every age and heart rate |
| `test/session.test.ts` | Accumulator: first reading adds nothing, slice at the new reading's rate, a worked scenario with gap, pause, resume and zones, the 120 s boundary, bad readings and clocks, snapshot/restore with time away as pause, agreement with `splitWorkout` for constant heart rate |
| `test/profile.test.ts` | Defaults, precedence of phone and watch edits (including `at` 0 and a behind watch clock), maximum heart rate override, storage round trip, year and age |
| `test/index-page.test.ts` | Drives the home page with mocked watch modules: a page replaced before storage answered starts no link, and the answer for an earlier page instance is dropped |
| `test/link.test.ts` | Message parsing, hello, profile and ack against a fake SDK, off states (placeholder SDK, no fingerprint, SDK errors), unreachable phone, delay and stop, 1 KB |
| `test/format.test.ts` | Duration, kcal, gram and percent rounding, bar widths |
| `test/structure.test.ts` | `config.json` (bundleName, pages, permissions, supportLists equals `config.js`), every page has `.hml`, `.css` and `.js`, every `<text>` has a width and a height, every `@system.*` import is in the allowed list (`app brightness router sensor storage vibrator`), relative imports resolve, no syntax outside the documented ES6 subset, pages under 48 KB with imports, the math modules use no clock, icon sizes |

The device APIs (`sensor`, `storage`, `router`, `brightness`, `vibrator`, `app`) are not tested; they only run on a watch or
in DevEco's previewer.

## JS the toolchain accepts

Huawei's Lite Wearable JavaScript doc: ES6 is supported, and for Lite Wearable only `let`/`const`, arrow functions,
`class`, default values, destructuring (assignment and binding pattern), enhanced object initialisers, `for-of`, rest
parameters and template strings. HML does not take ES6 syntax. The code uses `var`, plain functions and closures, and
avoids spread, optional chaining, `Promise`, `Map`/`Set`, `Object.assign`/`entries`, `padStart` and `includes`;
`test/structure.test.ts` enforces that list. `Date.now()`, `setInterval`/`clearInterval`, `setTimeout`, template
strings and `.bind` appear in the `espinr/litewearable` and `tjisse/watchnav` samples. Styles: only `.class`, `#id` and
`,` selectors; `text` has no `font-weight`; every `text` needs an explicit `width` and `height`; dynamic bindings work in
inline `style` only; lengths in `px` (logical pixels, 408 × 480 on the Fit 4 and Fit 4 Pro).

## Sources

API facts and where they came from:

| Fact | Source |
|---|---|
| Project layout `entry/src/main/config.json`, `js/default/{app.js,pages,common,i18n}`, `resources/base/{element,media}`; `deviceType` `liteWearable`; `distro`; `abilities` with `$media:icon` and `$string:` label; `js[].pages`; `reqPermissions` with `usedScene` | `espinr/litewearable` (MIT), `HMS-Core/hms-wear-engine-demo` "Lite wearable devices" (Apache-2.0), `Explore-In-HMOS-Wearable/sportwatch-wear-engine-lite-wearable-to-mobile` (MIT) |
| `ohos.permission.READ_HEALTH_DATA` for heart rate | `espinr/litewearable` `config.json`; OpenHarmony docs `js-apis-system-sensor.md` (`@system.sensor`, "Required permissions") |
| `sensor.subscribeHeartRate({success(ret){ret.heartRate}, fail(data, code)})`, `sensor.unsubscribeHeartRate()`, called about every 5 s, unsubscribe in `onDestroy` | OpenHarmony docs `js-apis-system-sensor.md`; usage in `espinr/litewearable` `pages/index/index.js` |
| `storage.get({key, default, success, fail})`, `set`, `delete`, `clear`; module "no longer maintained since API 6" | OpenHarmony docs `js-apis-system-storage.md` |
| `brightness.setKeepScreenOn({keepScreenOn, success, fail})`, "call this API in onShow()" | OpenHarmony docs `js-apis-system-brightness.md`; `espinr/litewearable`, `hms-wear-engine-demo` |
| `router.replace({uri: 'pages/x/x'})`, `router.push`, `router.back` | OpenHarmony docs `js-apis-system-router.md`; Huawei Lite Wearable guide (`router.replaceUrl` named there) |
| `vibrator.vibrate({mode: 'short'\|'long'})`, needs `ohos.permission.VIBRATE` | OpenHarmony docs `js-apis-system-vibrate.md` (`@system.vibrator`) |
| `app.terminate()`, swipe right to exit with `onswipe` and `e.direction` | OpenHarmony docs `js-apis-system-app.md`; Huawei Lite Wearable guide "Exiting the Application"; `tjisse/watchnav`, `hms-wear-engine-demo` |
| Page lifecycle `onInit`, `onReady`, `onShow`, `onHide`, `onDestroy`; app `onCreate`/`onDestroy`; no background run; no screen-off callback | Huawei "Lite Wearables Applications" guide (`developer.huawei.com/consumer/en/doc/lite-wearable-guides/lite-wearable-bpta-guide`) |
| Square watch 408 × 480, `distroFilter`, label ≤ 22 characters, icon 80 × 80 or 114 × 114, JS page ≤ 48 KB, install error codes, `compatibleSdkVersion` 3 for error 47 | same Huawei guide |
| Supported ES6 subset; `text`, `div`, `list`, `picker-view`, `stack` styles and events; `px` lengths; `swipe` event is API 5+ | OpenHarmony docs `arkui-js-lite/*` (`js-framework-syntax-js.md`, `js-components-basic-text.md`, `js-components-container-div.md`, `js-components-basic-picker-view.md`, `js-common-events.md`) |
| `wearengine.js` exports `P2pClient`, `Message`, `Builder`, `PeerDeviceClient`; `setPeerPkgName`, `setPeerFingerPrint`, `registerReceiver({onSuccess,onFailure,onReceiveMessage})`, `send(message, {onSuccess,onFailure,onSendResult,onSendProgress})`, `unregisterReceiver({onSuccess})`, `ping`; `Builder.setDescription`, `message.builder = builder`; the receiver gets `data.message` as a string; `registerReceiver` and `send` fail on an empty fingerprint; the SDK reads its service version asynchronously in the constructor and picks its message API from it | the SDK file itself (Explore-In-HMOS-Wearable copy, read for the API only); `hms-wear-engine-demo`; `tjisse/watchnav` `app.js` (P2P on a Fit 4) |
| Messages ≤ 1 KB, files ≤ 4 MB, the fingerprint is the SHA-256 of the phone app's signing certificate, `config.json` carries the phone app's fingerprint for older firmware | Huawei Wear Engine "App-to-App Message Communications" (lite JS) |
| SDK download, version 5.0.2.306, "use Compile SDK version 10" | Huawei Wear Engine "Integrating the Wear Engine SDK" and "Wear Engine SDK (Lite Wearable Devices)" |
| DevEco 3.1.1 + SDK 6.0, HDEA, Huawei Health, AGC debug certificate and profile, output path `entry-bin-debug-lite-signed.hap` | `justvladcreate/Guide-to-develop-Litewearables-2026` (CC0) |
| UDID for sports watches through DevEco Assistant → Lite Wearable → Connect → pair; at most 10 UDIDs | Huawei AppGallery Connect help "Registering a Device"; the Lite Wearable guide FAQ |
| Watch verifies app signatures; unsigned installs fail | `protocol/README.md` "Why a face did not install"; Gadgetbridge issues #6199, #4175 |
| Lite demos with component examples | `scriptiot/hm_lite_wearable_demos` (Apache-2.0) |

## UNVERIFIED

Nothing in this app has run on a watch or in the DevEco previewer. These assumptions are still open:

1. Everything on the watch: layout, font sizes, the 360 px bar, picker behaviour, the `px` unit meaning logical pixels on
   the Fit 4 / Fit 4 Pro, and that dynamic `style` bindings update `width` and `color`.
2. `@system.storage` exists on the Fit 4 firmware. Huawei marks it unmaintained since API 6; `@system.file` is what the
   `espinr/litewearable` sample uses on a watch. All storage goes through `common/store.js`, the one place to change.
3. `@system.vibrator` and `ohos.permission.VIBRATE` on Lite Wearable (the permission is declared in `config.json`; a
   firmware that rejects it would show as an install error 40). Vibration failures are caught and ignored.
4. The heart-rate sensor: about 5 s between readings on this firmware, the permission prompt, and whether it can run next
   to the native workout app.
5. `onHide`/`onDestroy` run when the user leaves the app. Because that is not guaranteed, a session snapshot is also
   written every 30 s while running.
6. `Date.now()` is right on the watch, and the watch clock is close enough to the phone clock for `at` comparisons (an
   edit on a watch whose clock is behind still wins, see above).
7. The whole phone link: that `wearengine.js` builds under API 6, that `supportLists` in `config.json` is the
   authorisation it needs, the fingerprint formats on both sides, that the receiver gets a string, that registering the
   receiver 800 ms after constructing `P2pClient` is enough (and needed), JoyoFit's ping being answered, and the phone
   parsing the hello.
8. That JoyoFit's file upload installs the `.hap`, and that the watch accepts it signed with a debug profile.
9. `compatibleSdkVersion 6` installs on firmware 6.x without error 47; the Gradle plugin versions in `build.gradle`.
10. `distroFilter` contents for an AppGallery release (not written here).
11. The watch app fingerprint derivation above.

## Device test checklist

Install and start:
- [ ] Package installs (no error 31, 40, 47). Icon shows (split drop). Label reads "JoyoFit Fuel".
- [ ] Home shows "70 kg, 35 y, sex not set, max 185" and "defaults, not set yet". Link line says "Phone link off: …".

Profile:
- [ ] Profile → Weight, Age, Birth year, Sex, Max heart rate: each picker opens on the current value, Save stores it,
      Cancel does not. Home shows the new values and "set on the watch". Birth year and Age agree.
- [ ] Max heart rate "Auto" follows age; a fixed value stays when age changes.

Session:
- [ ] Start: the watch buzzes, the heart rate shows within about 10 s, `--` before. The screen stays on.
- [ ] kcal rises. At about 110 bpm with the defaults it should be about 6.9 kcal/min (0.115 kcal/s) and fat about 65 %;
      about 150 bpm gives about 12 kcal/min and fat about 35 %.
- [ ] Compare with JoyoFit's live workout screen for the same profile and heart rate: kcal per minute and fat share agree.
- [ ] Tap: Paused, elapsed stops, kcal stops, heart rate shows `--`, the screen may sleep. Tap again: it continues and
      the first reading after resume adds nothing.
- [ ] Leave the app (swipe right on Home is only for Home; use the crown or home gesture during a session), come back
      within a minute: the session resumes, the time away is not in the elapsed time.
- [ ] Remove the watch or lose the reading for over 2 minutes: kcal does not jump when readings return.
- [ ] Finish: first tap asks, a second tap within 3 s ends it, the watch buzzes, Summary opens. Without the second tap the
      label returns to Finish.
- [ ] Summary totals equal the last session screen; zones add up to the counted time; Done returns Home and Resume is gone.
- [ ] Kill the app mid-session (home, then reopen): Home shows Resume; Start discards that session.

Phone link (after the Wear Engine file and fingerprints are in):
- [ ] Home shows "Phone link: connecting", then "linked". JoyoFit logs the hello with `profileAt`.
- [ ] JoyoFit sends the profile: Home shows "from JoyoFit" and its values, JoyoFit logs the ack with the same `at`.
- [ ] Edit on the watch, reopen Home: the watch value stays; an older JoyoFit profile does not replace it, a newer one
      (change it in JoyoFit) does.
- [ ] Phone out of range: "phone not reachable", the app keeps working.
- [ ] JoyoFit's Watch → Apps availability check reports the app reachable while Home is open.
