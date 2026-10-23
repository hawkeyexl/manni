#!/usr/bin/env bash
# strategy-steps-1x1: capture every real byte the video replays.
# Run from the repo root after `npm run build`:
#   bash media/capture-strategy-steps/capture.sh
#
# The demo repository is media/scratch-strategy-steps/ (gitignored by
# media/scratch-*/). It is a copy of test/fixtures/strategy/steps/ with one
# file trimmed: strategy/journeys/m1.md is m1.before.md (beside this script),
# which keeps four of the fixture's nine steps. Two are served, docs/reference.md
# is a page that does not name m1, and /site/tutorial/ is planned with
# exists: false. The fixture's other files are copied unchanged. The copy gets
# its own git repository, because the outer repo's .gitignore would otherwise
# hide every file from manni, and because beat 3 shows the edit with git diff.
#
# The fix is reference.after.md copied over docs/reference.md. It gains the
# same audiences:, personas: and journeys: as the fixture's docs/guide.md. All
# three are needed: a page naming m1 without m1's persona and audience is a
# missing-parent warning.
set -euo pipefail
cd "$(dirname "$0")/../.."
REPO="$(pwd)"
C="$REPO/media/capture-strategy-steps"
DEMO="$REPO/media/scratch-strategy-steps"

rm -rf "$DEMO"
mkdir -p "$DEMO"
cp -r test/fixtures/strategy/steps/. "$DEMO/"
cp "$C/m1.before.md" "$DEMO/strategy/journeys/m1.md"
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

# Beat 1: the journey's steps, as written.
cat strategy/journeys/m1.md > "$C/cat-journey.txt"

# Beat 2: the check, before the fix.
run check-before "${T[@]}" strategy check

# Beat 3: the page joins the journey. git colours its output on a terminal;
# the capture is a file, so color.ui=always stands in for the terminal.
cp "$C/reference.after.md" docs/reference.md
run diff git -c color.ui=always diff docs/reference.md

# Beat 4: coverage, in order.
run get "${T[@]}" strategy get m1

# Not shown; recorded so the script can say what the check prints after the fix.
run check-after "${T[@]}" strategy check

"${T[@]}" --version > "$C/version.txt"
cat "$C/latency.txt"
