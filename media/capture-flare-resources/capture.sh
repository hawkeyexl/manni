#!/usr/bin/env bash
# flare-resources-1x1: build the demo repository and capture every real byte the
# video replays. Run from anywhere after `npm run build` at the repo root:
#   bash media/capture-flare-resources/capture.sh
#
# Staging, disclosed: the input is test/fixtures/flare/widget/ as committed at
# HEAD, a tiny MadCap Flare project, copied unchanged through `git archive` so no
# untracked cache from a test run comes along. Its glossary,
# Project/Glossaries/Glossary.flglo, holds three entries (widget, node version
# and a print-only one). Its meta tag set, Project/Advanced/Topics.flmeta, lists
# Status as Draft, Reviewed or Published. Install.htm sets Status to Reviewed and
# marks "widget" with a glossaryTerm for Glossary.Term0. Its manni.config.yaml
# names the glossary in a collection and the meta tag set as a schema.
#
# The two failures are real edits, made with sed on screen: the marker's
# glossTerm becomes Glossary.Term9, then Status becomes Reviewd. The repository
# is reset between the capture and each timing run.
#
# The repository is media/scratch-flare-resources/ (gitignored, its own git), so
# config discovery stops there and never reaches manni's own manni.config.yaml.
#
# Every manni command runs with C:\flare as its working directory: a directory
# junction to media/scratch-flare-resources/, as in flare-targets, so any path
# manni prints stays short. The junction is removed at the end; it holds no
# files of its own. cwd.cjs starts the CLI in C:\flare as spelled.
set -euo pipefail
cd "$(dirname "$0")/.."
MEDIA="$(pwd)"
C="$MEDIA/capture-flare-resources"
S="$MEDIA/scratch-flare-resources"
J=/c/flare
JW='C:\flare'

rm -rf "$S" && mkdir -p "$S"
git -C "$MEDIA/.." archive HEAD test/fixtures/flare/widget | tar -x -C "$S" --strip-components=4
cd "$S"
git init -q -b main
git config user.name "Sam Rivera"
git config user.email sam@example.com
git config core.autocrlf false
git add -A
GIT_AUTHOR_DATE=2026-10-28T09:00:00Z GIT_COMMITTER_DATE=2026-10-28T09:00:00Z \
  git commit -qm "docs: widget help, from Flare"

if [ -e "$J" ]; then echo "capture.sh: $JW exists; remove it and rerun" >&2; exit 2; fi
MSYS2_ARG_CONV_EXCL='*' cmd /c mklink /J "$JW" "$(cygpath -w "$S")" > /dev/null
trap 'MSYS2_ARG_CONV_EXCL="*" cmd /c rmdir "$JW"' EXIT
cd "$J"

# T is `manni` as typed in the video: the built CLI, told stdout/stderr are a TTY.
export DEMO_CWD="$JW"
T=(node -r "$C/cwd.cjs" -r "$MEDIA/capture/tty.cjs" "$MEDIA/../dist/cli.js")
ms() { date +%s%3N; }
run() { # name, then the command
  local name=$1; shift
  local a b rc=0
  a=$(ms); "$@" > "$C/$name.ans" 2>&1 || rc=$?; b=$(ms)
  echo "$rc" > "$C/$name.exit"
  echo "$name ${rc} $((b - a))ms" >> "$C/latency.txt"
}

# The two edits, typed on screen exactly as here.
GLOSS='s/Term0/Term9/'
STATUS='s/Reviewed/Reviewd/'
# P is `manni` on the left of a pipe: no TTY preload, because a pipe is not a
# terminal. manni prints without colour there, and the capture keeps that.
P=(node -r "$C/cwd.cjs" "$MEDIA/../dist/cli.js")

: > "$C/latency.txt"
rm -f "$C"/*.ans "$C"/*.exit "$C"/grep-*.txt
# Beat 1: the glossary is a termbase. Typed as `manni term check; echo $?`.
run term "${T[@]}" term check
# Beat 2: the topic's glossary marker, as written and with its line number, then
# read as its concepts.
grep -no '<MadCap:glossaryTerm[^>]*>' Content/Topics/Install.htm > "$C/grep-marker.txt"
run get "${T[@]}" meta get concepts Content/Topics/Install.htm
# Beat 3: point the marker at an entry that does not exist. Typed as
# `sed -i 's/Term0/Term9/' Content/Topics/Install.htm` (no output), then
# `manni term check | grep -A1 Install.htm; echo ${PIPESTATUS[0]}`. The pipe keeps
# the page's finding (its file:line header and the error row) and drops the two
# unused-term notices on the glossary and the four explanation rows under each
# finding: whole, the output is 17 lines up to 146 characters wide.
# PIPESTATUS prints term check's own exit code, not grep's. term.full.ans is the
# whole uncoloured output, kept as the record of what grep dropped.
sed -i "$GLOSS" Content/Topics/Install.htm
a=$(ms); rc=0
"${P[@]}" term check > "$C/undefined.full.ans" 2>&1 || rc=$?
b=$(ms)
echo "$rc" > "$C/undefined.exit"
echo "undefined ${rc} $((b - a))ms" >> "$C/latency.txt"
grep -A1 Install.htm "$C/undefined.full.ans" > "$C/undefined.ans" || true
# Beat 4: misspell the Status value. Typed as `sed -i 's/Reviewed/Reviewd/' ...`,
# then `manni meta validate Content/Topics/Install.htm; echo $?`. Naming the page
# keeps Configure.htm's unrelated missing description out of the frame.
sed -i "$STATUS" Content/Topics/Install.htm
run validate "${T[@]}" meta validate Content/Topics/Install.htm

# Three timing runs on the same repository, reset between runs.
for i in 1 2 3; do
  git reset -q --hard && git clean -fdxq
  a=$(ms); "${T[@]}" term check > /dev/null 2>&1; b=$(ms)
  "${T[@]}" meta get concepts Content/Topics/Install.htm > /dev/null 2>&1; c=$(ms)
  sed -i "$GLOSS" Content/Topics/Install.htm
  d=$(ms); "${P[@]}" term check > /dev/null 2>&1 || true; e=$(ms)
  sed -i "$STATUS" Content/Topics/Install.htm
  f=$(ms); "${T[@]}" meta validate Content/Topics/Install.htm > /dev/null 2>&1 || true; g=$(ms)
  echo "timing$i term $((b - a))ms get $((c - b))ms undefined $((e - d))ms validate $((g - f))ms" >> "$C/latency.txt"
done
git reset -q --hard && git clean -fdxq
cat "$C/latency.txt"
