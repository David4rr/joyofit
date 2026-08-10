# WatchFit RE

A lightweight, local-first Android companion for the **Huawei Watch Fit 4 Pro**.

Fast. Small. Local. Focused. Open.

This is MVP **v0.1**: a BLE/GATT explorer + packet logger optimised for the watch, with the
scaffold for the health/sync layers that come later. No cloud, no account, no telemetry.

> **Philosophy (PRD §29):** do not implement what we have not observed. The proprietary
> protocol is reverse-engineered experimentally and documented under [`protocol/`](protocol/).

---

## Status

| Layer           | State                         |
|-----------------|-------------------------------|
| BLE scanner     | ✅ working (Phase 1)          |
| GATT discovery  | ✅ working (Phase 1)          |
| Read / Write / Notify | ✅ working              |
| Packet log + export (JSON/CSV/TXT) | ✅ working   |
| Device info (battery/firmware) | ⏳ Phase 2 — read standard GATT chars |
| Health metrics  | ⏳ Phase 3 — pending protocol RE |
| Room persistence | ⏳ Phase 3                   |
| Background sync | ⏳ later                       |

---

## Tech stack

- Kotlin, Jetpack Compose, Material 3
- Hilt (DI), Coroutines + Flow, DataStore (preferences)
- Native Android BLE APIs only — no third-party BLE libraries
- minSdk 29 / targetSdk 36 / compileSdk 36

---

## Build

### Prerequisites

- Android Studio (Hedgehog or newer recommended)
- JDK 17+ (bundled with Android Studio)
- Android SDK platform 36 + build-tools

### First-time setup (important)

The Gradle wrapper jar (`gradle/wrapper/gradle-wrapper.jar`) is **not** committed. Generate it
on first import:

1. Open this folder in Android Studio.
2. When prompted for the Gradle distribution, choose **Use Gradle from: gradle-wrapper.jar**
   (recommended). Studio will populate the wrapper jar on the first sync.
3. After sync, the `./gradlew` scripts work from the terminal.

Alternative (no Studio): if you have a local Gradle 8.13+, run `gradle wrapper` once to
generate the jar, then use `./gradlew`.

### Build commands

```bash
./gradlew :app:assembleDebug     # build debug APK
./gradlew :app:lintDebug         # lint
./gradlew :app:installDebug      # install on connected device
```

Debug APK: `app/build/outputs/apk/debug/app-debug.apk`.

---

## Using the app

1. **Grant permissions.** On first BLE scan the app requests Bluetooth permissions
   (Android 12+: `BLUETOOTH_SCAN` + `BLUETOOTH_CONNECT`; Android 10/11: `ACCESS_FINE_LOCATION`).
2. **Enable developer mode.** Settings → About → tap the version **7 times**.
3. **Scan.** Debug tools → BLE Scanner → Scan → pick the watch.
4. **Explore GATT.** The GATT Explorer lists services and characteristics with decoded
   property flags. Read, write (hex), and subscribe per characteristic.
5. **Capture.** Every TX/RX is logged. Packet Log → filter by direction/characteristic →
   **Export** as JSON/CSV/TXT (saved under app-specific storage; share via the share sheet).

---

## Privacy

- Watch → Phone → **local database only**. No server, no account.
- Health data is never uploaded.
- Packet logs are stored in app-specific external storage and leave the device only when you
  explicitly share/export them.
- Backups of captured data are disabled (see `backup_rules.xml`).

---

## Project layout

```
app/src/main/java/com/watchfitre/
├── ble/          # scanner, connection, GATT, IO, models
├── protocol/     # packet model + stubs (no guessing)
├── log/          # packet logger + JSON/CSV/TXT exporter
├── settings/     # DataStore preferences
├── device/       # device facade (Phase 2)
├── sync/         # sync orchestrator (Phase 3)
├── health/ workout/ sleep/ database/   # deferred
├── di/           # Hilt module
└── ui/           # Compose: theme, components, screens, navigation
protocol/         # living protocol spec (services, chars, commands, …)
```

---

## Roadmap

See the PRD for the full plan. Next milestones:

- **v0.2** — device info + battery via standard GATT; decode one proprietary command.
- **v0.3** — first synced health metric persisted to Room.
- **v1.0** — reliable sync of HR/steps/calories/sleep/workouts, clean production UI.

---

## License

TBD. Proprietary until a license is chosen.
