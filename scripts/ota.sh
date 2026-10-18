#!/usr/bin/env bash
# Publish an over-the-air JS update (EAS Update, expo-updates) for JoyoFit. Policy and rollback: docs/ota.md.
#
#   scripts/ota.sh "Fix the workout list header on small phones"     production, android + ios
#   scripts/ota.sh --platform ios "Copy fix"                         one platform only
#   scripts/ota.sh --channel preview "Try the new notice"            preview channel (needs a binary built for it)
#
# Steps: typecheck + unit tests, then a release `expo export` (bundle sanity checks), then `eas update` with that
# bundle, signed with the OTA code-signing key. Prints the update group id. Nothing is uploaded to a store.
#
# JS and asset changes only. A change that touches native code (modules/, plugins/), native config (app.json,
# permissions, entitlements), a native dependency or the lockfile changes the fingerprint runtimeVersion: the update
# would then target a runtimeVersion that no installed binary has, so nobody receives it. Ship a new binary for those
# (docs/ota.md "When OTA is not enough").
#
# Needs: bun, jq, an EAS login (`bunx eas-cli login`, owner dzulfikar08) or EXPO_TOKEN, and the private key
# ~/.config/joyofit/ota/private-key.pem (OTA_PRIVATE_KEY_PATH overrides; the CI workflow writes it from a secret).
set -euo pipefail
cd "$(dirname "$0")/.."
ROOT=$PWD
EAS=(bunx "eas-cli@${EAS_CLI_VERSION:-25.1.1}")
KEY=${OTA_PRIVATE_KEY_PATH:-$HOME/.config/joyofit/ota/private-key.pem}

usage() { sed -n '2,8p' "$0" >&2; exit 2; }

channel=production platform=all message=
while [ $# -gt 0 ]; do
  case $1 in
    --channel) channel=${2:?--channel needs production or preview}; shift ;;
    --platform) platform=${2:?--platform needs android, ios or all}; shift ;;
    -h|--help) usage ;;
    -*) echo "unknown option: $1" >&2; usage ;;
    *) message=${message:+$message }$1 ;;
  esac
  shift
done
[ -n "$message" ] || { echo "an update message is required" >&2; usage; }
case $channel in production|preview) ;; *) echo "channel must be production or preview" >&2; exit 2 ;; esac
case $platform in android|ios|all) ;; *) echo "platform must be android, ios or all" >&2; exit 2 ;; esac
[ -f "$KEY" ] || { echo "no OTA signing key at $KEY (docs/ota.md: Signing)" >&2; exit 1; }
command -v jq > /dev/null || { echo "jq is required" >&2; exit 1; }

step() { printf '\n== %s ==\n' "$*"; }
fail() { echo "ota: $*" >&2; exit 1; }

step "1. checks"
bunx tsc --noEmit
bun test ./src/

# The store builds bake nothing in from the environment (cloud and API URLs live in app.json extra). A stray
# EXPO_PUBLIC_* variable on this machine must not leak into the published bundle.
unset EXPO_PUBLIC_JOYOROGO_URL EXPO_PUBLIC_JOYOFIT_CLOUD_URL EXPO_PUBLIC_FB_APP_ID
export NODE_ENV=production

publish() {
  local p=$1 out=$ROOT/dist/ota-$1 json
  json=$(mktemp)

  step "2. $p: export"
  rm -rf "$out"
  bunx expo export --platform "$p" --output-dir "$out" > /dev/null
  local bundle
  bundle=$(find "$out/_expo/static/js/$p" \( -name '*.hbc' -o -name '*.js' \) | head -n 1)
  [ -f "$bundle" ] || fail "$p: no JS bundle in $out"
  # Metro with a bad cache can bundle without the app's routes and say nothing; the API default is in app code.
  LC_ALL=C grep -aqF 'https://api.joyorogo.com' "$bundle" || fail "$p: bundle holds no app code"
  echo "   bundle $(basename "$bundle") $(stat -c %s "$bundle") bytes, app code present"

  local runtime
  runtime=$(bunx expo-updates runtimeversion:resolve --platform "$p" | tail -n 1 | jq -r .runtimeVersion)
  [ -n "$runtime" ] && [ "$runtime" != null ] || fail "$p: runtimeVersion did not resolve"

  step "3. $p: eas update --channel $channel (runtimeVersion $runtime)"
  "${EAS[@]}" update --channel "$channel" --platform "$p" --message "$message" \
    --skip-bundler --input-dir "$out" --private-key-path "$KEY" --environment "$channel" \
    --non-interactive --json > "$json"
  local group
  group=$(jq -r '[.[]? | .group] | map(select(. != null)) | .[0] // empty' "$json")
  [ -n "$group" ] || { cat "$json" >&2; fail "$p: eas update printed no update group id"; }
  rm -f "$json"
  RESULTS+=("$p  channel=$channel  runtimeVersion=$runtime  group=$group")
}

RESULTS=()
if [ "$platform" = all ]; then
  publish android
  publish ios
else
  publish "$platform"
fi

step "published"
printf '%s\n' "${RESULTS[@]}"
echo "view:     bunx eas-cli update:view <group>   (dashboard: https://expo.dev/accounts/dzulfikar08/projects/joyofit/updates)"
echo "rollback: bunx eas-cli update:rollback --channel $channel   (docs/ota.md)"
