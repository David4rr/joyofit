# Sleep insights (design)

Written 2026-10-20. Design only, no code. A card list in JoyoFit that explains your own sleep by lining the watch's night up with what JoyoRogo knows about your day (caffeine, alcohol, dinner) and what the watch saw (workouts, bedtime regularity), and later the temperature and humidity of the bedroom. Everything is JS (ships over the air, `docs/ota.md`) except the optional overnight room sensor (section 8). Not medical advice, ever.

## 1. What exists today (read from the code)

| Need | Where | Fact that shapes the design |
| --- | --- | --- |
| Night, stages, wake | `src/features/sleep/nights.ts` (`buildNights`), tables `sleep_segments`, `sleep_scores` | `Night` has start/end, per-stage seconds, awakenings, `nap` (under 3 h asleep), the watch score. Watches without stages (Watch Fit 2) give stage-less ranges that `cleanSleep.ts` only approximates (`nightHasStages`). |
| HRV, resting HR, SpO2 | `hrv_readings` (source `night`, RMSSD), `step_samples` (per minute: heart rate, SpO2, resting HR), `health_metrics` (skin temperature etc.) | Night HRV is Android-only and needs Automatic stress (`nightHrv.ts`). `hrvStatus.ts` already needs 14 baseline nights: the precedent for "14". |
| Workouts | `workouts` (start, end, avg/max HR), `userMaxHr`, zones in `docs/coach.md` (zone 2 = 60 to 70 % max) | Intensity can be a share of max HR; no new data. |
| Sleep need / debt | `readiness.ts`, `fitness/sleepNeed.ts` (7 h 30 base) | Insights must not contradict these numbers. |
| Rogo reads JoyoFit sleep | joyorogo `0ffb35a`: `pickNightSleep`, `fitness_score.sleep_hours` | Rogo only ever receives **hours per day** (night plus naps), plus `restingHr` / `hrvMs` for today. No bedtime, wake time or stages. A server-side insight would be blind. |
| JoyoFit -> Rogo API | `src/cloud/rogo.ts`: `pushScores` (`fitness/upsertScores`), `foodDay` (`food/listByDate`, **one day per call**), `addFood` | Food is already pulled to the phone (`MealsProvider`), for today only. |
| Food schema | joyorogo `food_log`: `date`, `meal` (sarapan, makan_siang, makan_malam, snack), `name`, `kcal`, protein/carbs/fat/fiber, `grams?`, `createdAt` | **No caffeine, alcohol or eaten-at field.** TKPI 2019 data (`lib/tkpi2019-data.ts`) has energy, protein, fat, carbs, fiber only. `createdAt` is the time it was **logged**; `food.add` takes no time; watch meals are written to Rogo at sync time (`MealsProvider`); JoyoFit's own `eatTimeMs` falls back to noon for back-filled days. |
| Caffeine / alcohol detection | joyorogo `lib/maternal.ts` | Feasible by **name only**: `caffeineMgFor` (7 regex rules, fixed mg per serving: coffee 80, espresso 95, tea 40, energy drink 80, cola 35, matcha 70, "rough on purpose") and the `alcohol` flag regex (bir, wine, arak, tuak, ... also `tape|tapai`, a food, a false positive). Only wired to Hamil / Menyusui (`foodFlagsFor` returns nothing for mode `none`). No drink counts or volume. |
| Scale | `docs/scale.md` | The scale model is not established; broadcast scales advertise weight only while awake. Treat it as **not** a room sensor; the existing "Rekam data timbangan" recorder will show its raw advertisements when it arrives. |
| BLE | `modules/ble-sensors` | The unfiltered advertisement scan already hands JS `serviceData` (hex per UUID); decoders are TypeScript (scale pattern). Android has a foreground service (`RecordingService`) for workouts; iOS has `bluetooth-central`. |

## 2. Evidence base (and how much it is allowed to say)

Each factor has a **prior** that caps the wording of its personal insight.

