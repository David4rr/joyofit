# TestFlight feedback

Testers send feedback from the TestFlight app (Send Beta Feedback, or a screenshot then Share Beta Feedback) and report a crash right after it happens. It lands in App Store Connect, TestFlight tab, Feedback: Screenshots and Crashes. `scripts/testflight-feedback.ts` pulls it through the App Store Connect API and files it in Atur.

## What Apple does and does not give us

- There is no reply channel: neither TestFlight nor App Store Connect can answer a piece of feedback (checked in Apple's "View tester feedback" and "Beta tester feedback" help pages, 2026-10-21). Only a tester's **email** lets us write back, outside TestFlight.
- A tester invited **by email** shows their address in the feedback. A tester who joined through a **public link** (JoyoFit's testers do, `inviteType: PUBLIC_LINK`) is "Anonymous" unless they typed an email on that one submission; the address is then attached to that submission only (the same tester can send three items with it and others without). So a reply is possible only when the email is there, and never by looking the tester up.
- Crash reports stay downloadable for 120 days. Screenshot URLs from the API carry an `expirationDate` (2026-10-28 for the items sent 10-16 to 10-19), which is why the script downloads them.
- App Store Connect can also push each new feedback to a web server (Manage webhooks): an alternative to polling if a public endpoint is ever wanted.
- Crash logs are symbolicated only when the build's symbols reached Apple. Until 2026-10-21 `uploadSymbols` was off, so reports came back with bare `0x... + offset` frames. The export now uploads symbols and the **Release iOS** run keeps the dSYMs as the artifact `joyofit-ios-dsyms-<run number>` (30 days). To symbolicate by hand: `llvm-symbolizer --obj=<dSYM>/Contents/Resources/DWARF/JoyoFit --demangle 0x<vmaddr + offset>` (vmaddr is 0x100000000 for the main binary; the offset is the number after `+` in the frame).

## The script

```
bun scripts/testflight-feedback.ts --app 6823324343 --name joyofit  --repo dzulfikar08/joyofit --atur --project <Atur project id>
bun scripts/testflight-feedback.ts --app 6823222101 --name joyorogo --repo dzulfikar08/joyorogo --atur --project <Atur project id>
```

JoyoFit is ASC app `6823324343`, JoyoRogo `6823222101`. Both are tracked in the Atur project JRG (`b00a31c6-cf01-400d-a0a5-4d8349e5c0df`, workspace `joyodigitama`).

- Saves under `--out` (default `./tf-feedback/<name>`): `submissions.json` (the raw API objects), `items.json` (flattened), `screenshots/<id>-<n>.jpg`, `crashlogs/<id>.crash`, `state.json`.
- **New** means an id not in `state.json` (ASC ids are opaque, not ordered). The first run has no state: without `--since` it is a baseline (everything recorded as seen, nothing filed); with `--since <ISO date>` (or `TF_FEEDBACK_SINCE`) items created at or after it are new. `--all` ignores the state.
- Prints a summary per new item (tester, build and its commit, device, comment, crash head or screenshot paths). `--repo` maps `CFBundleVersion` (`YYYYMMDDHHMM` UTC) to the **Release iOS** run that made it, hence its commit; builds made locally have none.
- `--atur` files one Atur issue per new item, state Todo, titled `[TestFlight] <app>: <comment> (<submission id>)`. The id in the title is searched before creating, so losing the state file never files twice. `--dry` prints instead of writing anything.
- Auth. ASC: `ASC_KEY_ID` (default `BUU2CPKLGM`), `ASC_ISSUER_ID` (default the team issuer) and the key as `ASC_KEY_P8` (PEM), `ASC_KEY_P8_BASE64`, or `ASC_KEY_PATH` (default `~/Downloads/AuthKey_<id>.p8`). Atur: `ATUR_API_KEY`, else `ATUR_API_KEY_FILE`, else `~/.config/atur/crew-api-key`; `ATUR_BASE_URL` defaults to `https://app.diatur.com`.
- Tests: `bun test scripts/testflight-feedback.test.ts` (new-item selection, build to commit, issue titles).

## Running it daily

**Local (works today).** A user timer on the machine that has the keys:

```
# ~/.config/systemd/user/testflight-feedback.service
[Service]
Type=oneshot
WorkingDirectory=%h/Documents/JoyoDigitama/watch-fit
ExecStart=/usr/bin/env bun scripts/testflight-feedback.ts --app 6823324343 --name joyofit  --out %h/.local/state/testflight-feedback/joyofit  --repo dzulfikar08/joyofit  --atur --project b00a31c6-cf01-400d-a0a5-4d8349e5c0df
ExecStart=/usr/bin/env bun scripts/testflight-feedback.ts --app 6823222101 --name joyorogo --out %h/.local/state/testflight-feedback/joyorogo --repo dzulfikar08/joyorogo --atur --project b00a31c6-cf01-400d-a0a5-4d8349e5c0df

# ~/.config/systemd/user/testflight-feedback.timer
[Timer]
OnCalendar=*-*-* 08:00:00
Persistent=true
[Install]
WantedBy=timers.target
```

`systemctl --user enable --now testflight-feedback.timer`. `gh` must be logged in for `--repo`. The state files live in the `--out` dirs, so nothing is filed twice.

**GitHub Actions (not installed: secrets are missing).** `gh secret list` on `dzulfikar08/joyofit` shows only `AGNI_API_KEY`. The ASC secrets (`ASC_KEY_ID`, `ASC_ISSUER_ID`, `ASC_KEY_BASE64`) exist only in the `release` environment, which requires the owner's approval for every run and is limited to master and `v*`: a scheduled job bound to it would wait for a click every day. There is no Atur secret at all. To run it from Actions, add a second environment without a reviewer and these four secrets, then add the workflow below:

```
gh api -X PUT repos/dzulfikar08/joyofit/environments/feedback
gh secret set ASC_KEY_ID      --env feedback -R dzulfikar08/joyofit --body BUU2CPKLGM
gh secret set ASC_ISSUER_ID   --env feedback -R dzulfikar08/joyofit --body 9e34111d-e39f-4122-9000-6eb4628fe9b9
base64 -w0 ~/Downloads/AuthKey_BUU2CPKLGM.p8 | gh secret set ASC_KEY_BASE64 --env feedback -R dzulfikar08/joyofit
gh secret set ATUR_API_KEY    --env feedback -R dzulfikar08/joyofit < ~/.config/atur/crew-api-key
```

Prefer a key made for this job (App Store Connect, Users and Access, Integrations: role Developer or App Manager, which can read feedback) over the build key, so it can be revoked on its own.

```yaml
# .github/workflows/testflight-feedback.yml
name: TestFlight feedback
on:
  schedule: [{ cron: "0 1 * * *" }]   # 08:00 WIB
  workflow_dispatch:
permissions:
  contents: read
  actions: read          # gh run list for the build -> commit map
concurrency: testflight-feedback
jobs:
  pull:
    runs-on: ubuntu-latest
    environment: feedback
    env:
      GH_TOKEN: ${{ github.token }}
      ASC_KEY_ID: ${{ secrets.ASC_KEY_ID }}
      ASC_ISSUER_ID: ${{ secrets.ASC_ISSUER_ID }}
      ASC_KEY_P8_BASE64: ${{ secrets.ASC_KEY_BASE64 }}
      ATUR_API_KEY: ${{ secrets.ATUR_API_KEY }}
      TF_FEEDBACK_SINCE: "2026-10-22T00:00:00Z"   # first run only (no cached state): items from this moment count as new
    steps:
      - uses: actions/checkout@v5
      - uses: oven-sh/setup-bun@v2
      - uses: actions/cache@v5
        with:
          path: tf-feedback
          key: tf-feedback-${{ github.run_id }}
          restore-keys: tf-feedback-
      - run: bun scripts/testflight-feedback.ts --app 6823324343 --name joyofit --repo ${{ github.repository }} --atur --project b00a31c6-cf01-400d-a0a5-4d8349e5c0df
      - uses: actions/upload-artifact@v5
        with: { name: tf-feedback, path: tf-feedback, retention-days: 14 }
```

Pin the actions to commit SHAs like the other workflows before enabling it. The cached `state.json` is what makes a day's run see only new items; if the cache is ever evicted the Atur title search still prevents duplicates for items inside `TF_FEEDBACK_SINCE`.
