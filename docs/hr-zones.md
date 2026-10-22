# Heart-rate zones (Settings > Zona HR)

JoyoFit lets the person choose how heart-rate zones are calculated, edit the five zone limits in bpm, and sends the result to the watch. Every
figure of the app that depends on zones reads the same settings, so the analysis, the strain and the watch's workout screen agree.

The screen is `src/features/hrzones/ui/HrZonesSettings.tsx` (route `/settings/hr-zones`, row "Zona HR" under "Target & tubuh"). The math is
`src/features/hrzones/zones.ts` (pure, tested in `zones.test.ts`), the stored setting and the watch hand-over `settings.ts`, the data suggestion
`suggest.ts`.

## What Huawei Health offers (the model JoyoFit copies)

Evidence: Huawei Health 17.0.8.300, decompiled (`com.huawei.ui.main.stories.settings.activity.heartrate.HeartRateZoneSettingActivity`,
`.fragment.BaseHeartRateZoneFragment`, `.HeartRateSectionActivity`, `com.huawei.hwcommonmodel.fitnessdatatype.HeartRateThresholdConfig`, string
resources `IDS_rate_zone_*`, `IDS_hrr_heart_rate_description`). Notes: `~/re/huawei-health`.

| Huawei Health | What it is |
| --- | --- |
| Four tabs: standing, riding, swimming strokes, other | One zone set per posture (`mPostureType` 1 to 4). The maximum is lowered by 0, 6, 10 and 5 bpm for posture 1 to 4 (`getPostureCalibrationValue`). |
| Calculation method (`mClassifyMethod`) | `0` maximum heart rate percentage, `1` heart rate reserve (HRR) percentage. `HeartRateThresholdConfig` also works out a lactate-threshold set (LTHR: 85 % of the reserve, then 67, 80, 89, 97, 102 % of that; GB `HUAWEI_CALCULATE_METHOD_LTHR` = 3) for the standing posture only. |
| Maximum heart rate | Picker from 100 to 220 (`HEART_RATE_LIMIT`). Default `220 - age` (`HeartRateThresholdConfig` constructor), the age from the Huawei profile. |
| Resting heart rate | 30 to `min(110, max - 15)`; default 60 (`DEFAULT_REST_HEART_RATE`). |
| Zone limits | Five sliders. Default max-HR method: 50, 60, 70, 80, 90 % of the maximum (`mFitnessThreshold`, `mWarmUpThreshold`, `mFatBurnThreshold`, `mAerobicThreshold`, `mAnaerobicThreshold`, each `Math.round`); HRR method: 59, 74, 84, 88, 95 % of `max - rest` plus rest. The lowest limit stops at 30 %. |
| Heart-rate limit alert | A switch (`mIsWarningEnable`, off by default in Huawei Health) and a limit from 100 to 220 (default `220 - age`). |
| Zone names | Max-HR method: warm-up, fat burning, aerobic, anaerobic and a top zone (`IDS_rate_zone_warmup_threshold`, `..._fatburn_threshold_string`, `..._aerobic_threshold`, `..._anaerobic_threshold`, `..._maximum_threshold`); JoyoFit's live screen already used these five words. HRR method: aerobic base, aerobic advance, lactic acid, anaerobic base, anaerobic advance (`IDS_rate_zone_hrr_*`). |

## What JoyoFit does

