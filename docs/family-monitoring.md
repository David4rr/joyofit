# Family monitoring: design

Status: built (phases 1 to 5; see section 11 for what shipped, credentials and limits). A watcher (adult child) sees a few daily numbers from a monitored person's (parent's) Huawei watch and gets a nudge when something looks off. Copy is Indonesian "kamu", no emojis; Ionicons, in-app dialogs only, pre-permission buttons say "Lanjut".

## 1. Constraints found in the code

- **Groups** (joyorogo `team`, `team_member`, `routers/group.ts`) are symmetric and joined by a reusable 8-char code. `shareFitness` is one boolean per group and exposes only `fitness_score` (recovery, strain, sleepPct, readiness): no HR, steps, sync time or SpO2. They live in JoyoRogo's D1; watch data lives in JoyoFit's D1.
- **Pro** is JoyoRogo `tier = founder` (`premiumUnlocked`; all unlocked when the paywall is off). `social.workoutDetail` gates per viewer.
- **Sync path.** The watch syncs to the phone every 30 min by default (`WearSettings`, 5 to 1440) via the Android `WatchService`. Upload to `POST /v1/sync` runs **only in JS** (`CloudProvider`: after a sync the UI sees, on foreground, "Sync now"; its comment says background-stored rows wait for one of those) and is `requireFounder`. Today a parent who never opens JoyoFit, or is not Founder, sends the server nothing. `step_samples` has steps, heart_rate, spo2, resting_heart_rate; `device.last_sync` exists; daily resting HR is `MIN(resting_heart_rate)` (`src/db/queries.ts`).
- **Push.** JoyoRogo has browser Web Push only (VAPID, `push_subscription`, `*/5` cron `runFastingReminders`). Native apps only schedule local notifications. **No remote push to a phone exists in either repo**; watch-fit has no `expo-notifications`. Email exists in JoyoRogo (`sendEmail`, `claimEmail` dedupe). `joyofit-api` has no cron, email or VAPID.
- Only the `joyofit://` scheme exists (no universal links), so invites need a web landing page.

## 2. Screens (a "Keluarga" card on Today and an entry in Settings; routes under `src/app/family/`; not the Social tab)

1. **Invite.** Watcher picks a label (Ibu, Bapak...), gets a single-use code and `fit.joyorogo.com/keluarga/<code>` (48 h) via the share sheet. The parent can also start it. The page opens `joyofit://family/accept?code=` or the store; manual code entry too.
2. **Accept and consent** (monitored side, `family/consent/[id]`): who asked, per-category switches (all off until turned on), the not-real-time notice, "Lanjut". Nothing uploads before this.
3. **Dashboard.** Card per person: "Data per 10.42 (3 jam lalu)", steps, resting HR vs baseline, last sleep, chip (Baik / Perlu dicek / Belum sinkron), persistent disclaimer card.
4. **Member detail.** Today, 7/30-day trends, sync health (watch seen, phone seen, battery), alert history, snooze, "Tanya kabar" (poke, 1 h throttle like groups), remove.
5. **Alert settings** per person: rule switch, threshold, hour, channel, quiet hours, pause. Notification pre-permission screen with "Lanjut" before the OS prompt.
6. **Monitored side** (`/family/me`): list of watchers; per watcher switches for Sync+baterai (required), Langkah, Tidur, Detak jantung istirahat, SpO2; Jeda (1 jam / hari ini / sampai kunyalakan); "Lihat data yang terkirim" (exact last payload); "Putuskan dan hapus riwayat"; last-viewed time; monthly reminder "Dina masih bisa melihat kabarmu". No covert mode.

## 3. Data model and endpoints: recommendation

**Do not reuse groups; add a directional `family_link`.** A group's reusable code exposes every member, visibility is mutual, and the only health switch is the daily score. Family needs one-way, per-category consent, pause, audit and hard revoke. Reuse only the code alphabet, the recipient-locale push pattern, `premiumUnlocked` and the poke throttle.

**Where:** tables, ingest and evaluator in `joyofit-api` (migration `0005_family.sql`), next to the data and the new cron. JoyoRogo adds one internal endpoint, `POST /internal/joyofit/family/users` (`apps/server/src/family.ts`, Basic auth with the Strava client credentials both Workers already hold), returning `{id, name, email, locale, tier, pro}` for up to 50 user ids, because cron has no session cookie. Answers are cached 5 minutes per isolate; when JoyoRogo cannot answer, a watcher counts as not Pro (the free no-sync push still works) and no history is shortened.

