#!/usr/bin/env bash
# strategy-check-1x1: capture every real byte the video replays.
# Run from the repo root after `npm run build`:
#   bash media/capture-strategy/capture.sh
#
# The demo repository is media/scratch-strategy/ (gitignored by
# media/scratch-*/). It is a byte-for-byte copy of test/fixtures/strategy/clean/:
# one audience (docs-engineers), one persona (maya), two journeys (m1, m2) and
# two pages, docs/ci.md and docs/guide.md, with its manni.config.yaml declaring
# a `site` collection for docs/ and a `strategy` collection for the records.
#
# Only docs/guide.md starts different. guide.before.md (beside this script)
# lists journey m1 under personas: and names no journeys. That copy is
# committed as the scratch repo's one commit. The fix is the clean fixture's
# own docs/guide.md copied back over it, so the "after" set is the fixture the
# test suite runs, and `git diff` shows exactly that edit.
set -euo pipefail
cd "$(dirname "$0")/../.."
REPO="$(pwd)"
C="$REPO/media/capture-strategy"
DEMO="$REPO/media/scratch-strategy"

rm -rf "$DEMO"
mkdir -p "$DEMO"
cp -r test/fixtures/strategy/clean/. "$DEMO/"
cp "$C/guide.before.md" "$DEMO/docs/guide.md"
cd "$DEMO"
git init -q
git add .
git -c user.name=demo -c user.email=demo@example.com commit -qm "strategy set"

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

# Beat 1: the problem, as files.
cat strategy/journeys/m1.md > "$C/cat-journey.txt"
cat docs/guide.md > "$C/cat-page.txt"

# Beat 2: the check, before the fix.
run check-before "${T[@]}" strategy check

# Beat 3: the fix is the clean fixture's page; git shows the edit, then the
# check runs again. `git diff` colours its output on a terminal; the capture
# is a file, so color.ui=always stands in for the terminal, as tty.cjs does
# for manni.
cp "$REPO/test/fixtures/strategy/clean/docs/guide.md" docs/guide.md
run diff git -c color.ui=always diff docs/guide.md
run check-after "${T[@]}" strategy check

# Beat 4: the tree.
run list "${T[@]}" strategy list

"${T[@]}" --version > "$C/version.txt"
cat "$C/latency.txt"
