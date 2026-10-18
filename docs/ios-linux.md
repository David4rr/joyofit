# iOS build on Linux

`scripts/build-ios-linux.sh` builds and signs JoyoFit's iOS app on this Linux box: no Xcode, no Mac. It is
JoyoRogo's pipeline (`joyorogo/scripts/build-ios-linux.sh`, `scripts/ios/**`) adapted to JoyoFit: the app is at
the repo root, the product is `JoyoFit`, bundle id `com.joyodigitama.joyofit`.

```bash
scripts/build-ios-linux.sh --dev      # development-signed JoyoFit-dev.ipa for the team's registered iPhones
scripts/build-ios-linux.sh            # App Store-signed JoyoFit.ipa, checked by asc.py validate
scripts/build-ios-linux.sh --upload   # ...and uploaded to App Store Connect (not exercised for JoyoFit yet)
FROM_STEP=6 scripts/build-ios-linux.sh --dev   # resume at step n (1-7)
NINJA_ARGS="-k 0" scripts/build-ios-linux.sh   # extra ninja arguments: -k 0 lists every compile error
```

Output goes to `$JOYOFIT_IOS_WORK` (default `/run/media/dzul/ioswork/joyofit-ios`, the ext4 loop image; `/home`
is nearly full): `out/JoyoFit-dev.ipa`, `out/JoyoFit.ipa`, `out/pod-install.log`, `out/build.ninja`. Built once
here: `project/` 0.7 GB, `out/` 1.2 GB, `cache/` 1.4 GB, nothing generated in the repo or in `$HOME`.
Pod tarballs for React Native 0.86.3 (Hermes, React core) are reused from `~/Library/Caches/ReactNative` when
present and downloaded there otherwise.

## What the steps do

1. `expo prebuild -p ios` in `$WORK/project`, a farm of symlinks to `assets`, `plugins`, `modules` and
   `node_modules` plus copies of `app.json`, `package.json`, `tsconfig.json`. The generated `ios/` has to live
   next to a real `node_modules` path (CocoaPods resolves `../node_modules` from the real directory, so a
   symlinked `ios/` does not work), and prebuild may rewrite the copies but never the repo's files.
2. `pod install` with the shims in `scripts/ios/shims/pod` (`xcodebuild` version, host `clang` emitting an ELF
   stub for ExpoModulesJSI's `prepare_command`, `xcrun` for the same script, `command`) and
   `EXPO_PRECOMPILED_FLAVOR=release`, so ExpoModulesCore, ExpoFileSystem, ExpoFont, ExpoImageManipulator and
   ExpoModulesWorklets come as precompiled xcframeworks.
3. The Expo macros plugin built for the Linux host with SwiftPM, cached in `$WORK/cache/macros-<version>`
   (about 10 min the first time).
4. `ExpoModulesJSI.xcframework` cross-built with SwiftPM and the `darwin` Swift SDK (`build-jsi.sh`, under a
   minute).
5. `gen-ninja.rb` turns `Pods.xcodeproj` and `JoyoFit.xcodeproj` into `out/build.ninja`.
6. `ninja`: every pod compiled with the Swift toolchain's clang/swiftc against the iPhoneOS SDK, then linked
   with `ld64.lld` (one swiftc per pod, one Swift module per pod). The first full run took about 24 min; a
   clean rerun of the whole script with warm caches (macros plugin, React Native tarballs) took 10 min 23 s.
7. `assemble-app.py`: Info.plist, asset catalog (Linux actool), `UILaunchScreen` instead of the splash
   storyboard, JS bundle + Hermes bytecode (`expo export:embed` from the repo root), frameworks. Then
   `enable-capabilities.py` turns on HealthKit and Sign in with Apple (`APPLE_ID_AUTH`, primary app consent) for the bundle id through the App Store Connect API, and
   either `provision-dev.py` + `sign-dev.sh` (`--dev`: iOS Development certificate, profile for every
   enabled device in the team) or `asc.py stamp` + `sign-app.py` + `asc.py validate` (App Store).

`huawei-wear`'s iOS side is picked up by autolinking (`modules/huawei-wear/expo-module.config.json` has an
`ios` entry, `ios/HuaweiWear.podspec` is one pod and one Swift module). Its frameworks and `sqlite3` reach the
link through the app's `OTHER_LDFLAGS` (CoreBluetooth, HealthKit, Security, libsqlite3 are in the linked
executable).