| | |
| --- | --- |
| Methods | `max` (default) and `hrr`. LTHR is not offered: there is no input for it in the app. |
| Maximum heart rate | Default `220 - age` from the profile's birth year (35 years without one), as before. One tap on "Tanaka" fills `208 - 0.7 x age`. Editable from 100 to 219 (the watch protocol, like Gadgetbridge, takes values below 220). |
| Resting heart rate | Default 60 (Huawei Health's), 30 to `min(110, max - 15)`; only the HRR method uses it. |
| Zone limits | Five steppers (or typed numbers), each kept at least 1 bpm above the zone before it, at least 30, and below the maximum. Changing the method, the maximum or the resting rate derives the limits again, so hand-edited limits never outlive the numbers they were set against. "Kembalikan" returns to the method's limits. |
| Limit alert | Switch and limit, shown only when a watch is in use. On by default with the limit at the maximum, which is what JoyoFit sent before this screen existed (Gadgetbridge's defaults). |
| "Hitung dari data" | A suggestion, never applied by itself. Maximum: the highest workout maximum, only when it is above the age formula (a lower one proves nothing: the person may never have gone all out), and a value more than 10 bpm above the next highest is taken for a sensor spike. Resting: the median of the watch's resting heart rate of the last 14 days. |
| Save | "Simpan" applies the draft: stored, told to the account, handed to the watch. "Atur ulang" puts the draft back to the defaults (still needs "Simpan"). |

A limit is the lowest whole bpm at or above the exact value (`ceil`). That is the rule every figure used before the setting existed, so people who
change nothing see no number move; Huawei Health rounds to the nearest bpm instead, so its own defaults can be one bpm lower. The watch gets
JoyoFit's limits as they are, so app and watch agree.

### Where the zones are used

`userHrZones()` / `useHrZones()` (`settings.ts`) return the zones in force; there is no other source of a maximum heart rate.

- Workout analysis (zone time, strain, effort, load, fat and carbohydrate split by zone) and its upload; `analyzeWorkout` takes `zones`.
- Daily strain, Today, Readiness, Trends, Kebugaran (fitness load, energy), the heart-rate day screen (SQL day load takes `zones.limits`), the sleep need.
- Coach: the bpm range of a planned run's zone and the post-workout feedback.
- Live workout screens (zone label and colour), the strength logger's strap chip, the recorder's live view, the bike computer's zone field.
- Cycling: the heart-rate load of a ride without power (`ride_metrics` is emptied on save, so it is worked out again).

Not recalculated: workouts already uploaded to JoyoRogo keep the zones they were uploaded with; the workout screen on the phone always works out the
analysis again.

### Account

Preference `hrzones` (`registerSyncedPref` in `src/cloud/syncInventory.ts`): the settings object `{method, maxHr, restingHr, limits, warningEnabled,
warningLimit}`; all defaults is "absent" and is never uploaded. A value pulled from another phone is stored and handed to the watch.

## The watch

Native module `huawei-wear`: `setHeartRateZones(config | null)` and `getHeartRateZonesStatus()` (`HuaweiWear.types.ts`). JS sends the zones **as
computed** (`watchConfig()`): method, maximum, resting, the five lowest bpm, alert switch and limit. Needs a store build; an older binary lacks the
function (`hasNative('setHeartRateZones')`) and the app keeps working, the zones then only feed the phone's figures.

Sent: on "Simpan" with a watch connected, at every connect (the stored configuration), after a profile save (the age may have changed), and once at
launch when zones are set. Never changed by the native side on its own.

Protocol (Gadgetbridge `HuaweiHeartRateZonesSpec`, `FitnessData.HeartRateZoneConfigPacket`, `HuaweiP2PTrackService.getHRZonesData`; details in
`protocol/README.md`, "Heart-rate zones"): which way a watch takes zones is decided by what it declares:

| Route | Gate | What goes out |
| --- | --- | --- |
| P2P `hw.unitedevice.track` (type-2 sub-message, TLV tags 0x02 to 0x44) | ExpandCapability `0x36` | All four postures carry the same values (no posture correction), the method byte `0` or `1`, both sets (the one not chosen gets the defaults), LTHR defaults for upright. |
| FitnessData `07/21` | SupportedCommands lists `07/21` | Warning switch and limit, the MHR array, the HRR array and the method. |
| FitnessData `07/13` | SupportedCommands lists `07/13` | Warning switch and limit and one array: JoyoFit puts the **effective** five limits and the maximum there whatever the method, since this packet has no method. |
| none | none of the above | Nothing is sent; the screen says the watch does not take zones. |

With no stored configuration everything stays as it was: Gadgetbridge's defaults for the profile age, posture corrections included.

**Watch support.** There is no device list: each watch declares the route itself, and the connect log prints it (`HR zones: ExpandCapability 0x36
(Track)=..., FitnessData 07/13=..., 07/21=...`). The Gadgetbridge code JoyoFit ports is the evidence that Huawei watches with these capabilities
take the packet. **Not confirmed on any specific watch from JoyoFit's own captures**: the default zones were already sent before this screen, but
the notes hold no log of a watch showing a user-edited zone. Treat the Watch Fit 4 Pro as expected, other models as unknown until a log with
the capability line and a look at the workout screen says otherwise.

## Limits

- One zone set for every sport (the watch's four postures all get it). Huawei Health's per-posture sets and LTHR are not offered.
- The suggestion cannot find a true maximum: it only sees what the workouts reached.
- Cached cloud analyses (see above) and the Huawei Health app's own zones are not touched; the watch shows whichever was sent last.

## Tests

`bun test src/features/hrzones` (limits for both methods, monotonic and clamped for every allowed maximum and resting rate, the default limits against
the old percentage rule for every maximum, SQL day load against the JS day strain with custom limits, suggestions); Kotlin
`HeartRateZonesCalcTest` (`bun run test:native`); Swift `HealthSensorsTests` and `WearRuntimeTests` (`bun run test:ios-protocol`).