Tables: `family_link(id, monitored_id, watcher_id, label, status pending|active|paused|revoked, scopes, paused_until, accepted_at, last_viewed_at)`; `family_invite(code_hash, inviter_id, role, expires_at, used_at)`; `family_day(user_id, date, steps, first_step_at, resting_hr, sleep_min, spo2_min, last_sample_at)`, kept 30 d free / 90 d Pro; `family_state(user_id, phone_seen_at, watch_sync_at, battery)`; `family_rule`; `family_alert_state(link_id, rule, open_since, last_sent_at, count, snooze_until)`; `family_alert_log`; `family_push_token`. All join `deleteUserData` (both roles) and JoyoRogo's account export/delete.

**The phone uploads a minimal daily summary, not `/v1/sync`:** only granted categories, no GPS, workouts or minute-level HR, and no Founder gate. Endpoints under `/v1/family` (the viewer is always the session user; ids resolve through `family_link`): invites, invites/accept, links (GET; PATCH scopes/pause by monitored only, rules by watcher only; DELETE by either side wipes `family_day`), links/:id/summary, rules, snooze, poke, `PUT ingest`, `GET config`, `PUT push-token`.

## 4. Alert rules (WIB, defaults, editable per link)

Baseline = median resting HR over 14 days, needs 7 days; until then no health-signal alerts. A stale feed silences rules 1, 3, 4, 5.

| Rule | Fires when | Level |
|---|---|---|
| 1 Resting HR high | >= baseline + max(10 bpm, 15%) two days running, or >= baseline + 20 once, or >= 100 | push |
| 1b Resting HR low | <= baseline - 15 and <= 45 | push |
| 2 No sync (**free**) | no new sample or sync for 12 h between 07:00 and 21:00 in the parent's time zone; says "ponsel diam" vs "jam diam" using phone_seen_at and battery; repeats at 24 h and 72 h, then stops | push |
| 3 No steps | fresh data but < 200 steps by 11:00 (09 to 14 editable) | push |
| 4 Poor sleep | < 4 h once, or < 5.5 h three nights running; missing sleep data is not poor sleep | digest |
| 5 Low SpO2 | only if SpO2 seen in 7 days: >= 2 readings <= 90% that day, or the day's lowest reading <= 90% two days running (the phone sends per-day minimum and count, not nights); **off by default, optional** | push |

Anti-spam: dedupe key `rule:date`; re-arm only after one clear day; one push per rule per 24 h; max 3 pushes per day per watcher (rest go to the 19:00 digest); quiet hours 21:30 to 06:30 queued to 06:30; snooze 1/3/7 days from the notification; paused or revoked links never evaluate. Copy stays neutral ("lebih tinggi dari biasanya"), never a diagnosis or "darurat". SpO2 reads "kata jam" because App Store 1.4.1 scrutinises blood-oxygen claims.

## 5. Delivery and scheduling

- **Push:** Expo Push Service from `joyofit-api` (`EXPO_ACCESS_TOKEN` optional). `expo-notifications` and `POST_NOTIFICATIONS` are in watch-fit (native rebuild) and need FCM v1 and APNs credentials through EAS. Huawei phones without Google services get no FCM, so Pro watchers fall back to email; a Free watcher with no working push gets nothing (email is Pro).
- **Email:** Cloudflare Email binding `EMAIL` on `joyofit-api` (sender `halo@mail.joyorogo.com`, same as JoyoRogo), Pro only. The insert into `family_alert_log` (`UNIQUE(link_id, dedupe_key)`) is the claim taken before any send. Used when the watcher turns it on, and as the fallback when push reached nobody. Every email carries the disclaimer.
- **Cron** (`triggers.crons`): `*/15 * * * *` runs absence rules (2, 3) only for links whose `next_check_at` has passed, then sends alerts that waited out quiet hours; `0 12 * * *` (19:00 WIB) digests; `0 20 * * *` purge (history past 90 days, or 30 when no live watcher is Pro). Every rule also runs **on ingest**, which is what makes rules 1, 4, 5 timely.
- **Critical risk:** JS-only upload means the feed moves only when the parent opens the app. The native module therefore builds and posts the summary itself after each background sync (Android `BackgroundController.cycle()` inside `WatchService`; iOS a background `URLSession`), using a revocable per-device token minted at consent. iOS is best effort; limits in section 11.

