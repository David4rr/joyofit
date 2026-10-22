# Sleep insights (JoyoFit side)

JoyoRogo computes and shows the sleep findings (JoyoRogo, Sleep tab). JoyoFit only keeps the consent switch in view and pushes
nightly rows. Everything here is JS, so it ships over the air (`docs/ota.md`), except the room thermometer's overnight scan on Android
(native, store build; see Room thermometer below).

- **One switch**: `sleep_insight_pref.enabled` on the JoyoRogo server, editable from Settings > JoyoRogo (`SleepInsightsSection`)
  and from JoyoRogo. JoyoFit never stores its own copy as truth: it reads `sleepInsights.status` and writes `setConsent`.
  Turning on shows what is sent first; turning off makes JoyoRogo delete the stored nights, insights and dismissals.
- **Client**: `src/cloud/sleepInsightsClient.ts` (`rogo.sleepInsightsStatus`, `setSleepInsightsConsent`, `pushSleepNights`).
  `consent_required` and 404/405 (older JoyoRogo) are typed outcomes, not exceptions.
- **Payload**: `src/features/sleep/rogoNights.ts` turns `buildNights` output into `Night` rows: one main night per wake date
  (longest non-nap session, the rest naps, max 4), stage seconds only when the watch has stages (Watch Fit 2 sends
  `hasStages: false`), the watch score, overnight HRV (Android readings only) and resting heart rate, the phone's UTC offset
  at the wake-up. Nights the server would refuse (in bed under 1 h or over 20 h, asleep over in-bed) are dropped; HRV/HR
  outside 1..500 ms / 25..220 bpm are left null. An optional `env` (room thermometer summary) is passed through when valid.
  No workout fields, no per-minute data.
- **Push**: `useSleepNightsPush` (mounted on Today next to `useRogoScoresPush`) reads the switch at launch and on foreground,
  pushes only while it is on, debounced 3 s, skipping nights the server already accepted. The first push after the switch is
  seen on sends 90 nights in calls of 14; later pushes the last 14. 404/405 backs off 30 minutes. Logs carry counts only.
- **Privacy**: `LEGAL.md` and `site/src/Privasi.tsx` (id + en) state the exception to "no health data on our server".

## Room thermometer (bedroom temperature and humidity)

The Xiaomi LYWSD03MMC thermometer is the room sensor. With the community firmware JoyoFit reads its Bluetooth **advertisements** (no
connection, no bind key); a unit on the stock firmware is read with a bind key or over a short connection (see "Stock firmware"). It
keeps the raw readings on the phone, and sends only per-night aggregates with the night row. Settings > Termometer kamar
(`src/features/thermometer/ui/ThermometerScreen.tsx`) pairs it, shows the last reading and battery, runs the overnight scan and
says what the sensor needs. The air purifier (PM2.5) is later: nothing here sends `pm25Mean`, the server column is reserved
nullable, and BTHome already carries PM2.5 (object `0x0d`), so a purifier is a decoder case plus a column in `env_sample`, not a redesign.

### What it reads

