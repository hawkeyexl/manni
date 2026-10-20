#!/usr/bin/env bash
# findings-say-what-to-do-1x1: capture every real byte the video replays.
# Run from the repo root after `npm run build`:
#   bash media/capture-findings/capture.sh
#
# The demo repository is media/scratch-findings/ (gitignored). It holds
# byte-for-byte copies of two test fixtures, so the pages on screen are the
# pages the test suite runs:
#   dcmi-bad-date.md       <- test/fixtures/vocabulary/dcmi-bad-date.md
#   pages/source-changed.md, src/changed.ts <- test/fixtures/cite/
# It is its own git repository, committed once, because `manni cite check`
# resolves a pin's source through git. In the repo the cite tests use a fake
# git client; a real repository is what a reader would have.
#
# Beat 1 runs the published 4.13.0 release through npx. The scratch repo has
# @hawkeyexl/manni@4.13.0 installed locally (--no-save), so npx runs that exact
# release and never reaches a globally linked development checkout.
set -euo pipefail
cd "$(dirname "$0")/../.."
REPO="$(pwd)"
C="$REPO/media/capture-findings"
DEMO="$REPO/media/scratch-findings"

rm -rf "$DEMO"
mkdir -p "$DEMO/pages" "$DEMO/src"
cp test/fixtures/vocabulary/dcmi-bad-date.md "$DEMO/"
cp test/fixtures/cite/pages/source-changed.md "$DEMO/pages/"
cp test/fixtures/cite/src/changed.ts "$DEMO/src/"
cd "$DEMO"
git init -q
git add .
git -c user.name=demo -c user.email=demo@example.com commit -qm fixtures
# A package.json of its own, or npm installs into the enclosing repo.
echo '{"private":true}' > package.json
npm i --no-save --silent --no-audit --no-fund @hawkeyexl/manni@4.13.0 >/dev/null

# The tty shim tells the CLI stdout/stderr are a terminal, so the colour a
# terminal receives is the colour the capture holds. Nothing else changes.
TTY="$REPO/media/capture/tty.cjs"
T=(node -r "$TTY" "$REPO/dist/cli.js")

: > "$C/latency.txt"
run() { # name, then the command
  local name=$1; shift
  local rc=0 t0 t1
  t0=$(date +%s%N)
  "$@" > "$C/$name.ans" 2>&1 || rc=$?
  t1=$(date +%s%N)
  echo "$rc" > "$C/$name.exit"
  echo "$name exit $rc $(( (t1 - t0) / 1000000 )) ms" >> "$C/latency.txt"
}

cat dcmi-bad-date.md > "$C/cat-page.txt"
# NODE_OPTIONS reaches the node npx starts; it wants a Windows path here.
NODE_OPTIONS="-r $(cygpath -m "$C/tty-manni.cjs")" run before npx -y @hawkeyexl/manni@4.13.0 meta validate dcmi-bad-date.md -s dcmi:elements:1.1 --no-config
run after "${T[@]}" meta validate dcmi-bad-date.md -s dcmi:elements:1.1 --no-config
run show "${T[@]}" meta schemas show manni:core:1.0.0 -f markdown
run cite "${T[@]}" cite check pages/source-changed.md
"${T[@]}" --version > "$C/version.txt"
cat "$C/latency.txt"
