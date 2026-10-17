# iOS build on the MacBook

`scripts/build-ios-mac.sh` builds JoyoFit's App Store IPA with Xcode on the owner's MacBook Air (`ssh allicias-macbook-air`, over
Tailscale), driven from this Linux laptop. It is the Xcode counterpart of `scripts/build-ios-linux.sh` ([ios-linux.md](ios-linux.md)); both
make an equivalent signed IPA. JoyoRogo has the same pair of scripts (`joyorogo/scripts/build-ios-mac.sh`).

```bash
scripts/build-ios-mac.sh              # build, sign, check; IPA to dist/JoyoFit-<build>-mac.ipa
scripts/build-ios-mac.sh --upload     # ...then altool upload and wait until App Store Connect says VALID
scripts/build-ios-mac.sh --ref <rev>  # another commit that is on GitHub (default: this checkout's origin/HEAD)
scripts/build-ios-mac.sh --attach     # follow the Mac job of an earlier run (SSH dropped, Ctrl-C)
BUILD_NUMBER=202610171200 scripts/build-ios-mac.sh   # default is YYYYMMDDHHMM in UTC, as on Linux
```

Output: the build log streams to the terminal; the IPA lands in `dist/` (gitignored). Measured on 2026-10-17: JoyoFit 11 min 40 s
from a warm `node_modules` (bun 5 s, prebuild 1 s, pods 33 s, archive 10 min, export 20 s); JoyoRogo 14 min 49 s including the altool
upload (1.5 min). The Linux pipeline needs about 10-13 min warm (24 min the first time), so the Mac is not faster, it just builds with
the real toolchain.

## What it does

On Linux (`build-ios-mac.sh`):

1. Takes the commit of **local `origin/HEAD`** (never uncommitted or unpushed files; run `git fetch` first if you want the newest).
2. `enable-capabilities.py` makes sure HealthKit and Sign in with Apple are on the bundle id (same call as the Linux pipeline).
   With `--upload`, `asc-wait-valid.py --check` refuses a build number that is not higher than every build on App Store Connect.
3. Copies the App Store Connect API key (`~/Downloads/AuthKey_BUU2CPKLGM.p8`) to `~/.appstoreconnect/private_keys/` on the Mac,
   mode 600, only when it differs. It is never committed.
4. `asc-mac-profile.py` finds the Mac's Apple Distribution certificate on App Store Connect (by serial), reuses or creates the App
   Store profile `joyo-mac com.joyodigitama.joyofit <cert id>` and installs it on the Mac
   (`~/Library/Developer/Xcode/UserData/Provisioning Profiles/<uuid>.mobileprovision`).
5. On the Mac: `git clone`/`git fetch` of GitHub into `~/build/watch-fit`, `git checkout --detach <sha>`, `git clean -ffdx -e node_modules`;
   fails when the tree is not clean.
6. Streams `scripts/ios/mac-build.sh` (from this checkout, so it need not be pushed) to the Mac and starts it as a launchd agent in
   the Mac's logged-in GUI session; follows its log until it writes an exit code; copies the IPA back.
7. With `--upload`: waits (ASC API) for `VALID` and prints the build's TestFlight state and groups.

On the Mac (`scripts/ios/mac-build.sh`, also runnable by hand on any Mac with node, bun, CocoaPods and Xcode):

