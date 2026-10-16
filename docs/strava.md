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

## 1. One Strava application, shared with JoyoRogo

JoyoFit and JoyoRogo (<https://joyorogo.com>, which imports burned calories from the athlete's Strava activities) use the
**same** Strava API application, client id `287873` (<https://www.strava.com/settings/api>), because the athlete capacity
(10) is per application and a second application would split it. What that means:

- **Scopes.** JoyoFit asks for `activity:write`, JoyoRogo for `read,activity:read_all`. Strava's docs do not say what a
  second authorization does to the first one's scope; they say the athlete can opt out of any scope on the page, that
  the scopes that come back "may differ from the originally-requested list", and that the application must check them
  (<https://developers.strava.com/docs/authentication/>, "Details About Requesting Access" and "Token Exchange"). So
  neither product ever requests only its own scopes once the athlete has granted others: the authorize URL asks for the
  product's scopes **plus every scope already granted** (JoyoRogo computes it: `requestedScope` in
  `packages/api/src/lib/strava-grant.ts`), and each product refuses a grant that lacks the scope it cannot work without
  (`activity:write` for JoyoFit, `activity:read_all` or `activity:read` for JoyoRogo). A connect in one product can
  therefore only widen the grant, never narrow what the other uses.
- **One token store.** Strava keeps one access token and one refresh token per athlete and application: "If the
  application has an access token for the user ...", "Once a new refresh token is returned, the older refresh token is
  invalidated immediately" (same page, "Refreshing Expired Access Tokens"). Two stores, each keeping "the latest" token,
  would invalidate each other whenever one refreshes. So the tokens live **only in JoyoRogo's D1**, table
  `strava_account` (`rogo_linked_at`, `fit_linked_at`, `scope`), and JoyoFit's Worker asks JoyoRogo's Worker for them
  (`POST https://api.joyorogo.com/internal/joyofit/strava/{status,exchange,token,disconnect,deauthorized}`,
  HTTP Basic with the Strava client id and secret, which both Workers hold). The phone still only talks to JoyoFit's
  Worker and still only receives the short-lived access token. JoyoFit's old table `strava_connection` is gone
  (migration `0004_drop_strava_connection.sql`, after its rows were copied into `strava_account`).
- **Disconnect.** A product only unlinks itself. The grant is revoked at Strava (`oauth/revoke`, which "invalidates all
  refresh tokens and access tokens that the application has for the athlete") only when the **last** product unlinks,
  so disconnecting in JoyoFit never cuts JoyoRogo off and the other way round. Deleting the account revokes it outright.
- **Deauthorization.** Strava allows one webhook subscription per application, and it points at this Worker
  (`/strava/webhook`). A deauthorization event (the athlete removed the app on strava.com) is forwarded to JoyoRogo,
  which deletes the tokens for both products and what JoyoRogo imported from Strava. If the forward fails the Worker
  answers 503 so Strava retries the event (the delete is idempotent).
- **No double counting.** A workout JoyoFit uploads carries `external_id = joyofit-<workout start>`. JoyoRogo gets that
  workout from Health Connect / Apple Health (JoyoFit's **Write to Health Connect**), so JoyoRogo's Strava import skips
  every activity whose `external_id` starts with `joyofit-`. Without that export a JoyoFit workout does not appear in
  JoyoRogo's diary; turn the export on.
- **Consent screen.** Strava shows the application's name and description to every athlete who connects, from either
  product. See the recommendation under "Branding" in section 3.

## 2. Owner setup

1. In the Strava application settings set **Authorization Callback Domain** to exactly

   ```
   joyorogo.com
   ```

   (no scheme, no path). Strava accepts any redirect on that domain and its subdomains, which covers all three callbacks:
   JoyoRogo web `https://joyorogo.com/profil/strava/callback`, JoyoRogo's Android/iOS app `joyorogo://joyorogo.com/strava`, and
   this Worker's `https://api.fit.joyorogo.com/strava/callback`. The callback URL of this Worker is derived from the
   request host, so connect only through that host; the old `joyofit-api.dzulfikar-at.workers.dev` host stays up for older
   builds but Strava rejects its callbacks.
2. Set the Worker secrets (from `server/`, never in `wrangler.jsonc`, never in the app). `STRAVA_CLIENT_SECRET` must be
   the **same value on both Workers**: JoyoFit's Worker uses it for the signed OAuth state and to authenticate to
   JoyoRogo, JoyoRogo's Worker uses it to talk to Strava and to check that authentication.

   ```bash
   # JoyoFit (from server/)
   bunx wrangler secret put STRAVA_CLIENT_SECRET          # the application's client secret
   bunx wrangler secret put STRAVA_WEBHOOK_VERIFY_TOKEN   # any random string you choose, e.g. `openssl rand -hex 24`
   # JoyoRogo (from apps/server/ in the joyorogo repo): STRAVA_CLIENT_ID=287873 and
   bunx wrangler secret put STRAVA_CLIENT_SECRET
   ```

   `STRAVA_CLIENT_ID` (`287873`) is a plain var in `server/wrangler.jsonc` (a client id is public).
3. Deploy JoyoRogo first (its D1 migration `0032_strava_shared_grant` adds the scope and link columns to `strava_account`),
   then JoyoFit. The first time, copy JoyoFit's existing connections across before JoyoFit's new code runs, and drop the
   old table afterwards:

   ```bash
   # copy each row of joyofit.strava_connection into joyorogo's strava_account (fit_linked_at = connected_at * 1000,
   # expires_at * 1000, scope as stored), then:
   bun run deploy                  # JoyoFit Worker
   bun run db:migrate:remote       # 0004_drop_strava_connection
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
   on the `athlete` / `authorized: "false"` event (it forwards it to JoyoRogo, which deletes that athlete's tokens for both
   products); activity events are acknowledged and ignored. The subscription already exists for application 287873 (it
   points here); do not create a second one from JoyoRogo's side.
5. Capacity. Per Strava's getting-started page (<https://developers.strava.com/docs/getting-started/>): a new application starts in
   single-player mode, where only the owner's own Strava account can authenticate. The owner can upgrade from the API
   settings dashboard to an athlete capacity of 10; once 10 athletes are connected, the application has to be submitted for
   review (the form linked above) before it can grow. **The capacity is shared by JoyoFit and JoyoRogo**: an athlete who
   connects both counts once, but two different athletes count twice. Until the review passes, Strava sync is
   invite-only: people leave their email and Strava profile on <https://fit.joyorogo.com/strava> (stored in D1 table
   `waitlist`, kind `strava`; read it with `scripts/waitlist.sh strava`, see `server/README.md`).

Worker routes (all in `server/src/strava.ts`; none of them touches Strava's token endpoint any more, JoyoRogo does):

| Route | Auth | |
|---|---|---|
| `GET /v1/strava` | JoyoRogo session | `{ configured, connected, athleteId, connectedAt }`; `connected` means JoyoFit is linked **and** the grant has `activity:write` |
| `GET /v1/strava/authorize` | JoyoRogo session | `{ url }`: Strava's `oauth/mobile/authorize`, scope `activity:write` plus whatever the athlete already granted JoyoRogo, signed `state` |
| `POST /v1/strava/token` | JoyoRogo session | `{ accessToken, expiresAt, athleteId }`; refreshed by JoyoRogo when it expires within 10 minutes; `409 strava_not_connected` otherwise |
| `POST /v1/strava/disconnect` | JoyoRogo session | unlinks JoyoFit; JoyoRogo revokes at Strava (`oauth/revoke`, Basic auth) and deletes the grant only if JoyoRogo is not linked too (`revoked` says which) |
| `GET /strava/callback` | none (Strava redirect) | hands the code to JoyoRogo, redirects to `joyofit://settings/strava?status=connected` (or `status=error&reason=...`) |
| `GET /strava/webhook` | verify token | Strava's subscription validation: echoes `hub.challenge` |
| `POST /strava/webhook` | none (Strava) | deauthorization event is forwarded to JoyoRogo (tokens of both products deleted); `503` when the forward fails so Strava retries, `200` otherwise |

The refresh token never leaves JoyoRogo's database; the client secret is in both Workers' secrets and the phone never sees
either. The phone receives only the access token (6 h lifetime).

JoyoRogo's side of the same contract (joyorogo repo): `apps/server/src/strava.ts` (the `/internal/joyofit/strava/*` routes) and
`packages/api/src/lib/strava-grant.ts` (scopes, exchange, refresh with the rotation race handled, unlink, deauthorization).

## 3. What Strava's rules mean here

| Rule | How JoyoFit follows it |
|---|---|
| Strava sync must be free (API Agreement 5.8) | No Founder/Pro check on any Strava route or in the app. |
| No Strava data into AI/analytics (5.3 / 5.4) | The app reads nothing from Strava except the status of its own upload. JoyoRogo's database holds the athlete id and tokens only on JoyoFit's behalf. JoyoFit sends no Strava data anywhere; only the athlete id and the user id travel between the two Workers. |
| Show Strava data only to its owner | The only Strava data shown is the link to the activity the wearer uploaded, on that wearer's phone. |
| Deauthorization webhook | `POST /strava/webhook` forwards the deauthorization of an athlete who revokes the app on strava.com to JoyoRogo, which deletes the tokens (both products) at once. |
| Tokens in the Authorization header | Uploads and polling use `Authorization: Bearer`; the client secret only appears in the Worker's server-to-server calls. |
| Brand | Official "Connect with Strava" button and "Compatible with Strava" logo, unmodified (`assets/strava/`), linking to `oauth/mobile/authorize`; "View on Strava" text link in `#FC5200`, bold, underlined; the app name does not contain "Strava". |

**Branding (recommendation, not applied).** Strava shows the application's name, icon and description on the consent
screen of both products, so a JoyoRogo user currently sees "JoyoFit". Rename the application to **JoyoRogo & JoyoFit**
(still no "Strava" in the name, the brand guideline), keep the website `https://joyorogo.com`, and describe both uses
in the description, for example: *"JoyoRogo (calorie diary) and JoyoFit (Huawei watch app) from Joyo Digitama.
JoyoFit sends your watch workouts to your Strava account; JoyoRogo reads your Strava activities to count the calories you
burned. Free. Remove access any time in Strava or in either app."* Use a neutral Joyo mark as the icon if there is one
(JoyoFit's icon alone would again name only one product). Do the same in the review form, and show both apps' own names
in their screenshots.

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

## 4. Review submission checklist

Submit through the form <https://share.hsforms.com/1VXSwPUYqSH6IxK0y51FjHwcnkd8> (it asks for the application, what it does,
screenshots and how athlete data is handled). Before sending:

- [ ] Application name does not contain "Strava" and names both products (see Branding above); icon is ours, not a Strava
      mark. Website `https://joyorogo.com`, Authorization Callback Domain as in section 2.
- [ ] Both Workers have the same `STRAVA_CLIENT_SECRET` and the webhook subscription exists (`GET push_subscriptions` shows it).
- [ ] A test run with a second Strava account works end to end: connect, finish a workout, it appears on Strava with the
      watch's distance, calories, heart rate and route; disconnect; removing the app on strava.com then makes
      `strava_account` lose the row (`bunx wrangler d1 execute joyorogo-database-live-dzul-unqpixpckdt72ct3 --remote --command "select count(*) from strava_account"`).
- [ ] Privacy policy (<https://fit.joyorogo.com/privasi>) mentions Strava: what is sent (workout file), that tokens are kept
      on JoyoRogo's server until you disconnect or revoke, and how to remove them.
- [ ] Screenshots (Android, light theme is fine), each showing the app's own name:
  1. Settings → Strava, not connected: the official **Connect with Strava** button and the "Compatible with Strava" logo.
  2. Strava's authorization page with the `activity:write` permission ("Upload your activities").
  3. Settings → Strava, connected: the connected state, the description switch (off) and **Disconnect Strava**.
  4. A workout screen with **Send to Strava** (before) and **View on Strava** in orange (after).
  5. The same activity on strava.com or in the Strava app, with the watch's distance, calories and heart rate.
  6. (If asked) the webhook: the `push_subscriptions` view output, or the Worker log of a deauthorization event.
- [ ] State in the form: free for every user, JoyoFit uses the single scope `activity:write` (JoyoRogo adds
      `read,activity:read_all` for its own import), uploads only to the wearer's own account, no Strava data is read,
      stored, shown to others, or used for analytics or AI by JoyoFit, and tokens are deleted on disconnect and on
      deauthorization.

## 5. Troubleshooting

- `redirect_uri invalid` on Strava's page: the callback domain in the Strava application is not `joyorogo.com` (section 2),
  or the build still uses the old cloud host.
- Connecting in JoyoFit ends with `reason=scope_missing`: the athlete unchecked "upload your activities" on Strava's page.
  A grant nobody else uses is revoked; one that JoyoRogo uses is left as it was.
- Connecting in JoyoFit ends with `reason=strava_unreachable` or the status call answers 502: JoyoRogo's Worker
  (`api.joyorogo.com`) is not answering `/internal/joyofit/strava/*`; check that both Workers have the same `STRAVA_CLIENT_SECRET`
  (JoyoRogo answers 401 on a different one, 503 on none).
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

## 6. Tests

- `bun test ./src/` (also `bun run test`): `src/features/strava/fitEncoder.test.ts` (CRC, header, every field type, buffer
  growth) and `activityFile.test.ts` (the file built from workouts, decoded back with Garmin's `@garmin/fitsdk`, a devDependency
  used only by the tests: totals, record count, positions, heart rate, distance scaling, full-span samples, sport mapping,
  duplicate detection, upload form).
- `cd server && bun run test`: `server/test/strava.test.ts` (signed state, authorize URL with the granted scope, code hand-off
  and the error reasons, status and token mapping, disconnect, webhook validation and forwarding; JoyoRogo's grant API is
  faked in `test/helpers.ts`). The grant logic itself is tested in the joyorogo repo, `packages/api/src/lib/strava-grant.test.ts`.
