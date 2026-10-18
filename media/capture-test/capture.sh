#!/usr/bin/env bash
# test-run-1x1: capture every real byte the video replays.
# Run from the repo root after `npm run build`, with Doc Detective on PATH:
#   bash media/capture-test/capture.sh
#
# The demo repository is media/scratch-test/ (gitignored). It holds one file,
# a byte-for-byte copy of test/test/fixtures/fail.md, so the page on screen is
# the page the test suite runs. The script recopies it on every run, because
# beat 4 edits it in place.
#
# `--no-progress` is typed in the video, not hidden. On a terminal,
# `manni test run` streams Doc Detective's own log to stderr, and that log is
# thousands of lines here. `--no-progress` is what a person types to get the
# report alone, so it is what the frame shows.
#
# Each run takes about 8 s, almost all of it Doc Detective starting up. The
# composition shortens that wait, so every run is captured under bash's
# `time`, and its `real` line is in frame, unedited.
set -euo pipefail
cd "$(dirname "$0")/../.."
REPO="$(pwd)"
C="$REPO/media/capture-test"
DEMO="$REPO/media/scratch-test"

rm -rf "$DEMO"
mkdir -p "$DEMO"
cp test/test/fixtures/fail.md "$DEMO/fail.md"
cd "$DEMO"

# T is `manni` as typed in the video: the built CLI, told stdout/stderr are a
# TTY, so the colour a terminal receives is the colour the capture holds.
T=(node -r "$REPO/media/capture/tty.cjs" "$REPO/dist/cli.js")

: > "$C/latency.txt"
run() { # name, then the command; `time` output is part of the capture
  local name=$1; shift
  local rc=0
  { time "$@" ; } > "$C/$name.ans" 2>&1 || rc=$?
  echo "$rc" > "$C/$name.exit"
  echo "$name exit $rc $(grep -a '^real' "$C/$name.ans" | tr '\t' ' ')" >> "$C/latency.txt"
}

cat fail.md > "$C/cat-fail.txt"
run fail "${T[@]}" test run fail.md --no-progress
run github "${T[@]}" test run fail.md -f github --no-progress
sed -i 's/exit 1/exit 0/' fail.md
cat fail.md > "$C/cat-fixed.txt"
run pass "${T[@]}" test run fail.md --no-progress
cat "$C/latency.txt"