| Factor | What the literature supports | Prior |
| --- | --- | --- |
| Caffeine | Mean plasma half-life about 5 h, range 1.5 to 9.5 h ([IOM, NBK223808](https://www.ncbi.nlm.nih.gov/books/NBK223808/)). 400 mg taken 6 h before bed cut objectively measured sleep by about 1.1 to 1.2 h, and the person did not notice it in the diary; n = 12 ([Drake 2013](https://pubmed.ncbi.nlm.nih.gov/24235903/)). | High |
| Alcohol | Less sleep latency and more consolidated first half, but more disruption in the second half, delayed first REM and lower REM share at moderate/high doses ([Ebrahim 2013](https://pubmed.ncbi.nlm.nih.gov/23347102/)). In 4,098 people with wearables, same-day alcohol lowered HRV-derived recovery in the first 3 h of sleep by 9, 24, 39 points (low, moderate, high) ([Pietilä 2018](https://mental.jmir.org/2018/1/e23)). | High |
| Late / heavy dinner | Mixed. Observational: food near sleep goes with worse sleep ([Crispim 2011](https://pubmed.ncbi.nlm.nih.gov/22171206), n = 52). Crossover lab study: dinner 1 h vs 5 h before bed changed no conventional stage ([Duan 2021](https://pmc.ncbi.nlm.nih.gov/articles/PMC8131073/), n = 20). | Low |
| Evening exercise | Meta-analysis of 23 studies: no harm overall; onset latency, total sleep and efficiency may suffer after **vigorous** exercise ending 1 h or less before bed; moderators were fragile ([Stutz 2019](https://pubmed.ncbi.nlm.nih.gov/30374942/)). | Low |
| Regularity, social jetlag | Day-to-day consistency of sleep timing was a stronger predictor of mortality than sleep duration in 60,977 people (observational; the app never talks about mortality) ([Windred 2024](https://pubmed.ncbi.nlm.nih.gov/37738616/)); free-day vs work-day shift of mid-sleep is "social jetlag" ([Wittmann 2006](https://pubmed.ncbi.nlm.nih.gov/16687322/)). | Medium |
| Room temperature, humidity | Heat raises wakefulness and lowers slow-wave and REM sleep; humid heat adds thermal load; bedding and clothing change the effect, so no single threshold ([Okamoto-Mizuno 2012](https://pubmed.ncbi.nlm.nih.gov/22738673)). | High, but personal bands |

## 3. What the person sees (examples, Indonesian, "kamu")

Two kinds, always labelled.

**Umum** (a tip from literature, from the first night; names the data it used):
- "Kopi terakhirmu kemarin dicatat jam 16.40, sekitar 6 jam sebelum kamu biasanya tidur. Kafein rata-rata butuh sekitar 5 jam untuk berkurang separuh, tapi tiap orang beda (1,5 sampai 9,5 jam)."
- "Tidurmu bergeser lebih dari 1 jam antar hari minggu ini. Jam tidur yang konsisten biasanya lebih membantu daripada mengejar durasi."

**Milikmu** (a pattern in your own nights; only past the gate in section 4):
- "Di 9 malam setelah kamu minum kopi dalam 8 jam sebelum tidur, kamu tidur rata-rata 34 menit lebih pendek dibanding 17 malam tanpa kopi itu. Kemungkinan ada hubungannya, tapi 26 malam belum cukup untuk yakin."
- "Di 6 malam dengan minuman beralkohol di catatanmu, HRV tidurmu rata-rata 11 ms lebih rendah dan kamu lebih sering terbangun. Ini sejalan dengan riset umum tentang alkohol dan tidur."
- "Makan malam kurang dari 3 jam sebelum tidur muncul di 8 malam; detak istirahat malammu tidak berbeda jelas (selisih 1 bpm). Belum terlihat pengaruhnya di datamu."
- "Di malam dengan kamar di atas 29 C (pita terpanasmu, 10 malam), tidur nyenyakmu rata-rata 14 menit lebih sedikit." (later)
- "Latihan berat yang selesai kurang dari 1 jam sebelum tidur: 5 malam, belum cukup data." (shown as progress, not as a finding)

Each card: one sentence, "n malam vs n malam", a "Keyakinan" word, a "Lihat malamnya" detail (dots per night, newest first), "Sumber", and a dismiss. The shared disclaimer line (as `coach:disclaimer`): kebiasaan umum, bukan saran medis.

## 4. When an insight may appear (anti-noise rules)

All numbers are constants in one file with unit tests, like Coach.

1. **Descriptive and Umum cards**: at least 3 recent nights (typical bedtime = median onset), and for food tips at least one item logged in the window. Regularity: 5 of the last 7 nights. Social jetlag: 4 work-day and 2 free-day nights in 28 days (free days = Sat/Sun until the person says otherwise).
2. **Milikmu (correlation)**, all of:
   - at least **14 main nights** (no naps) in the last 42 days, 14 being the HRV-status precedent;
   - per factor at least **5 exposed and 5 unexposed** nights; a factor that never varies shows progress ("butuh 4 malam dengan kopi malam untuk membandingkan"), not a finding;
   - **unexposed means logged**: a night counts only if its evening has a complete food log (at least 2 meals, or 800 kcal). A missing log is not "no coffee". Incomplete nights are dropped, not counted as controls;
   - effect size at least **0.5 of the person's own night-to-night SD** of that outcome, and an interval (permutation, resampled on the phone) that excludes 0: 90 % for "mungkin" (14 to 27 nights), 95 % plus the same sign in both halves of the window for "cenderung" (28 nights or more);
   - **fixed pairings** to limit false positives: each factor has one primary outcome (caffeine: total sleep; alcohol: night HRV; dinner and exercise: awake minutes; regularity: total sleep; temperature: deep sleep or awake minutes), at most about 8 tests, Benjamini-Hochberg across them. No hunting through every pair.
3. **Wording**: describe, do not explain ("di malam ... rata-rata ... dibanding ..."). Never "menyebabkan", never a diagnosis, never a SpO2 or apnea reading, no doses or supplements. Low-prior factors never rise above "mungkin". Stage outcomes (deep, REM) only when `nightHasStages`; stage-less watches get duration, awake time, HRV and heart rate only. A finding that stops passing disappears (appears at the strict gate, leaves at a looser one to avoid flicker). At most 3 cards on screen, one new personal finding per day. The "see a professional" rule from Coach applies: Apple 1.4.1 (no diagnosis claims) already bounds JoyoFit (`docs/family-monitoring.md`).

Exposure definitions (initial, tunable): **caffeine** = estimated mg at bedtime from logged items, sum of mg x 0.5^(hours before bed / 5), exposed at 25 mg or more (about one coffee 8 h before); **alcohol** = any alcohol item logged in the 8 h before onset; **dinner** = gap from the last makan_malam item to onset under 3 h (a project heuristic, not from a study) and its kcal as a tertile of the person's own dinners (no calorie-goal talk); **evening workout** = a 20 min or longer workout ending within 3 h of onset, vigorous when average HR is 80 % of max or more; windows use timestamps, so after-midnight logs work.

## 5. Where it lives

**JoyoFit**, Sleep screen (`src/features/sleep/SleepScreen.tsx`): a "Wawasan tidur" section above "Earlier nights", and one teaser line on the Today sleep summary when a fresh finding exists. No new tab. Reason: the stages, onset, HRV, minute HR and workouts only exist there. **JoyoRogo**: no UI in the MVP (it holds hours only). **Coach**: untouched in the MVP; later it may read the top finding as one more fatigue signal.

## 6. Data flow, privacy, computation

```
watch -> JoyoFit SQLite (sleep, HRV, HR, workouts)  --\
JoyoRogo food/listByDate (already phone-bound) -> food_event --> night_feature + exposure -> stats -> cards
BLE thermometer (later) -> env_sample ---------------/        (all on the phone)
```

- **Computed on the phone.** The inputs are on the phone, the work is about 60 nights x 10 features, and a few thousand resamples take milliseconds. Not on the JoyoFit Worker (it would need minute-level uploads that a free account never sends) and not in Rogo (daily hours only).
- **What leaves the phone in the MVP: nothing new.** Food already travels Rogo -> phone; scores already go phone -> Rogo; derived tables are not added to cloud sync, group sharing (`shareFitness`, `shareFood`), family monitoring or the MCP connector. Log lines carry counts only, never food names or times, because Atur reports upload the whole log (`docs/atur-reports.md`).
- `food_event` is a copy of Rogo's data: it is cleared on Rogo sign-out or account switch. Raw watch data is never deleted by this feature.
- Later and only with an explicit toggle: a one-line finding in the Coach chat snapshot or the MCP `get_recovery_metrics`.

## 7. Data model (local tables, JS-created like `ensureScaleSchema`)

| Table | Key | Fields |
| --- | --- | --- |
| `food_event` | Rogo item id | local day, `at` (ms, log time), meal, kcal, grams?, `caffeine_mg?`, `alcohol` (0/1), name (display only, never logged) |
| `night_feature` | wake day | onset, wake, asleep s, awake s, awakenings, efficiency, deep s?, rem s?, `has_stages`, night HRV, night resting HR, mid-sleep, feature version |
| `exposure` | wake day | caffeine at bedtime mg, last alcohol at, dinner end, dinner kcal, evening workout (end, avg HR share), `food_complete` |
| `env_sample` (later) | sensor id + ts | temp C, RH %, battery %, source format. Downsampled to 5 min |
| `night_env` (later) | wake day | mean and p90 temperature and RH between onset and wake, minutes above the person's 75th percentile |
| `insight_state` | insight id | first shown, dismissed, last passing |

`night_feature` and `exposure` are caches: rebuilt from raw data when the feature version changes. A **factor registry** (id, how to extract per night, primary outcome, prior, copy keys) is the only thing the stats engine knows, so temperature and humidity are two new registry rows plus the sampler, with no engine or card change.

**Caffeine and alcohol classification**: best done once, server side: JoyoRogo returns `caffeineMg` and `alcohol` per item in `food.listByDate` (additive, JS-only deploy) and a `food.listRange` so 42 days are one call instead of 42. Without that change JoyoFit ports the two rule tables and calls `foodDay` per missing day; the rules would drift from Rogo's. Items classified nothing count as none.

## 8. Bedroom sensor (later; the model above already fits)

- **Scale**: unlikely (see section 1); decide when the recorder shows its advertisements.
- **Xiaomi LYWSD03MMC**: stock firmware is read over a GATT connection (and has no plain advertisement, as far as I know; not verified here). The practical route is the community firmware, flashed from a browser ([pvvx/ATC_MiThermometer](https://github.com/pvvx/ATC_MiThermometer)), which advertises on service UUID `0x181A` in selectable formats:

| Format | Layout (service data) | Resolution |
| --- | --- | --- |
| ATC1441 | MAC (6, big-endian), temperature int16 BE, humidity u8, battery % u8, battery mV u16 BE, counter u8 | 0.1 C, 1 % |
| PVVX custom | MAC (6, little-endian), temperature int16 LE, humidity u16 LE, battery mV u16 LE, battery % u8, counter u8, flags u8 | 0.01 C, 0.01 % |
| BTHome v2 | self-describing objects | per object |

  The MAC is in the payload, which solves the iOS case where the scan id is a UUID, not a MAC. The `counter` dedupes repeats; all decoding is TypeScript on the existing advertisement event, so foreground support is OTA. Hardware sold since 2025-03 (B1.5/B1.6) is not recommended by the firmware author, and firmware 2.1.1 needs Mi Home registration; check the hardware version before buying.
- **The real risk is overnight capture with the app closed.** Background scanning is throttled on both platforms [INFERENCE, needs a spike]. The better path is the firmware's own flash log (20,000 records, 10 minute step by default): connect in the morning, read the night, no overnight scan. That needs a GATT reader (native code, store build). The spike decides between (a) foreground-only scan, (b) a foreground service like the workout recorder, (c) the flash log.
- Pairing reuses the `sensor` table with a new kind (`env`); the `SensorKind` list is hr/csc/power/rsc today. Temperature bands are the person's own (hot third vs cool third), because the literature gives no universal threshold and tropical bedrooms are warm.

## 9. MVP vs later

**MVP (JS only, OTA)**: `food_event` loader (existing endpoint or the new range call), `night_feature` and `exposure` builders, the stats engine and registry, caffeine, alcohol, dinner, evening workout and regularity factors, "Wawasan tidur" section, Umum tips from night 1, en and id copy (`docs/i18n.md`), tests next to the code. **Later**: Rogo `eatenAt`; room sensor and temperature/humidity factors; naps as a factor; SpO2 and skin temperature as context only; Coach and MCP tie-in (opt-in); iOS night HRV when the platform allows it; a 7-day "experiment" mode (one change, compare nights).

## 10. Open questions for the owner

1. Pro-gate (like Coach) or free for everyone? Free tips and Pro personal findings is the obvious split.
2. May I change JoyoRogo: `caffeineMg` / `alcohol` per item, `food.listRange`, and later an optional `eatenAt` on `food_log`? Without `eatenAt`, every time-based claim is "dicatat jam ...", and logs entered late understate the gap.
3. Is it fine that a coffee that is never logged looks like a night without coffee? The 2-meal completeness rule softens this; an "aku selalu catat minuman" switch would be exact.
4. Which days are free days (Sat/Sun for everyone, or a setting)? Shift workers need the setting.
5. Is `tape` / `tapai` an alcohol item for you? (I would exclude it from the sleep list.)
6. Room sensor: buy a LYWSD03MMC with the right hardware version, and are you willing to flash it? Is a store build with a foreground service or GATT reader acceptable for it?
7. Watch Fit 2 gives no stages. Is "duration, awake time, HRV, heart rate only" acceptable for it, or should we hide personal findings there?
8. Should a finding ever appear in Today or notifications, or only on the Sleep screen?