## 6. Free vs Pro (Pro = the watcher; the parent is never gated or charged)

| | Free | Pro |
|---|---|---|
| People watched | 1 | up to 5 |
| Dashboard, sync status | yes | yes |
| Alerts | "No sync" push (switch and hours) | all rules, thresholds, SpO2, email, digest |
| History | 30 days | 90 days |
| Watchers per parent | 5 | 5 (the parent is never gated, so this is flat) |

On lapse the oldest link stays live, others freeze (no deletion).

## 7. Consent and disclaimer copy (id)

Consent: **"Izinkan Dina melihat kabarmu?"** "Dina ingin ikut memantau kabarmu dari jam Huawei-mu. Kamu yang menentukan apa yang dibagikan." Switches: "Terakhir jam tersambung dan baterai", "Langkah harian", "Tidur semalam", "Detak jantung saat istirahat", "Kadar oksigen (SpO2)". "Tidak pernah dibagikan: lokasi, rute olahraga, detak jantung per menit, makanan, foto." "Dina bisa dapat pemberitahuan kalau datamu terlihat tidak biasa, misalnya belum ada langkah sampai siang. Itu bukan diagnosis dokter." "Kamu bisa jeda atau berhenti kapan saja. Kalau berhenti, Dina langsung tidak bisa melihat apa pun dan riwayatnya kami hapus." Buttons: "Lanjut" / "Nanti saja".

Not-real-time disclaimer (first-run screen, then a card on each family screen and in alert emails): "Ini bukan pantauan langsung. Data baru masuk setelah jam tersinkron ke ponsel dan ponselnya terhubung internet, jadi bisa telat dari beberapa menit sampai berjam-jam. JoyoFit bukan alat darurat dan tidak mendeteksi jatuh, serangan jantung, atau kondisi gawat. Kalau kamu khawatir, telepon langsung atau hubungi layanan darurat (112)."

Watcher notification pre-permission: "Aktifkan notifikasi supaya kamu dapat kabar dari Ibu. Notifikasi bisa terlambat dan tidak menjamin kamu langsung tahu." Button "Lanjut".

## 8. Store and legal

- **Apple:** 5.1.3(i) (health data: no ads or data mining; disclosure only with permission), 5.1.1 (consent; in-app account deletion already exists), 1.4.1 (no diagnosis or accuracy claims, doctor reminder; guideline text checked). Privacy label: Health & Fitness now shared with another user on request. Push adds the APNs entitlement and must not be required for app function.
- **Google Play:** monitoring without disclosure and consent is stalkerware under the Malware policy (checked). So: no covert mode, visible link list and last-viewed, prominent in-app disclosure and a store listing line. Update Data safety (health info shared; whether user-initiated sharing counts must be confirmed in Play Console [INFERENCE]); keep "Activity and fitness". Android 13+ needs the notification prompt.
- **Indonesia, UU PDP 27/2022:** health data is specific personal data needing explicit, withdrawable consent, which the per-category switches give [INFERENCE: not checked against the statute; get a legal read].
- Update `fit.joyorogo.com/privasi`, `docs/app-store.md`, `docs/play-store.md`. Daily summaries only; revoke deletes at once; account deletion cascades.

## 9. Build plan (one developer, working days)

| Phase | Scope | Days |
|---|---|---|
| 0 Spikes | Done: see section 11 | 4 |
| 1 Link, consent, dashboard | Migration, invite/accept/ingest, foreground summary upload, screens 1 to 4 and 6, privacy and store docs | 10 |
| 2 Background upload | Android native post with device token (3); iOS (+3, or defer) | 3 to 6 |
| 3 Alerts | Rule engine, cron, push, email, settings, anti-spam state, tests | 8 |
| 4 Pro and polish | Gating, downgrade, history, digest, poke, two-phone QA, store resubmission | 5 |

About 30 days (6 weeks) with iOS background, 27 Android-first.

## 10. API contract (implemented in `server/src/family/`)

All routes are under `https://api.fit.joyorogo.com/v1/family`. Session cookie auth like the rest of `/v1`, except `PUT /ingest` which takes `Authorization: Bearer <device token>`. Times are Unix ms; `date` is `YYYY-MM-DD` in the **monitored person's** local calendar. Errors are `{error: code}`.

