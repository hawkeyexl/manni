#!/usr/bin/env bash
# flare-topics-1x1: build the demo repository and capture every real byte the
# video replays. Run from anywhere after `npm run build` at the repo root:
#   bash media/capture-flare/capture.sh
#
# Staging, disclosed: the input is test/fixtures/flare/widget/, a tiny MadCap
# Flare project, copied unchanged. Configure.htm has the empty <title> Flare
# writes as standard, and Install.htm cross-references it as Configur.htm, a
# misspelling. Nothing else is arranged.
#
# The repository is media/scratch-flare-topics/ (gitignored, its own git), so
# config discovery stops there and never reaches manni's own manni.config.yaml.
#
# Every manni command runs with C:\flare as its working directory: a directory
# junction to media/scratch-flare-topics/. `graph build` prints the absolute path
# it wrote, and the checkout's real path would be a 150-character line naming the
# user's home. The junction is removed at the end; it holds no files of its own.
# cwd.cjs starts the CLI in C:\flare as spelled, as a terminal opened there would.
set -euo pipefail
cd "$(dirname "$0")/.."
MEDIA="$(pwd)"
C="$MEDIA/capture-flare"
S="$MEDIA/scratch-flare-topics"
J=/c/flare
JW='C:\flare'

rm -rf "$S" && mkdir -p "$S"
cp -r "$MEDIA/../test/fixtures/flare/widget/." "$S/"
cd "$S"
git init -q -b main
git config user.name "Sam Rivera"
git config user.email sam@example.com
git config core.autocrlf false
git add -A
GIT_AUTHOR_DATE=2026-10-27T09:00:00Z GIT_COMMITTER_DATE=2026-10-27T09:00:00Z \
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
Q="UPDATE docs SET description = 'How to set the widget''s options.' WHERE _path = 'Content/Topics/Configure.htm'"

: > "$C/latency.txt"
rm -f "$C"/*.ans "$C"/*.exit
# Beat 1: the empty title and the misspelled cross-reference, as Flare wrote them.
grep -E '<title>|<h1>' Content/Topics/Configure.htm > "$C/grep-title.txt"
grep xref Content/Topics/Install.htm > "$C/grep-xref.txt"
# Beat 2: the empty title reads as the h1; validate fails only description.
run get "${T[@]}" meta get title Content/Topics/Configure.htm
run validate "${T[@]}" meta validate
# Beat 3: a deterministic write, and the diff it made. git colours a terminal's diff.
run query "${T[@]}" meta query "$Q"
git -c color.ui=always diff -U1 > "$C/diff.ans"
# Well-formed after the write: the topic still parses as XML.
node -e 'new (require(process.argv[2]).DOMParser)({onError:(l,m)=>{throw new Error(m)}}).parseFromString(require("fs").readFileSync(process.argv[1],"utf8").replace(/^﻿/,""),"text/xml");console.log("well-formed")' Content/Topics/Configure.htm "$MEDIA/../node_modules/@xmldom/xmldom" > "$C/wellformed.txt" 2>&1 || true
# Beat 4: the graph finds the broken MadCap:xref.
run build "${T[@]}" graph build
# Typed as `manni graph stats --check > stats.txt; echo $?`: the report goes to a
# file, so the exit code and the one finding fit the frame. stats.ans is that file.
run stats "${T[@]}" graph stats --check
cp "$C/stats.ans" stats.txt
grep -A1 "internal links" stats.txt > "$C/grep-stats.txt"

# Three timing runs on the same repository, reset between runs.
for i in 1 2 3; do
  git reset -q --hard && git clean -fdxq
  a=$(ms); "${T[@]}" meta get title Content/Topics/Configure.htm > /dev/null 2>&1; b=$(ms)
  "${T[@]}" meta validate > /dev/null 2>&1 || true; c=$(ms)
  "${T[@]}" meta query "$Q" > /dev/null 2>&1; d=$(ms)
  "${T[@]}" graph build > /dev/null 2>&1; e=$(ms)
  "${T[@]}" graph stats --check > /dev/null 2>&1 || true; f=$(ms)
  echo "timing$i get $((b - a))ms validate $((c - b))ms query $((d - c))ms build $((e - d))ms stats $((f - e))ms" >> "$C/latency.txt"
done
git reset -q --hard && git clean -fdxq
cat "$C/latency.txt"
