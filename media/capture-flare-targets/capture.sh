#!/usr/bin/env bash
# flare-targets-1x1: build the demo repository and capture every real byte the
# video replays. Run from anywhere after `npm run build` at the repo root:
#   bash media/capture-flare-targets/capture.sh
#
# Staging, disclosed: the input is test/fixtures/flare/widget/ as committed at
# HEAD, a tiny MadCap Flare project, copied unchanged through `git archive` so no
# untracked cache from a test run comes along. Install.htm uses the
# General.ProductVersion variable (4.2 in General.flvar, 4.3 in HTML5.fltar), a
# snippetBlock to BeforeYouStart.flsnp, a paragraph conditioned
# Default.PrintOnly (HTML5 excludes it) and an index keyword marker. Its
# manni.config.yaml sets tools.flare.target: HTML5. Nothing else is arranged.
#
# The repository is media/scratch-flare-targets/ (gitignored, its own git), so
# config discovery stops there and never reaches manni's own manni.config.yaml.
#
# Every manni command runs with C:\flare as its working directory: a directory
# junction to media/scratch-flare-targets/. `graph build` and `graph export`
# print the absolute path they wrote, and the checkout's real path would be a
# 150-character line naming the user's home. The junction is removed at the end;
# it holds no files of its own. cwd.cjs starts the CLI in C:\flare as spelled,
# as a terminal opened there would.
set -euo pipefail
cd "$(dirname "$0")/.."
MEDIA="$(pwd)"
C="$MEDIA/capture-flare-targets"
S="$MEDIA/scratch-flare-targets"
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

: > "$C/latency.txt"
rm -f "$C"/*.ans "$C"/*.exit "$C"/grep-*.txt
# Beat 1: the topic as written, and the variable's two definitions.
grep -E 'variable|snippet|PrintOnly' Content/Topics/Install.htm > "$C/grep-topic.txt"
grep -r ProductVersion Project > "$C/grep-version.txt"
# Beat 2: lint finds the project and the target, and sees the snippet's heading.
run lint "${T[@]}" lint structure Content/Topics/Install.htm -t tgdp:how-to:1.6 --explain
# Beat 3: typed as `manni graph build && manni graph export chunks -o out`. Two
# runs, one after the other, so build.ans then export.ans is what the terminal shows.
run build "${T[@]}" graph build
run export "${T[@]}" graph export chunks -o out
grep -m1 -o "Version [0-9.]* needs Node 20" out/*.jsonl > "$C/grep-passage.txt"
grep -rc "prints only" out > "$C/grep-printonly.txt" || true
# Beat 4: the index keyword marker, read as the keywords field.
grep keyword Content/Topics/Install.htm > "$C/grep-keyword.txt"
run get "${T[@]}" meta get keywords Content/Topics/Install.htm

# Three timing runs on the same repository, reset between runs.
for i in 1 2 3; do
  git reset -q --hard && git clean -fdxq
  a=$(ms); "${T[@]}" lint structure Content/Topics/Install.htm -t tgdp:how-to:1.6 --explain > /dev/null 2>&1; b=$(ms)
  "${T[@]}" graph build > /dev/null 2>&1; c=$(ms)
  "${T[@]}" graph export chunks -o out > /dev/null 2>&1; d=$(ms)
  "${T[@]}" meta get keywords Content/Topics/Install.htm > /dev/null 2>&1; e=$(ms)
  echo "timing$i lint $((b - a))ms build $((c - b))ms export $((d - c))ms get $((e - d))ms" >> "$C/latency.txt"
done
git reset -q --hard && git clean -fdxq
cat "$C/latency.txt"