1. `bun install --frozen-lockfile`.
2. `expo prebuild --platform ios --clean --no-install` with `NODE_ENV=production` (JoyoFit's cloud URLs come from `expo.extra` in
   `app.json`; JoyoRogo's script also exports `EXPO_PUBLIC_SERVER_URL`, `EXPO_PUBLIC_DEV_LOGIN=0`, `EXPO_PUBLIC_FB_APP_ID`). Then
   `CFBundleVersion` is set to the build number in the generated Info.plist (prebuild writes `app.json`'s `buildNumber` there as a literal).
3. `pod install` (`EXPO_PRECOMPILED_FLAVOR=release`; Expo's precompiled modules are not found on the Mac, so the Expo pods compile
   from source and live in the executable instead of `Frameworks/*.framework`).
4. `xcodebuild archive -destination generic/platform=iOS -allowProvisioningUpdates -authenticationKey...` with
   `DEVELOPMENT_TEAM=F6Q6UFUK69`. Xcode creates/reuses the automatic development profile through the API key.
5. `xcodebuild -exportArchive` with `ExportOptions.plist` (`app-store-connect`, manual signing with the profile the driver installed,
   `manageAppVersionAndBuildNumber` false, no symbol upload).
6. Checks the IPA and stops on any failure: bundle id, `CFBundleVersion == BUILD_NUMBER`, `DTSDKName` is the iOS 26 SDK or later,
   the profile has no device list, `get-task-allow` false, code signature verifies and the identity is Apple Distribution, the embedded
   `EXConstants.bundle/app.config` `extra` equals `expo config` (freshness guard), `main.jsbundle` contains app code (marker
   `HuaweiWear`; Metro cache guard). The build gets its own `TMPDIR` and old Metro caches are removed first.
7. With `--upload`: `xcrun altool --upload-app --apiKey --apiIssuer`.

Files on the Mac: `~/build/watch-fit` (checkout), `~/build/watch-fit/build/ios-mac/` (archive, export, logs: `xcodebuild-archive.log`,
`xcodebuild-export.log`, `pod-install.log`, `profile.plist`, `entitlements.plist`), `~/build/jobs/watch-fit/` (job script, `log`, `rc`),
`~/build/tools/` (node, CocoaPods wrapper). Xcode's DerivedData is under `~/Library/Developer/Xcode/DerivedData`.

## Why the build runs in the GUI session

Over plain SSH `codesign` fails with `errSecInternalComponent`: the login keychain's private keys are not usable from a session
outside the logged-in user's GUI. `launchctl bootstrap gui/501` of a throwaway agent (`local.joyodigitama.build.watch-fit`, plist in
`~/build/jobs/watch-fit/`, booted out when the build ends) runs the job inside that session, where the Apple Distribution key
signs without a prompt. So the owner must be logged in at the Mac (the user was on `console`, see `who`), awake and
plugged in; the job runs under `caffeinate -i`. No password is ever typed or stored.

## Signing, and why the export is manual

Automatic export (`signingStyle automatic`) failed with `Cloud signing permission error` / `No profiles for ... were found`: Xcode wants
a cloud-managed distribution certificate and the API key BUU2CPKLGM may not create one. So the archive is signed automatically
(Apple Development identity, `iOS Team Provisioning Profile: com.joyodigitama.joyofit`, which `-allowProvisioningUpdates` makes with
the key) and the export re-signs manually with the keychain's `Apple Distribution: Dzulfikar Ats Tsauri (F6Q6UFUK69)` (serial
260D7457..., portal id A4GCA23UU4) and a profile made through the API. `mac-build.sh` exports automatically when `EXPORT_PROFILE` is
unset, which works wherever the key has cloud-signing rights (for example an Admin-role key; [INFERENCE], not tried).
The team has three Apple Distribution certificates already (the Linux pipeline's `3QRYPCWH...`, the Mac's, one more), the maximum Apple
allows, so a fourth cannot be created; the Mac's profile is separate from the Linux one.

## Xcode and the App Store requirement

The Mac has Xcode 26.6 (17F113), iOS SDK 26.5. Apple's "SDK minimum requirements" (developer.apple.com/news/upcoming-requirements,
since 2026-04-28): uploads must be built with Xcode 26 or later using the iOS 26 SDK. Xcode 26.6 qualifies; the TestFlight upload of
JoyoRogo build 202610171411 built this way processed to VALID. The Linux IPAs carry `DTXcode 2700` / `iphoneos27.0` (a `.xip`-built
SDK stamped by `asc.py`), the Mac ones the real `DTXcode 2660`, `DTXcodeBuild 17F113`, `iphoneos26.5`. An Xcode update from the App
Store needs the owner's Apple ID login: not done, not needed now.

Xcode 26 needs the **iOS 26.5 platform component** (8.5 GB, "iOS 26.5 Simulator") even for a device archive, or `xcodebuild` reports
`iOS 26.5 is not installed` and finds no destination. It was installed with `xcodebuild -downloadPlatform iOS` (no password asked). After
an Xcode update run the same command again.

## One-time Mac setup (done 2026-10-17)

User-level only, under `~` and `~/build`; nothing needed `sudo`.

```bash
# node 26.11.1 (the Linux version) and bun 1.4.3 from their release archives
mkdir -p ~/build/tools ~/build/dist && cd ~/build/tools
curl -fsSL https://nodejs.org/dist/v26.11.1/node-v26.11.1-darwin-arm64.tar.gz | tar xz && mv node-v26.11.1-darwin-arm64 node
mkdir -p ~/.bun/bin && curl -fsSL -o /tmp/bun.zip https://github.com/oven-sh/bun/releases/download/bun-v1.4.3/bun-darwin-aarch64.zip \
  && unzip -qo /tmp/bun.zip -d /tmp && cp /tmp/bun-darwin-aarch64/bun ~/.bun/bin/bun && ln -sf bun ~/.bun/bin/bunx

# CocoaPods 1.17.0 on the system Ruby 2.6 (the latest gems do not install there, Bundler picks compatible ones)
gem install --user-install --no-document bundler -v 2.4.22
mkdir -p ~/build/tools/pods && cd ~/build/tools/pods
printf 'source "https://rubygems.org"\ngem "cocoapods", "~> 1.16"\n' > Gemfile
~/.gem/ruby/2.6.0/bin/bundle _2.4.22_ config set --local path vendor && ~/.gem/ruby/2.6.0/bin/bundle _2.4.22_ install
mkdir -p ~/build/tools/bin && cat > ~/build/tools/bin/pod <<'EOF'
#!/bin/bash
export BUNDLE_GEMFILE=$HOME/build/tools/pods/Gemfile
exec "$HOME/.gem/ruby/2.6.0/bin/bundle" _2.4.22_ exec pod "$@"
EOF
chmod +x ~/build/tools/bin/pod

# iOS platform component for Xcode 26
xcodebuild -downloadPlatform iOS
```

