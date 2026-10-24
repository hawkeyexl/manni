#!/usr/bin/env bash
# persona-judge-1x1: capture every real byte the video replays.
# Run from the repo root after `npm run build`:
#   bash media/capture-personas/capture.sh
#
# stage.sh builds media/scratch-persona-evals/ from the personas fixture, with
# a cold judge cache. Each judged run below is one real llama-cpp call per ai
# eval, on this machine.
set -euo pipefail
cd "$(dirname "$0")/../.."
REPO="$(pwd)"
C="$REPO/media/capture-personas"
DEMO="$REPO/media/scratch-persona-evals"

bash "$C/stage.sh"
cd "$DEMO"

# The tty shim tells the CLI stdout/stderr are a terminal, so the colour a
# terminal receives is the colour the capture holds. Nothing else changes.
TTY="$REPO/media/capture/tty.cjs"
T=(node -r "$TTY" "$REPO/dist/cli.js")

# bash prints the elapsed time after each judged run, and the video keeps it
# in frame: the replay shortens that wait, so the real one stays on screen.
TIMEFORMAT=$'\nreal\t%3lR'

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
timed() { # as run, under bash's own `time`
  local name=$1; shift
  local rc=0 t0 t1
  t0=$(date +%s%N)
  { time "$@" ; } > "$C/$name.ans" 2>&1 || rc=$?
  t1=$(date +%s%N)
  echo "$rc" > "$C/$name.exit"
  echo "$name exit $rc $(( (t1 - t0) / 1000000 )) ms" >> "$C/latency.txt"
}

# Beat 1: the page, with one eval opted in.
cat docs/one-reader.md > "$C/cat-page.txt"

# Beat 2: the judged run, before the fix.
timed run-before "${T[@]}" docevals run docs/one-reader.md --ai-only

# Beat 3: the page speaks to Theo's pains; git shows the edit, then the run
# again. color.ui=always stands in for the terminal, as tty.cjs does for manni.
cp "$C/one-reader.after.md" docs/one-reader.md
run diff git -c color.ui=always diff docs/one-reader.md
timed run-after "${T[@]}" docevals run docs/one-reader.md --ai-only

"${T[@]}" --version > "$C/version.txt"
cat "$C/latency.txt"
