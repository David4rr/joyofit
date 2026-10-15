#!/usr/bin/env bash
# Rebuilds Sources/HuaweiWearLogic: symlinks to every module source (ios/*.swift) and to the HuaweiProtocol sources, so that the logic
# tests compile them as ONE Swift module, exactly like the CocoaPods pod does. Run after adding or removing a file in ios/.
set -euo pipefail
cd "$(dirname "$0")/Sources/HuaweiWearLogic"
find . -maxdepth 1 -type l -delete
for f in ../../../*.swift; do ln -s "$f" "$(basename "$f")"; done
ln -s ../../../HuaweiProtocol/Sources/HuaweiProtocol HuaweiProtocol
ls -l | tail -n +2 | awk '{print $9, $10, $11}'
