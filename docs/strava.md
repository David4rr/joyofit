# Strava in JoyoFit

JoyoFit sends a watch workout to the wearer's own Strava account, from Settings → Strava (button on a workout's screen,
and automatically for workouts that finish after connecting). It is free: no JoyoRogo Pro check anywhere.

How it is built is in the README ("Strava"). This page is the owner's runbook: set up the Strava API application, set the
Worker secrets, register the webhook, and pass Strava's review.

Source of truth:

- Authentication: <https://developers.strava.com/docs/authentication/>
- Webhook events: <https://developers.strava.com/docs/webhooks/>
- Brand guidelines: <https://developers.strava.com/guidelines/>
- API Agreement: <https://www.strava.com/legal/api>
- Review/quota request form: <https://share.hsforms.com/1VXSwPUYqSH6IxK0y51FjHwcnkd8>

## 1. Owner setup

JoyoFit has its **own** Strava API application (client id `287873`, <https://www.strava.com/settings/api>). Not JoyoRogo's.

1. In the Strava application settings set **Authorization Callback Domain** to exactly

   ```
   api.fit.joyorogo.com
   ```

   (the Worker's custom domain from `server/wrangler.jsonc`, no scheme, no path). The Worker's callback is
   `https://api.fit.joyorogo.com/strava/callback`. The callback URL is derived from the request host, so connect only
   through this host; the old `joyofit-api.dzulfikar-at.workers.dev` host stays up for older builds but Strava rejects
   its callbacks.
2. Set the Worker secrets (from `server/`, never in `wrangler.jsonc`, never in the app):

   ```bash
   bunx wrangler secret put STRAVA_CLIENT_SECRET          # the application's client secret
   bunx wrangler secret put STRAVA_WEBHOOK_VERIFY_TOKEN   # any random string you choose, e.g. `openssl rand -hex 24`
   ```

   `STRAVA_CLIENT_ID` (`287873`) is a plain var in `server/wrangler.jsonc` (a client id is public).
3. Apply the D1 migration and deploy:

   ```bash
   bun run db:migrate:remote      # adds strava_connection
   bun run deploy
   ```

4. Register the **deauthorization webhook**. Strava allows one subscription per application. It validates the callback
   with a `GET` carrying the verify token, so the secret from step 2 must exist first:

   ```bash
   curl -X POST https://www.strava.com/api/v3/push_subscriptions \
     -F client_id=287873 \
     -F client_secret="$STRAVA_CLIENT_SECRET" \
     -F callback_url=https://api.fit.joyorogo.com/strava/webhook \
     -F verify_token="$STRAVA_WEBHOOK_VERIFY_TOKEN"
   ```

   An answer `{"id": N}` means it is live. Check later with
   `curl -G https://www.strava.com/api/v3/push_subscriptions -d client_id=287873 -d client_secret=...`. The Worker only acts
   on the `athlete` / `authorized: "false"` event (it deletes that athlete's tokens); activity events are acknowledged and
   ignored.
5. Until the application is approved, only the application owner's Strava account (and up to a few invited athletes) can
   connect; see the review checklist below.

Worker routes (all in `server/src/strava.ts`):

| Route | Auth | |
|---|---|---|
| `GET /v1/strava` | JoyoRogo session | `{ configured, connected, athleteId, connectedAt, scope }` |
| `GET /v1/strava/authorize` | JoyoRogo session | `{ url }`: Strava's `oauth/mobile/authorize`, scope `activity:write`, signed `state` |
| `POST /v1/strava/token` | JoyoRogo session | `{ accessToken, expiresAt, athleteId }`; refreshed server-side when it expires within 10 minutes; `409 strava_not_connected` otherwise |
| `POST /v1/strava/disconnect` | JoyoRogo session | revokes at Strava (`oauth/revoke`, Basic auth) and deletes the row |
| `GET /strava/callback` | none (Strava redirect) | exchanges the code, stores tokens, redirects to `joyofit://settings/strava?status=connected` (or `status=error&reason=...`) |
| `GET /strava/webhook` | verify token | Strava's subscription validation: echoes `hub.challenge` |
| `POST /strava/webhook` | none (Strava) | deauthorization event deletes the athlete's tokens; always answers 200 |

The refresh token and client secret never leave the Worker; the phone receives only the access token (6 h lifetime).

## 2. What Strava's rules mean here

| Rule | How JoyoFit follows it |
|---|---|
| Strava sync must be free (API Agreement 5.8) | No Founder/Pro check on any Strava route or in the app. |
| No Strava data into AI/analytics (5.3 / 5.4) | The app reads nothing from Strava except the status of its own upload. The Worker stores the athlete id and tokens only. Nothing is sent to analytics, AI or JoyoRogo. |
| Show Strava data only to its owner | The only Strava data shown is the link to the activity the wearer uploaded, on that wearer's phone. |
| Deauthorization webhook | `POST /strava/webhook` deletes the tokens of an athlete who revokes JoyoFit on strava.com. |
| Tokens in the Authorization header | Uploads and polling use `Authorization: Bearer`; the client secret only appears in the Worker's server-to-server calls. |
| Brand | Official "Connect with Strava" button and "Compatible with Strava" logo, unmodified (`assets/strava/`), linking to `oauth/mobile/authorize`; "View on Strava" text link in `#FC5200`, bold, underlined; the app name does not contain "Strava". |

Upload details (so the numbers on Strava are the watch's): a FIT activity file (`data_type=fit`, binary multipart body;
<https://developers.strava.com/docs/uploads/#fit-flexible-and-interoperable-data-transfer>) with every sample from start
to end as a `record` (position, heart rate, altitude, per-record cumulative distance: the watch's distance spread over the
active time, so the stretches before the first and after the last GPS fix move at the average speed instead of reading as
stopped), timer start and stop `event`s, one `lap` and one `session` carrying `total_elapsed_time`, `total_timer_time` (the watch's active
time), `total_distance`, `total_calories`, heart rate, `total_ascent`/`total_descent`, speeds and, for running, walking and
hiking, `total_cycles` (strides = steps / 2) and `avg_cadence`, and an `activity`. The sport comes from the FIT
`session.sport`/`sub_sport` mapped from the Huawei sport type; the form's `sport_type` overrides what Strava detects from the
file. `file_id.manufacturer` is 255 (development): Strava only maps a device name to a manufacturer ANT+ assigned, so the
activity shows no device. `external_id = joyofit-<workout start>` (a second upload of the same workout is refused by Strava
as a duplicate and the app then links the existing activity). The watch provides no per-sample speed or cadence and no
list of pauses. Strava's moving time (<https://support.strava.com/en-us/articles/15401804-moving-time-speed-and-pace-calculations>)
comes from the file's timer events when it has any and is otherwise recomputed from the GPS and distance stream (it ignores
`total_timer_time`: the first FIT showed 32:33 for 36:09 walked). So when the watch's elapsed time exceeds its active time by
30 s or more, the file gets a timer stop and start `elapsed - active` long, centred on the longest gap between GPS fixes
(else between samples), and the record distance is flat across it. The pause's length is the watch's; its exact position is
not stored by the watch, so it can be off by the difference between the GPS gap and the pause (seconds).

## 3. Review submission checklist

Submit through the form <https://share.hsforms.com/1VXSwPUYqSH6IxK0y51FjHwcnkd8> (it asks for the application, what it does,
screenshots and how athlete data is handled). Before sending:

- [ ] Application name does not contain "Strava"; icon is JoyoFit's, not a Strava mark. Website `https://fit.joyorogo.com`,
      Authorization Callback Domain as in section 1.
- [ ] The Worker has both secrets and the webhook subscription exists (`GET push_subscriptions` shows it).
- [ ] A test run with a second Strava account works end to end: connect, finish a workout, it appears on Strava with the
      watch's distance, calories, heart rate and route; disconnect; removing JoyoFit on strava.com then makes
      `strava_connection` lose the row (`bunx wrangler d1 execute joyofit --remote --command "select count(*) from strava_connection"`).
- [ ] Privacy policy (<https://fit.joyorogo.com/privasi>) mentions Strava: what is sent (workout file), that tokens are kept
      on the server until you disconnect or revoke, and how to remove them.
- [ ] Screenshots (Android, light theme is fine), each showing the app's own name:
  1. Settings → Strava, not connected: the official **Connect with Strava** button and the "Compatible with Strava" logo.
  2. Strava's authorization page with the `activity:write` permission ("Upload your activities").
  3. Settings → Strava, connected: the connected state, the description switch (off) and **Disconnect Strava**.
  4. A workout screen with **Send to Strava** (before) and **View on Strava** in orange (after).
  5. The same activity on strava.com or in the Strava app, with the watch's distance, calories and heart rate.
  6. (If asked) the webhook: the `push_subscriptions` view output, or the Worker log of a deauthorization event.
- [ ] State in the form: free for every user, the single scope `activity:write`, uploads only to the wearer's own account,
      no Strava data is read, stored, shown to others, or used for analytics or AI, and tokens are deleted on disconnect and
      on deauthorization.

## 4. Troubleshooting

- `redirect_uri invalid` on Strava's page: the callback domain in the Strava application is not the Worker host from section 1.
- The app says Strava is "not set up on the JoyoFit server": `STRAVA_CLIENT_SECRET` is not set (`GET /v1/strava` answers `configured: false`).
- Subscription creation fails: the verify token secret is missing or differs from `verify_token`, or the Worker is not
  deployed with this change; test with
  `curl 'https://api.fit.joyorogo.com/strava/webhook?hub.mode=subscribe&hub.challenge=x&hub.verify_token=<token>'`.
- Connected but nothing uploads: only workouts that **ended after** the connect time go up automatically; older ones need
  **Send to Strava**. Imported (Huawei export) workouts are never sent automatically.
- iOS: connecting opens Strava in an `ASWebAuthenticationSession` (`WebBrowser.openAuthSessionAsync`, which takes the
  callback scheme `joyofit` from `joyofit://settings/strava`). The Worker's 302 to that URL ends the session and returns to
  the app; the Strava app is not opened from inside the session, the web page is used. Automatic uploads on iOS only run
  while the app is in front (and each time it comes back): iOS suspends the app, and the keychain item holding the JoyoRogo
  session cannot be read while the phone is locked. A workout the watch synced in the background is therefore sent when
  JoyoFit is opened.
- iOS: Strava says `redirect_uri invalid` although the callback domain is right: that build still carries the old cloud host
  (`joyofit-api.dzulfikar-at.workers.dev`) in its embedded `app.config` (TestFlight builds up to 202610160308 did, because the
  pipeline never regenerated it; see `docs/ios-linux.md`). Install a newer build.
- A workout shows "Strava refused the file": the message is Strava's; the button retries after you fix the cause.

## 5. Tests

- `bun test ./src/` (also `bun run test`): `src/features/strava/fitEncoder.test.ts` (CRC, header, every field type, buffer
  growth) and `activityFile.test.ts` (the file built from workouts, decoded back with Garmin's `@garmin/fitsdk`, a devDependency
  used only by the tests: totals, record count, positions, heart rate, distance scaling, full-span samples, sport mapping,
  duplicate detection, upload form).
- `cd server && bun run test`: `server/test/strava.test.ts` (signed state, code exchange, refresh and rotation, revoke,
  webhook validation and deauthorization, token isolation between users).
