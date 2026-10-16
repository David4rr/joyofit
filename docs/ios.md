# JoyoFit on iOS: the Huawei watch link

The iOS side of `modules/huawei-wear` speaks the same protocol as the Android module, over CoreBluetooth, and exposes the same
JS API (`modules/huawei-wear/src/HuaweiWearModule.ts`). Building the app is in [ios-linux.md](ios-linux.md). Status: pairing, connect,
battery and the activity/sleep sync were run on a real iPhone with the Huawei Watch Fit 4 Pro. **Everything added after that (find my
watch, notifications through ANCS, watch faces, workouts, alarms, health sensor switches, stress, HRV, weather) is tested only on this
Linux box (Java golden vectors, fake watches, SDK type-check) until it is run on the iPhone**; see the last section.

## Layout

```
modules/huawei-wear/
  expo-module.config.json         platforms android + ios (ios.modules, appDelegateSubscribers)
  ios/
    HuaweiWear.podspec            ONE pod, ONE Swift module `HuaweiWear`: ios/*.swift + HuaweiProtocol/Sources/**
    HuaweiProtocol/               SwiftPM package, pure Swift, no dependencies, builds on Linux and macOS/iOS
      Sources/HuaweiProtocol/     crypto, TLV, framing, session, packets, authenticator, initializer, syncs
      Tests/HuaweiProtocolTests/  479 tests; Fixtures/*.json are generated from the Java the Android app runs
      GoldenGen/                  run.sh + Golden*.java: regenerates the fixtures (JDK 17, no Android SDK needed)
    BleTransport.swift ...        CoreBluetooth central, Keychain store, SQLite sync store, HealthKit writer, Expo module
    ModuleLogicTests/             SwiftPM package compiling the same sources as one module; 257 logic tests on Linux
    scripts/                      check-api.mjs (JS API coverage), gen-migrations.mjs (embeds schema/joyofit-db-migrations.json)
```

The protocol is a port of the vendored Gadgetbridge Java (`android/src/main/java/nodomain/**`, AGPL-3.0-or-later, see NOTICE) and of the
Kotlin session layer (`com/joyodigitama/huaweiwear/*.kt`), quirks included. The crypto (SHA-256, HMAC, HKDF, PBKDF2, AES-CBC, AES-GCM
with 16-byte IVs) is written out in the package because CryptoKit rejects what the watch sends and CommonCrypto is not on Linux.

## What is ported