## Host prerequisites

Present on this machine; see the header of `scripts/build-ios-linux.sh` for the variables that override them.

- Swift 6.4 at `~/.local/swift-6.4/usr/bin` (`SWIFT_BIN`).
- omarchy-apple-dev at `~/.local/share/omarchy-apple-dev` (`OMARCHY_APPLE_DEV`) with its `darwin` Swift SDK
  (iPhoneOS 27.0, from Xcode 27's `.xip`) registered under `~/.config/swiftpm/swift-sdks`, and its Linux
  `actool` built.
- CocoaPods 1.17 gem (+ `xcodeproj`), `ninja`, `rcodesign` (`~/.cargo/bin`), `ld64.lld`, `llvm-ar`, `rsync`,
  Bun, Node, Ruby.
- A Python with `cryptography` (`ASC_PYTHON`, default JoyoRogo's `~/.local/share/joyorogo-ios/venv`).
- App Store Connect API key: `ASC_KEY_ID=BUU2CPKLGM`, `ASC_ISSUER_ID`, `ASC_KEY_PATH=~/Downloads/AuthKey_BUU2CPKLGM.p8`.
  The Apple Distribution certificate is team-wide, so `ASC_IDENTITY_DIR` defaults to JoyoRogo's
  `~/.config/joyorogo-ios/distribution`; the development certificate is omarchy-apple-dev's
  `~/.config/omarchy-apple-dev/development`, which also receives `com.joyodigitama.joyofit.mobileprovision`.

## Differences from JoyoRogo's pipeline

- `scripts/ios/shims/pod/xcrun`: expo-modules-jsi 57.1.2's stub script calls `xcrun --sdk macosx clang`.
- `gen-ninja.rb` emits Swift compiles in dependency order. Closure order is breadth-first from the app, so
  ExpoRouter (which `import RNScreens`) was emitted before RNScreens and compiled without waiting for
  RNScreens's module map (`module map file .../RNScreens/RNScreens.modulemap not found`).
- `enable-capabilities.py`: JoyoRogo's HealthKit capability was set up outside the scripts.
- `FROM_STEP`, `NINJA_ARGS`, and the work directory outside the repo.

## Facts worth knowing

- The `--dev` profile is signed with everything the profile grants. With HealthKit enabled on the App ID the
  profile carries `com.apple.developer.healthkit`, `healthkit.access: [health-records]` and
  `healthkit.background-delivery`; the App Store flow signs only the keys `app.json` requests
  (`healthkit`, `healthkit.access: []`).
- Bluetooth Classic does not exist on iOS: the iOS module is Bluetooth LE only.
- `ITSAppUsesNonExemptEncryption` is `false` (as in JoyoRogo): true only while the app's encryption stays
  inside Apple's OS crypto (CryptoKit, CommonCrypto, HTTPS), which is the owner's call to confirm.
- Building from a git worktree (so other sessions' uncommitted edits cannot leak in): symlink the main checkout's `node_modules`
  into the worktree, then run the script there. Metro's cache in `TMPDIR` from a build of a different checkout path used to
  give a JS bundle with no app screens (1027 modules instead of 1618, no error, a blank app that still passed `asc.py
  validate`); `assemble-app.py` now bundles with a cache directory of its own and refuses a bundle without app code.
- ninja runs a script phase once: it is a stamp file with no inputs. The EXConstants phase writes the `app.config` the app
  reads as `Constants.expoConfig` (the cloud URL in `extra`), so builds shipped the config of the first build for ever, and a
  changed `cloudUrl` never reached the phone. Step 6 now removes that stamp every run and `assemble-app.py` refuses an
  `app.config` whose `extra` differs from `app.json`.
- `expo-image-picker` and `expo-media-library` have plugin entries in `app.json` that set the photo library, photo-add and camera usage strings (the camera is used for
  "Take photo" on the workout share screen) and drops the microphone string; `expo-secure-store` still adds a default Face ID string
  that JoyoFit does not need.
- Nothing here installs or launches the app: a build that links and passes `asc.py validate` / `macho-lint`
  has not run on an iPhone.
