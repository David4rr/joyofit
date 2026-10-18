#!/usr/bin/env bash
# Prints the JoyoFit invite lists (Strava and iPhone TestFlight) from the production Worker.
# Usage: scripts/waitlist.sh [strava|iphone] [--json]
# The bearer token is read from ~/.config/joyofit/waitlist-admin-token (the Worker secret WAITLIST_ADMIN_TOKEN).
set -euo pipefail

kind=""
json=0
for arg in "$@"; do
  case "$arg" in
    strava|iphone) kind="$arg" ;;
    --json) json=1 ;;
    *) echo "usage: $0 [strava|iphone] [--json]" >&2; exit 2 ;;
  esac
done

token_file="${WAITLIST_TOKEN_FILE:-$HOME/.config/joyofit/waitlist-admin-token}"
[ -r "$token_file" ] || { echo "missing $token_file" >&2; exit 1; }
base="${WAITLIST_API:-https://api.fit.joyorogo.com}"

response=$(curl -fsS -H "Authorization: Bearer $(tr -d '\n' < "$token_file")" "$base/v1/waitlist${kind:+?kind=$kind}")
if [ "$json" = 1 ]; then
  printf '%s\n' "$response"
else
  printf '%s' "$response" | jq -r '(.entries[] | [.kind, .status, (.createdAt / 1000 | strftime("%Y-%m-%d %H:%M")), .email, (.stravaProfile // "-"), (.watchModel // "-"), (.note // "-")] | @tsv), "total: \(.count)"' | column -t -s $'\t'
fi
