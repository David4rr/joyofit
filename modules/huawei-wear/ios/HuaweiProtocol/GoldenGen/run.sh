#!/usr/bin/env bash
# Regenerates Tests/HuaweiProtocolTests/Fixtures/*.json from the vendored Gadgetbridge Java (the code the Android app runs).
# Compiles modules/huawei-wear/android/src/main/java/nodomain/** on a plain JDK with three tiny Android stubs, then runs every
# Golden*.java main in src/. Needs: JDK 17+ (JAVA_HOME or ~/jdk17), slf4j-api and org.json jars (found in ~/.gradle or ~/.m2, or
# set SLF4J_JAR / JSON_JAR).
#   ./run.sh               regenerate all fixtures
#   ./run.sh GoldenPrimitives   regenerate one
set -euo pipefail
cd "$(dirname "$0")"
HERE=$PWD
PKG=$(cd .. && pwd)
JAVA_SRC=${JAVA_SRC:-$(cd "$PKG/../../android/src/main/java" && pwd)}
OUT=${GOLDEN_OUT:-${TMPDIR:-/tmp}/huawei-golden-build}
FIXTURES=$PKG/Tests/HuaweiProtocolTests/Fixtures

JAVA_BIN=${JAVA_HOME:+$JAVA_HOME/bin}
[ -z "$JAVA_BIN" ] && [ -x "$HOME/jdk17/bin/javac" ] && JAVA_BIN=$HOME/jdk17/bin
JAVAC=${JAVA_BIN:+$JAVA_BIN/}javac
JAVA=${JAVA_BIN:+$JAVA_BIN/}java
find_jar() { find "$HOME/.gradle" "$HOME/.m2" -name "$1" 2>/dev/null | head -1 || true; }
SLF4J_JAR=${SLF4J_JAR:-$(find_jar 'slf4j-api-2*.jar')}
JSON_JAR=${JSON_JAR:-$(find_jar 'json-2025*.jar')}
[ -f "$SLF4J_JAR" ] && [ -f "$JSON_JAR" ] || { echo "need slf4j-api-2.x and org.json jars (SLF4J_JAR, JSON_JAR)" >&2; exit 1; }

rm -rf "$OUT" && mkdir -p "$OUT/classes" "$FIXTURES"
CP="$SLF4J_JAR:$JSON_JAR"
"$JAVAC" -nowarn -d "$OUT/classes" -cp "$CP" \
  $(find "$HERE/stubs" -name '*.java') \
  $(find "$JAVA_SRC/nodomain" -name '*.java') \
  $(find "$HERE/src" -name '*.java') 2>"$OUT/javac.log" || { cat "$OUT/javac.log" >&2; exit 1; }

if [ $# -gt 0 ]; then mains=("$@"); else mains=($(cd "$HERE/src" && ls Golden*.java | grep -v '^GoldenSupport' | sed 's/\.java$//')); fi
for m in "${mains[@]}"; do
  echo "== $m"
  "$JAVA" -cp "$OUT/classes:$CP" "$m" "$FIXTURES"
done