`src/features/sensors/thermometerAdvert.ts` (pure TypeScript, byte-fixture tests) decodes service data under UUID `0x181A`
(ATC1441 and PVVX custom, told apart by length: 13 and 15 bytes) and `0xFCD2` (BTHome v2) of the community firmware
[pvvx/ATC_MiThermometer](https://github.com/pvvx/ATC_MiThermometer):

| Format | Layout | Resolution |
| --- | --- | --- |
| ATC1441 (13 bytes) | MAC 6 (big-endian), temperature int16 BE, humidity u8, battery u8 %, battery u16 BE mV, counter u8 | 0.1 C, 1 % |
| PVVX custom (15 bytes) | MAC 6 (little-endian), temperature int16 LE, humidity u16 LE, battery u16 LE mV, battery u8 %, counter u8, flags u8 | 0.01 C, 0.01 % |
| BTHome v2 | info byte, then objects: `0x01` battery u8, `0x02` temperature sint16, `0x03` humidity u16 (+ packet id `0x00` as counter); encrypted frames (info bit 0) are skipped | 0.01 C, 0.01 % |

Readings outside -20..60 C or 0..100 % are rejected, a repeat of the same counter is the same measurement (dedupe), and the MAC in
the payload is exposed (`ThermometerReading.mac`) because on iOS the scan id is a peripheral UUID. The fixtures follow the layouts
above; they are not captures from a unit [UNVERIFIED on a real sensor: nobody with a LYWSD03MMC ran this].

### Stock firmware (LYWSD03MMC, MHO-C401, CGG1 and siblings)

A unit on the stock Xiaomi firmware is listed in the picker (by name, or by the MiBeacon product id in its `0xFE95` advertisement:
`isMiThermometerAdvert`, so a band or a scale advertising under `0xFE95` is not) with two buttons. Both work from JavaScript, so they
reach installed apps over the air; only the overnight bind-key scan needs a store build.

**Pakai bindkey (passive, preferred).** `sensors/miBeacon.ts` decrypts MiBeacon v4/v5 frames: service data `0xFE95`, frame control
(bit 3 encrypted, 4 MAC, 5 capability, 6 object), product id, frame counter, MAC (6 bytes as on the air), then the ciphertext, an extended
counter (3) and a 4 byte MIC. AES-128-CCM, 4 byte tag, additional data `0x11`, nonce = MAC + product id + frame counter + extended counter
(12 bytes), as ble_monitor (`ble_parser/xiaomi.py`, `decrypt_mibeacon_v4_v5`) implements it. The AES block is a 60 line own implementation
(no dependency; checked against FIPS-197). MiBeacon v2/v3 encrypted frames (12 byte key) are not supported. Objects read: `0x1004`
temperature (int16 LE, 0.1 C), `0x1006` humidity (u16 LE, 0.1 %), `0x100A` battery (u8 %), `0x100D` temperature and humidity
together; the e-ink XMWSDJ04MMC family sends `0x4C01` temperature and `0x4C08` humidity as float32 (`0x4C02`, `0x4C03` u8). The
LYWSD03MMC sends one object per advertisement, so `MiBeaconTracker` pairs a temperature and a humidity heard within 10 minutes into one
reading (`format: 'mibeacon'`); `ThermometerSampler` applies the same 5-minute throttle and counter dedupe as for the community formats.
Plaintext (unbound) MiBeacon frames decode without a key.

The bind key is 32 hex digits (`parseBindkey`, separators and case ignored). It is checked **before** it is kept: the MIC makes a wrong
key fail, so `checkBindkey` tries it on the last 8 distinct frames the picker heard from that unit and only a frame that opens counts
(`wrongKey`, `noFrames` when the unit has not advertised an object yet, `unsupported` for MiBeacon v2/v3 or a frame with no MAC on iOS,
where the scan id is no address). The key lives in the secure store (`joyofit.room.bindkey.<id>`, same place as the Tuya `local_key`),
never in SQLite, the log, a sync or a backup; the way each paired unit is read is one kv-store value (`joyofit.room.link.<id>`:
`bindkey` or `gatt`, absent = community firmware). Forgetting the thermometer deletes both. The in-app help (Details under the key field)
explains how to get the key (Xiaomi Cloud Tokens Extractor, or the Telink flasher's "Get Mi Bind Key") and warns that the flasher unpairs
the unit from Mi Home.

Overnight: the foreground service keeps `fe95` service data too (`RoomScanLogic.KEPT_SERVICES`, **native: needs a store build**). One
MiBeacon frame per five minutes would keep, say, only a battery frame, so `MiBeaconThrottle` keeps up to 6 distinct payloads per sensor per
5-minute window (repeats of one frame are dropped). JS decrypts them when the app opens (`drainRoomAdverts` through the same sampler).
`roomCaptureServices()` tells JS whether the installed build keeps `fe95` (`keepsMiBeacon`); on an older build a bind-key unit is heard
only while the app is open and the screen says so.

**Hubungkan langsung (no key).** `thermometer/gattRead.ts` connects through the scale transport (`scaleConnect`, `scaleSubscribe`, native
only moves bytes), subscribes to `ebe0ccc1-7a0a-4b0c-8a1a-6ff2997da3a6` of service `ebe0ccb0-...`, takes the first valid notification and
disconnects. The notification is 5 bytes: temperature int16 LE in 0.01 C, humidity u8 %, battery voltage u16 LE in mV (battery % is the
community formula `(mV - 2100) / 10`, clamped). Nothing is written to the sensor: the "connection interval" write some projects use is
not needed for one read. The sensor serves one connection at a time, so a unit held by Mi Home (or out of range) ends as `unreachable`
and the screen says to close Mi Home; a unit without the service as `noService`. `GattPoller` reads once now (when the newest sample is
older than 10 minutes), then every 10 minutes while the app is in the foreground, one read at a time, backing off 2, 4, 8 minutes after a
failure; a "Baca sekarang" button reads out of turn. It stops with the app in the background: **no overnight reading in this mode**
(the foreground service only scans). Pairing reads one sample first and pairs only when it worked.

The picker, the card and `env_sample` do not tell the modes apart: a stock unit shows readings, battery and the room history like a
flashed one.

### Storage and pairing

- Pairing reuses the `sensor` table with the new kind `thermometer` (`SensorKind` in `features/sensors/gatt.ts`). Thermometers
  never reach workouts or the Watch tab's sensor card: `SensorsProvider.saved` keeps only `isSportSensor` rows, and the hub
  never connects to one. One thermometer at a time (pairing another replaces it; the old readings stay, same room).
- The `sensor` table is **not** synced to JoyoFit's cloud (no sensor adapter in `src/cloud/syncInventory.ts`), so there was
  nothing to keep consistent there.
- `env_sample(sensor_id, ts, temp_c, rh_pct, battery_pct)` is created from JS next to the other JS tables
  (`ensureEnvSchema`, called from `buildAppSchema`), no native migration. A sensor gets one row per 5 minutes at most (the
  sampler throttles in memory, `insertEnvSample` refuses a second sample within 5 minutes in SQL, so the foreground scan, the overnight
  file and a drained batch never double up). Rows older than 120 days are deleted at launch and on every foreground. Forgetting the
  thermometer deletes its rows. Raw samples never leave the phone.

### Capture: three paths, one sampler

`ThermometerSampler` (`sampler.ts`) is the single gate: paired sensor, readable frame, new counter, one sample per sensor per 5
minutes.

1. **App open (iOS and Android, OTA-safe).** `useRoomCapture` (mounted as `RoomCaptureRunner` under the providers) scans for the
   paired id through the shared scale scan (`scaleHub`, low-power duty cycle) while the app is in the foreground and the Bluetooth
   permissions are already granted. It never prompts by itself.
2. **Overnight with the app closed (Android store build only).** `RoomScanService` in `modules/ble-sensors`: a foreground service
   (type `connectedDevice`, ongoing notification with a Stop button) holding one `SCAN_MODE_LOW_POWER` scan filtered by the sensors'
   addresses. The filter runs in the Bluetooth controller, so it works with the screen off, and results come in batches two
   minutes apart (`setReportDelay`), so the processor sleeps between them [INFERENCE: batching is hardware offloaded only on some
   chips; elsewhere Android emulates it and the CPU wakes per advertisement]. It keeps one advertisement per sensor per 5 minutes in
   a small file (`RoomAdvertLog`, 256 KB cap), with no JS and no wake lock, and ends at the requested time (an inexact alarm plus a
   check on every batch) or on Stop. The decoding stays in TypeScript: the file holds `id|ts|uuid|hex` lines and `drainRoomAdverts`
   decodes them when the app opens, stores them, and only then tells the native side to drop them, so a failed drain loses nothing.
   Sticky: if the system kills the process overnight it restarts the service, which resumes while the end time is ahead.
   - **Start**: by the person ("Pantau malam ini") or by itself (`autoArmEnd`): when the app is opened between 19:00 and the wake
     hour (default 08:00, choices 06/08/10) with the switch on, unless it already runs or the person stopped it for that night
     (`userStoppedAt`, set by the Stop button and `stopRoomCapture`). Android 12+ refuses a foreground service started from the
     background, which is why it starts while the app is visible and not from a boot receiver or a background task.
   - **Why this and not the alternatives.** A `PendingIntent` scan would need no notification, but Android downgrades long
     background scans to opportunistic [INFERENCE] and results then stop arriving overnight, with nothing to show the person. A
     GATT read of the sensor's flash log in the morning (the firmware keeps about 20,000 records) needs a connection stack for this
     sensor, a protocol of its own and is slower to ship; it stays the fallback if the foreground service proves unreliable on some
     phones.
3. **iOS overnight: not implemented.** The existing iOS module (`ScaleCentral.swift`) scans unfiltered and foreground-only, and iOS
   background scans must filter by advertised service UUIDs, while these sensors put their data in service data
   [INFERENCE: iOS does not match a scan filter against service-data UUIDs; unverified]. So on iPhone readings arrive only while
   JoyoFit is open, a night's aggregate needs JoyoFit left open (and the screen on) all night, and the screen says so. State
   restoration for a scan the system keeps for a closed app would be Swift work (`CBCentralManagerOptionRestoreIdentifierKey`) and
   needs a device to test; left for a spike.

**Store build required for the overnight scan.** It changes native code (`RoomScanService`, a `<service>` entry in the module
manifest, new module functions), so the runtimeVersion changes (`docs/ota.md`) and it only exists in a binary built after it. Everything
else here is JavaScript and reaches installed apps over the air. An old Android binary has no `startRoomCapture`: `roomCaptureNative()`
(`pickRoomCapture`) returns null, the Settings screen says the overnight scan needs a store update, and only the app-open scan runs. No new
permission is declared: the scan uses `BLUETOOTH_SCAN` (declared `neverForLocation`; address filters return no beacons), the service type
uses `FOREGROUND_SERVICE_CONNECTED_DEVICE` and the notification `POST_NOTIFICATIONS`, all already in the module manifest for sensors and the
workout recorder (the scan screen asks for the Bluetooth permissions, not for notifications: on Android 13+ without the notification
permission the service still runs, only its notification is hidden). The `<service>` entry sits in the module's `AndroidManifest.xml` beside
`RecordingService` (merged into the app), not in a config plugin: `plugins/` only holds app-level edits, and nothing in them needed to change. Play Console's foreground-service declaration for `connectedDevice` should also name the thermometer scan. There is no
`check-api` script in this repo; the native API contract is `modules/ble-sensors/src/BleSensorsModule.ts` plus
`BleSensors.types.ts`, kept in step with `BleSensorsModule.kt`.

### What leaves the phone

Per night, only when Wawasan tidur is on (the consent switch, section above) and only when the night has at least 6 readings that cover
at least half of the sleep window (`roomAggregateForNight`, `aggregate.ts`; a sample speaks for the time until the next one, at most 10
minutes):

```
env: { tempCMean, tempCMin, tempCMax, rhPctMean, rhPctMin, rhPctMax, samples, source: 'lywsd03mmc' }
```

Temperature and humidity are rounded to 0.1. `useSleepNightsPush` reads the samples of each night's own onset-to-wake window
(`roomEnvByWakeDate`, the sensor that heard most of a night when two were used, never a mix) and hands the map to
`buildRogoNights(..., env)`; a night whose room summary appears later (the app opened in the morning, the overnight file drained) is
pushed again as a changed snapshot. Without consent nothing is read from `env_sample` for the push. `pm25Mean` is never sent.

### Tests

`thermometerAdvert.test.ts` (decoders, rejection, dedupe), `thermometer/sampler.test.ts` (paired filter, 5-minute throttle, counter
dedupe), `store.test.ts` (spacing rule, 120-day prune), `aggregate.test.ts` (shape, 6 samples, 50 % coverage, window ends, two sensors,
`buildRogoNights` integration), `drain.test.ts` (file to samples, no clear on failure, old-binary guard), `nightWindow.test.ts`
(auto-start window), `discovery.test.ts` (picker, bind key check); Kotlin `RoomScanLogicTest` and `RoomAdvertLogTest` (pure logic: service data
choice, address filter, throttle, MiBeacon throttle, clock conversion, request round trip, the file log), run by CI's `:ble-sensors:testDebugUnitTest`.
Stock firmware: `sensors/miBeacon.test.ts` (FIPS-197 AES; ble_monitor's published LYWSD03MMC, CGG1, CGDK2, LYWSD02MMC and XMWSDJ04MMC
frames with their keys and values; plaintext LYWSD03MMC and LYWSDCGQ frames; objects; CCM against Node's own `aes-128-ccm`; wrong key,
damaged frame, tampered tag), `thermometer/sampler.test.ts` (pairing two one-object frames), `gattRead.test.ts` (notification layout,
a scripted native: connect, subscribe, timeouts, busy unit, no service), `gattPoller.test.ts` (schedule, backoff), `link.test.ts` (modes,
bind key in the secret store only), `drain.test.ts` (overnight MiBeacon frames).
Not exercised: the service on a device, a real LYWSD03MMC on either firmware, iOS. The GATT notification layout follows the MiTemperature2
and LYWSD03MMC community notes, not a capture [UNVERIFIED on a stock unit].