`/usr/bin/java` is the stub and is not needed for iOS. The job's `PATH` is `~/build/tools/bin`, `~/build/tools/node/bin`, `~/.bun/bin`,
then the system dirs; nothing is added to a shell profile. System settings, accounts and the owner's files are untouched.

## IPA comparison with the Linux build (JoyoFit, 2026-10-17)

Mac build 202610171352 (commit 31448bf) against Linux build 202610171345 (e3cef81, `NativeBuilds2`), both checked with `asc.py validate`
(Mac IPA: 43/43 checks passed):

| | Linux | Mac |
| --- | --- | --- |
| Info.plist | same keys and values (usage strings, `UIBackgroundModes bluetooth-central`, document types, `ITSAppUsesNonExemptEncryption false`, `MinimumOSVersion 16.4`) | same, plus `BuildMachineOSBuild`, `UILaunchStoryboardName` (Xcode keeps the splash storyboard; Linux writes `UILaunchScreen`), no `RCTNewArchEnabled`; `CFBundleIconName` missing from `CFBundleIcons~ipad` (iPhone-only app) |
| SDK stamp | `iphoneos27.0`, DTXcode 2700, 27A266a | `iphoneos26.5`, DTXcode 2660, 17F113 |
| Entitlements | application-identifier, team id, `beta-reports-active`, `get-task-allow false`, HealthKit (`access: []`), Sign in with Apple, `keychain-access-groups` (`F6Q6UFUK69.*`, `com.apple.token`) | the same minus `keychain-access-groups` (Xcode signs only what the app's entitlements ask for; the default keychain group is the application identifier) |
| Embedded profile | App Store, cert 3QRYPCWH, no device list, expires 2027-10-15 | App Store, cert A4GCA23UU4, no device list, expires 2027-09-12 |
| `EXConstants.bundle/app.config` | `extra` from `app.json` | identical |
| `main.jsbundle` (Hermes) | 4,564,134 bytes | 4,592,983 bytes (newer commit) |
| Executable / frameworks | 24.7 MB executable plus `ExpoModulesCore`, `ExpoFileSystem`, `ExpoFont`, `ExpoImageManipulator`, `ExpoMediaLibrary`, `ExpoModulesWorklets`, `SDWebImage*` frameworks | 15.8 MB executable, those pods are linked in (no precompiled modules on the Mac) |
| IPA size | 18.5 MB | 15.8 MB |

JoyoRogo (Mac 202610171411 against Linux 202610171241): the same differences; entitlements add `aps-environment production` on both.

## When something fails

- `cannot reach allicias-macbook-air`: Tailscale up? The Mac awake? Plugged in?
- `errSecInternalComponent` in the log: the job did not run in the GUI session (nobody logged in at the console, or run by hand over SSH).
- `iOS x.y is not installed`: `xcodebuild -downloadPlatform iOS` on the Mac.
- `Cloud signing permission error`: `EXPORT_PROFILE` is not set (running `mac-build.sh` by hand); the driver sets it.
- `profile ... does not grant`/`No profile`: the profile was made before a capability was enabled; delete `joyo-mac ...` in App Store Connect
  (`asc-mac-profile.py` also recreates an INVALID one) and run again.
- The log is at `ssh allicias-macbook-air tail -f build/jobs/watch-fit/log`; full xcodebuild logs are in `build/ios-mac/` next to the checkout.
- Do not run two builds of the same repo at once (one checkout, one job label).

## Gradle cache on the SSD (this Linux box)

`~/.gradle` is a symlink to `/run/media/dzul/ioswork/gradle-home` (ext4 image, 9 GB moved on 2026-10-17, `/home` was 84 % full).
The image is mounted by udisks from `/run/media/dzul/Data/dzul-offload/ios-work.ext4` and may not be mounted after a boot;
`scripts/build-release.sh` stops with the mount command when `~/.gradle` dangles (`udisksctl loop-setup -f
/run/media/dzul/Data/dzul-offload/ios-work.ext4`, [INFERENCE]: the command was not needed again after the move).
