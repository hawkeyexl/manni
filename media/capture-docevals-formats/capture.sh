#!/usr/bin/env bash
# docevals-formats-1x1: build the demo repository and capture every real byte the
# video replays. Run from anywhere after `npm run build` at the repo root:
#   bash media/capture-docevals-formats/capture.sh
#
# Staging, disclosed: the input is test/docevals/fixtures/formats/ as committed
# at HEAD, a tiny MadCap Flare project, copied unchanged through `git archive`
# so no untracked cache from a test run comes along. Content/ holds four pages,
# concept.dita, guide.adoc, notes.rst and topic.htm, each with a TODO line. Each
# page has a {page}.meta.yaml manifest beside it declaring one tool:regex
# not-contains TODO eval, and manni.config.yaml names the four in a collection.
# Nothing is edited: the TODO lines are in the fixture as committed.
#
# The repository is media/scratch-docevals-formats/ (gitignored, its own git),
# so config discovery stops there and never reaches manni's own
# manni.config.yaml.
#
# Every command runs with C:\formats as its working directory: a directory
# junction to media/scratch-docevals-formats/, as in flare-resources, so any
# path manni prints stays short. The junction is removed at the end; it holds
# no files of its own. cwd.cjs starts the CLI in C:\formats as spelled.
set -euo pipefail
cd "$(dirname "$0")/.."
MEDIA="$(pwd)"
C="$MEDIA/capture-docevals-formats"
S="$MEDIA/scratch-docevals-formats"
J=/c/formats
JW='C:\formats'

rm -rf "$S" && mkdir -p "$S"
git -C "$MEDIA/.." archive HEAD test/docevals/fixtures/formats | tar -x -C "$S" --strip-components=4
cd "$S"
git init -q -b main
git config user.name "Sam Rivera"
git config user.email sam@example.com
git config core.autocrlf false
git add -A
GIT_AUTHOR_DATE=2026-10-28T09:00:00Z GIT_COMMITTER_DATE=2026-10-28T09:00:00Z \
  git commit -qm "docs: widget help in four formats"

if [ -e "$J" ]; then echo "capture.sh: $JW exists; remove it and rerun" >&2; exit 2; fi
MSYS2_ARG_CONV_EXCL='*' cmd /c mklink /J "$JW" "$(cygpath -w "$S")" > /dev/null
trap 'MSYS2_ARG_CONV_EXCL="*" cmd /c rmdir "$JW"' EXIT
cd "$J"

# T is `manni` as typed in the video: the built CLI, told stdout/stderr are a TTY.
export DEMO_CWD="$JW"
T=(node -r "$C/cwd.cjs" -r "$MEDIA/capture/tty.cjs" "$MEDIA/../dist/cli.js")
ms() { date +%s%3N; }
# The replay's column count for beat 1, 24 px (cols.mjs). On a terminal, ls lays its
# names out in columns to the terminal's width; -C -w is that layout, written to
# a file, and -T 0 pads with spaces where a terminal would draw tabs. Typed on
# screen as `ls Content`.
COLS=72

rm -f "$C"/*.ans "$C"/*.exit "$C"/*.txt
: > "$C/latency.txt"
# Beat 1: the four pages and their manifests, then the TODO line in each page.
ls -C -T 0 -w "$COLS" Content > "$C/ls.txt"
grep -n TODO Content/*.{dita,adoc,rst,htm} > "$C/grep-todo.txt"
# Beat 2: where the HTML page's eval lives. Typed as `cat Content/topic.meta.yaml`.
cat Content/topic.meta.yaml > "$C/manifest.txt"
# Beat 3: grade the four pages. Typed as
# `manni docevals run --deterministic-only; echo $?`. Shown whole, in colour.
a=$(ms); rc=0
"${T[@]}" docevals run --deterministic-only > "$C/run.ans" 2>&1 || rc=$?
b=$(ms)
echo "$rc" > "$C/run.exit"
echo "run ${rc} $((b - a))ms" >> "$C/latency.txt"

# Three timing runs on the same repository, reset between runs.
for i in 1 2 3; do
  git reset -q --hard && git clean -fdxq
  a=$(ms); "${T[@]}" docevals run --deterministic-only > /dev/null 2>&1 || true; b=$(ms)
  echo "timing$i run $((b - a))ms" >> "$C/latency.txt"
done
git reset -q --hard && git clean -fdxq
cat "$C/latency.txt"