**Scopes** `{sync, steps, sleep, restingHr, spo2}` booleans, `sync` always true once consented. **Chip** `ok | check | nosync`. Link JSON (`Link`): `{id, role:'watching'|'watchedBy', label, otherName, status:'pending'|'active'|'paused'|'revoked', scopes, pausedUntil: number|null (-1 = until I turn it on), acceptedAt, lastViewedAt, frozen: boolean}`.

| Route | Who | Body / result |
|---|---|---|
| `POST /invites` | either | `{role:'watcher'|'monitored', label}` where `role` is the inviter's own role. Returns `{code, url, expiresAt}`; code is 8 chars, 48 h, single use; `url = https://fit.joyorogo.com/keluarga/<code>` |
| `GET /invites/:code` | any signed-in | preview `{inviterName, inviterRole, label, expiresAt}` or 404 `invite_invalid` |
| `POST /invites/accept` | acceptor | `{code, label?}`, returns `{link: Link}` (status `pending`: nothing uploads until the monitored person consents). 409 `limit_reached` (+`pro:false` for the watcher cap), 400 `own_invite` |
| `GET /links` | any | `{watching: WatchingItem[], watchedBy: Link[], limits:{pro, maxWatching, maxWatchers, historyDays}}`. `WatchingItem = Link & {dataAt: number|null, chip, today:{steps, restingHr, sleepMin}|null}` (today masked by scopes) |
| `PATCH /links/:id` | monitored: `{scopes?, pausedUntil?, consent?: true}`; watcher: `{label}` | returns `{link}`. `consent:true` with scopes moves `pending` to `active`; an empty `scopes.sync` is refused |
| `DELETE /links/:id` | either | revokes, deletes the link's alert state; deletes `family_day` rows when no other active link remains. `{deleted:true}` |
| `GET /links/:id/summary?days=7|30|90` | watcher | sets `last_viewed_at`. `{link, state:{phoneSeenAt, watchSyncAt, battery}|null, chip, dataAt, days:[{date, steps, restingHr, sleepMin, spo2Min}] (masked by scopes, clamped to history days), baseline:{restingHr|null, days}, alerts:[{id, rule, at, level, body}], rules, snoozeUntil}` |
| `GET/PUT /links/:id/rules` | watcher | `Rules = {noSync:{on, hours}, restingHr:{on}, noSteps:{on, hour}, sleep:{on}, spo2:{on}, push:boolean, email:boolean, quietStart:'21:30', quietEnd:'06:30'}`; Free can only change `noSync.on` and `noSync.hours`, anything else is 402 `pro_required` |
| `POST /links/:id/snooze` | watcher | `{days:1|3|7}`, returns `{snoozeUntil}` |
| `POST /links/:id/poke` | watcher | pushes "Tanya kabar" to the monitored phone; 429 `poke_throttled` within 1 h |
| `GET /config` | monitored (session) | `{scopes, enabled, links:[{id, scopes, status}]}` union of active, unpaused links |
| `POST /device-token` | monitored (session) | `{deviceId, label?}` returns `{token}` shown once; max 5 per user, same `deviceId` replaces |
| `DELETE /device-token` | monitored | `{deviceId}` revokes |
| `PUT /ingest` | device bearer | see below; 401 `bad_token`, 403 `no_active_link` (the phone clears its config) |
| `PUT /push-token` | any | `{token, platform:'ios'|'android', deviceId}` Expo push token (`ExponentPushToken[...]`) |
| `DELETE /push-token` | any | `{deviceId}` |
| `GET /me/last` | monitored | `{payload: string|null, at}` last ingest body, exact |

**Ingest body:** `{sentAt, tzOffsetMin, watchSyncAt: number|null, battery: number|null, days:[{date, steps?, firstStepAt?, restingHr?, sleepMin?, spo2Min?, spo2LowCount?, lastSampleAt?}]}`: at most the last 3 days; a category the person did not grant is absent. `sleepMin` of date D is the night that ends on D (segments ending between 18:00 of D-1 and 18:00 of D, local). `spo2LowCount` = readings <= 90 on date D. `lastSampleAt` = newest step/HR sample time. Response `{ok:true, config:{scopes, enabled}}`.

**Push payload** (Expo Push `data`): `{type:'family_alert', linkId, rule}` and `{type:'family_poke', linkId}`; tapping opens `joyofit://family/<linkId>`.

**Deep links:** `joyofit://family/accept?code=XXXXXXXX`.