| Layer | Swift | Evidence |
|---|---|---|
| CRC16, TLV/VarInt, slicing, reassembly, TLV encryption | `Packet.swift`, `TLV.swift`, `CRC16.swift` | byte for byte against the Java (`framing.json`, `primitives.json`) |
| Crypto and HuaweiCrypto digests, key derivation | `AES.swift`, `SHA256.swift`, `HuaweiCrypto.swift` | byte for byte against the Java |
| Session (request/response, subscriptions, MTU split) | `Session.swift` | fake watches |
| DeviceConfig packets (LinkParams, SecurityNegotiation, PinCode, HiChain, Auth, Bond, ProductInfo, battery, capabilities...) | `Packets/DeviceConfigPackets.swift` | Java golden |
| HiChain3 / HiChain / HiChain Lite / normal auth, first bind and reconnect | `HuaweiAuthenticator.swift` | fake watch (both sides derived from the Kotlin); real LinkParams, SecurityNegotiation and PinCode frames (`RealWireTests`) |
| Init (product info, time, battery, services, commands, ExpandCapability, account, settings, ...) | `HuaweiInitializer.swift` | fake watch |
| Activity sync: step frames, sleep frames, totals | `Packets/FitnessDataPackets.swift`, `ActivitySync.swift` | Java golden, fake watch |
| Sleep files: 2C/0A downloads, sequence data, dictionary sleep and TruSleep parsers | `FileDownloader.swift`, `SleepSync.swift`, parsers | Java golden (about 3,700 summary cases), fake watch |
| DataSync (0x37): config command, then the whole framework (config/event/point/dictionary builders and parser, capability gates, handler dispatch) | `Packets/DataSyncPackets.swift` (golden), `DataSyncWire.swift`, `DataSyncService.swift` | Java golden for the config command; Kotlin test vectors and a fake watch for the rest |
| Find my watch (DataSync config 900100002, ExpandCapability 79 and 83) | `FindWatch.swift`, `PhoneFeatures.swift` | Java golden, fake watch |
| FileUpload (0x28), watch faces (0x27): list, install a `.hwt`, activate, delete; face customization; photo face | `FileUploader.swift`, `WatchfaceOps.swift`, `WatchfacePackage.swift`, `ZipReader.swift`, `WatchfaceCustomizer.swift`, `PhotoFace*.swift`, `PngDecoder.swift`, `ios/WatchfaceController.swift`, `ios/PhotoFaceController.swift` | Java golden for the GB packets, Kotlin test translations, 10 real `.hwt` files, fake watches |
| Workouts: 17/07..16 packets, GPS file, record builder, sync phase, `workouts` and `workout_points` rows, Apple Health `HKWorkout` + route | `Packets/WorkoutPackets.swift`, `WorkoutSync.swift`, `WorkoutRecord.swift`, `HuaweiGpsParser.swift`, `ios/WorkoutStore.swift`, `HealthKitWriter.swift` | Java golden, fake watch, SQLite tests, plan tests |
| Alarms (08/01-04), health sensor switches (continuous HR, SpO2, TruSleep, alerts), heart-rate zones, live heart rate, automatic stress, HRV spot measure | `Alarms.swift`, `HealthSensors.swift`, `HeartRateZones.swift`, `StressSwitch.swift`, `HrvSpotCodec.swift`, `ios/WatchSettingsFeatures.swift` | Java golden (the stress model bit for bit), Kotlin test translations, scripted watch |
| Weather (0x0F, current + 24 h + 8 days, GPS, unit) over Open-Meteo, CoreLocation, URLSession | `Packets/WeatherPackets.swift`, `HuaweiWeather.swift`, `OpenMeteo.swift`, `ios/WeatherController.swift`, `ios/CoreLocationSource.swift` | Java golden, recorded Open-Meteo answers, scripted watch |
| Notifications: the watch's own switch (02/04) and `CBPeripheral.ancsAuthorized` | `Packets/NotificationPackets.swift`, `ios/WatchNotifications.swift`, `BleTransport.swift` | Java golden, scripted watch |

Not ported (the Android module has them; the iOS module reports them as unsupported or inert, see below): cycle, diet and body metrics,
activity-ring goals, P2P (healthy living, courses), fall detection, the morning sleep report, live workouts (phone GPS to the watch),
and what iOS cannot do at all: forwarding other apps' notifications, find my phone, calls and call control, SOS text messages.

## Features iOS cannot do, and what the app says

- **Notifications.** iOS gives an app no access to other apps' notifications, so there is no forwarding and no per-app list. The watch reads
  the iPhone's notifications itself over ANCS once the user allows it (Settings > Bluetooth > the watch > Show Notifications, or the system
  prompt). JoyoFit switches the watch's own notification setting (02/04, only after the user chose in the app, so a switch set elsewhere is
  left alone) and shows `CBPeripheral.ancsAuthorized` as "iPhone shares notifications with the watch" (log line `ANCS ... authorized`).
- **Find my phone, calls, call control.** iOS suspends the app and gives it no call access, so the Settings screen explains this instead of
  offering switches. **SOS text messages**: iOS does not let an app send an SMS by itself.
- Screens of features that are merely not ported yet (meals, goals, cycle, healthy living, running courses, live workout, fall detection,
  morning report) show "not available on iOS yet" instead of controls that would fail.

## The JS API on iOS

All 95 members of the Android module's TS interface exist (`node modules/huawei-wear/ios/scripts/check-api.mjs` prints the split): 53
implemented, 10 inert getters returning the disabled shape, 4 no-ops, 9 off-switches (`false` resolves, `true` rejects), and 18 that
reject `ERR_UNSUPPORTED` ("not available on iOS yet"). The screens of the last three groups say why on iOS instead of offering the control
(`src/components/IosUnavailable.tsx`). Nothing claims to have reached the watch unless it did.

## iOS specifics

- **Scan.** FE86 is not advertised, so there is no service filter: a foreground scan matches the advertised name (`HUAWEI WATCH FIT 4 Pro-xxx`,
  same stem rule as Android) or the `0xFDEE` service data. The peripheral identifier is remembered; later connects use
  `retrievePeripherals` first.
- **MTU.** iOS negotiates it. Writes are cut to `maximumWriteValueLength(for: .withoutResponse)` with write-without-response flow
  control; notifications of any size are reassembled. The negotiated length and every chunk size are logged (tag `JoyoFitBle`, support report).
