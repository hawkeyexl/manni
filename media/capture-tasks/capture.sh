#!/usr/bin/env bash
# test-tasks-1x1: capture every real byte the video replays that can still be
# re-run. Run from the repo root after `npm run build`, with Claude Code on
# PATH and signed in:
#   bash media/capture-tasks/capture.sh          # every beat
#   bash media/capture-tasks/capture.sh red      # beat 1 alone, in a second
#   bash media/capture-tasks/capture.sh t1       # beat 5 alone, minutes
#
# Beats 1 and 5 come from this script, colour on. Beats 2 to 4 replay
# raw/df1.*.txt, the dogfood run that found the docs bug, byte for byte. That
# run cannot be re-shot: the fix page and Theo's persona record were both
# corrected after it, so a re-run now reads the fixed docs and has nothing to
# flag. It was captured to files, stdout and stderr apart, so it has no colour.
#
# Beat 1's demo repository is media/scratch-tasks/ (gitignored), a copy of
# test/test/fixtures/tasks/red-pr, the same workspace the synthetic user is
# handed. It gets its own `git init`, as Theo's clone would have, because
# manni honours .gitignore and the outer repo ignores media/scratch-*. Beat 5
# runs from the repo root, as the journey record names its entry page and
# workspace by repo path.
#
# The journey run takes minutes: under a minute of Claude Code, then the judge.
# The composition shortens that wait, so it is captured under bash's `time`,
# and its `real` line is in frame, unedited.
set -euo pipefail
cd "$(dirname "$0")/../.."
REPO="$(pwd)"
C="$REPO/media/capture-tasks"
DEMO="$REPO/media/scratch-tasks"

rm -rf "$DEMO"
mkdir -p "$DEMO"
cp -r test/test/fixtures/tasks/red-pr/. "$DEMO/"
git -C "$DEMO" init -q -b main
ONLY="${1:-all}"

# T is `manni` as typed in the video: the built CLI, told stdout/stderr are a
# TTY, so the colour and the progress stream a terminal receives are what the
# capture holds.
T=(node -r "$REPO/media/capture/tty.cjs" "$REPO/dist/cli.js")

run() { # name, then the command; `time` output is part of the capture
  local name=$1; shift
  local rc=0
  { time "$@" ; } > "$C/$name.ans" 2>&1 || rc=$?
  echo "$rc" > "$C/$name.exit"
  touch "$C/latency.txt"
  sed -i "/^$name /d" "$C/latency.txt" # one line per beat, the latest take
  echo "$name exit $rc $(grep -a '^real' "$C/$name.ans" | tr '\t' ' ')" >> "$C/latency.txt"
}

# Beat 1: the red check, in Theo's repository.
[[ $ONLY == all || $ONLY == red ]] && (cd "$DEMO" && run red "${T[@]}" meta validate)

# Beat 5: the task, kept as golden journey t1. The run's workspace lives under
# os.tmpdir(). When the synthetic user's commands name it, the progress lines
# print that path. TEMP/TMP/TMPDIR point at a neutral C:\tmp, which keeps the
# machine's user name out of the frame.
if [[ $ONLY == all || $ONLY == t1 ]]; then
  mkdir -p /c/tmp
  ( export TEMP='C:\tmp' TMP='C:\tmp' TMPDIR='C:\tmp'
    run t1 "${T[@]}" test tasks --journey t1 --provider claude-cli )
fi
cat "$C/latency.txt"