- **First bind replaces the existing binding.** The watch keeps one credential. A first bind needs two confirmations (ACCEPT on the watch and
  iOS's system pairing dialog, which appears by itself; the transport never requests encryption or disconnects meanwhile) and its waits are 120 s.
  The bind-or-reconnect decision comes from SecurityNegotiation tag 0x02 (authType 5 = the watch does not know this phone, 6 = known). A
  background reconnect never starts a bind (`firstBindAllowed: false`): it logs and stops; only an explicit `connect()` from the app binds.
  Android-side findings behind this are in `protocol/README.md` (the 2026-10-16 observations).
- **Background.** `setBackgroundEnabled` means: reconnect the remembered watch when iOS wakes the app for the `bluetooth-central` session
  (pending connect + state restoration), then authenticate, sync and read the battery inside a background task. Nothing runs while the process
  is suspended.
- **Storage.** The auth key, fake MAC and fake id are Keychain items (after first unlock). Sync rows go to the same SQLite file and schema the JS
  reads (`<Documents>/SQLite/joyofit.db`, migrations embedded from `schema/joyofit-db-migrations.json`; `gen-migrations.mjs` regenerates them).
- **Apple Health.** Steps, heart rate, SpO2, resting heart rate, distance, active energy and sleep stages are written with
  `HKMetadataKeySyncIdentifier`/`SyncVersion` so a re-export replaces instead of duplicating (the counterpart of Health Connect's
  `clientRecordId`). Sleep has no session record, so the writer removes this app's overlapping sleep samples first. JoyoFit never reads Health.

## Commands

```bash
export PATH=$HOME/.local/swift-6.4/usr/bin:$HOME/jdk17/bin:$PATH
bun run test:ios-protocol            # swift test in HuaweiProtocol (479 tests)
bun run golden:ios                   # regenerate the Java golden fixtures (then re-run the tests)
cd modules/huawei-wear/ios/ModuleLogicTests && ./link-sources.sh && JOYOFIT_REPO_ROOT=$PWD/../../../.. swift test   # 257 tests
scripts/build-ios-linux.sh --dev     # signed JoyoFit-dev.ipa (docs/ios-linux.md)
```

The package also type-checks against the iPhoneOS SDK (`swiftc -typecheck -sdk <iPhoneOS27.0.sdk> -target arm64-apple-ios16.0
-resource-dir <darwin toolchain>/usr/lib/swift`), and the whole pod compiles and links in the pipeline.

## Needs the real iPhone (untested)

- Install and launch the dev ipa; Bluetooth, HealthKit and (first bind) system pairing prompts.
- Everything in the "What is ported" rows after the sleep files: each was checked only against the Java golden vectors, fake watches and the
  SDK type-check. In particular: whether the Fit 4 Pro reports ExpandCapability 79 and 83 (support report line `ExpandCapability: ...`) and
  rings; that the watch's notification switch (02/04) makes it show the iPhone's notifications once ANCS is authorized (the log shows
  `ANCS ... authorized: yes/no` on connect); a Fit 4 Pro removes unsigned watch faces (100014), signed ones need the `signature` argument;
  the HealthKit workout, heart-rate series and route (`HKWorkoutBuilder`, `HKWorkoutRouteBuilder`) were never run; CoreLocation's when-in-use
  prompt for weather; the stress calibration's last-bit agreement of Apple's libm with the Java (Linux glibc matches on all vectors).
- Scanning and connecting to the watch from CoreBluetooth; the real negotiated MTU and chunk sizes; notification delivery order.
- A reconnect with a key bound from iOS (HiChain op2) and a first bind over LE (op1 steps 2 to 4 are unproven on any client; only step 1 was
  seen, from Android, which loses the 514-byte reply on Android 14+).
- State restoration and the background wake path; the Keychain after reinstall; HealthKit replacement on a repeated sync identifier; expo-sqlite
  sharing the database file with the native writer (the connection is kept open for the process lifetime because expo-sqlite links its own SQLite).
- `ITSAppUsesNonExemptEncryption=false` is set; the protocol link implements AES/HMAC itself (not through Apple's OS crypto), so the owner has to
  confirm that answer before App Store submission. The prebuild also adds default camera, microphone, photo library and Face ID strings from
  expo-image-picker and expo-secure-store, which JoyoFit does not need.
