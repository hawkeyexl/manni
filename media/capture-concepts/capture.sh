#!/usr/bin/env bash
# concept-lifecycle-1x1: build the demo repository and capture every real byte the
# video replays. Run from anywhere after `npm run build` at the repo root:
#   bash media/capture-concepts/capture.sh
#
# Input is media/capture-concepts/docset/, staged by hand from two fixtures:
# test/fixtures/term/fill/basic/ (a term page, pages naming concepts it lacks)
# and test/graph/fixtures/sample-questions/ (pages that each ask one question,
# `top: 1`). Two pages name Upload, Retry and Quota in concepts:. Only Upload
# has a term page. retry.md asks a bare question. limits.md asks one a person
# has pinned to body line 2, with no integrity hash yet.
#
# The repository is media/scratch-concepts/ (gitignored, its own git), so config
# discovery stops there and never reaches manni's own manni.config.yaml.
#
# Every manni command runs with C:\concepts as its working directory: a directory
# junction to media/scratch-concepts/. `graph build` prints the absolute path it
# wrote, and the checkout's real path would be a 110-character line naming the
# user's home. The junction is removed at the end; it holds no files of its own.
# Git Bash hands a child the junction's resolved target as its working directory,
# so cwd.cjs starts the CLI in C:\concepts as spelled, as a terminal opened there
# would. It changes nothing else.
#
# Two models, on purpose. `term fill --offline` runs with INFERENCE_MODELS_DIR at
# an empty directory: the beat shows a machine with no model on disk, which is the
# stub path. `graph fill --offline` uses the docset's configured local model,
# granite-4.1-3b-q2, already downloaded here, so it pairs a question on CPU.
set -euo pipefail
cd "$(dirname "$0")/.."
MEDIA="$(pwd)"
C="$MEDIA/capture-concepts"
S="$MEDIA/scratch-concepts"
J=/c/concepts
JW='C:\concepts'
NOMODELS="$(mktemp -d)"

rm -rf "$S" && mkdir -p "$S"
cp -r "$C/docset/." "$S/"
cd "$S"
git init -q -b main
git config user.name "Sam Rivera"
git config user.email sam@example.com
git config core.autocrlf false
git add -A
GIT_AUTHOR_DATE=2026-10-18T09:00:00Z GIT_COMMITTER_DATE=2026-10-18T09:00:00Z \
  git commit -qm "docs: upload pages"

if [ -e "$J" ]; then echo "capture.sh: $JW exists; remove it and rerun" >&2; exit 2; fi
MSYS2_ARG_CONV_EXCL='*' cmd /c mklink /J "$JW" "$(cygpath -w "$S")" > /dev/null
trap 'MSYS2_ARG_CONV_EXCL="*" cmd /c rmdir "$JW"; rmdir "$NOMODELS"' EXIT
cd "$J"

# T is `manni` as typed in the video: the built CLI, told stdout/stderr are a TTY.
export DEMO_CWD="$JW"
T=(node -r "$C/cwd.cjs" -r "$MEDIA/capture/tty.cjs" "$MEDIA/../dist/cli.js")
# bash's `time`, printing only the wall clock: user and sys read 0 on Windows,
# because they do not count the node child.
TIMEFORMAT=$'\nreal\t%3lR'
ms() { date +%s%3N; }
run() { # name, then the command
  local name=$1; shift
  local a b rc=0
  a=$(ms); "$@" > "$C/$name.ans" 2>&1 || rc=$?; b=$(ms)
  echo "$rc" > "$C/$name.exit"
  echo "$name ${rc} $((b - a))ms" >> "$C/latency.txt"
}
nomodel() { INFERENCE_MODELS_DIR="$(cygpath -w "$NOMODELS")" "$@"; }
sedit() { sed -i 's/one gigabyte/two gigabytes/' docs/limits.md; }

: > "$C/latency.txt"
rm -f "$C"/*.ans "$C"/*.exit
# Beat 1: concepts named freely, and check fails on the undefined ones.
grep concepts: docs/*.md > "$C/grep-concepts.txt"
run check-before "${T[@]}" term check
# Beat 2: term fill offline, with no model on disk.
run fill nomodel "${T[@]}" term fill --offline
git status --porcelain -uall > "$C/status-after-fill.txt"
cp docs/glossary/retry.md "$C/retry-stub.md"
# Beat 3: what is left to write.
run check-after "${T[@]}" term check
# Beat 4: one concept scheme, then each question pinned to its answer.
run build "${T[@]}" graph build
grep -E 'skos:(ConceptScheme|hasTopConcept)' graph.ttl > "$C/scheme.txt"
a=$(ms); rc=0
{ time "${T[@]}" graph fill docs/*.md --fields sample-questions --offline; } > "$C/graph-fill.ans" 2>&1 || rc=$?
b=$(ms); echo "$rc" > "$C/graph-fill.exit"; echo "graph-fill ${rc} $((b - a))ms" >> "$C/latency.txt"
git diff -- docs/retry.md docs/limits.md > "$C/pins.diff"
# Beat 5: the answer changes under its pin.
sedit
tail -n 1 docs/limits.md > "$C/limits-after-edit.txt"
run graph-check "${T[@]}" graph check

# Three timing runs on the same repository, reset between runs. The fill cache
# lives in the repo and is cleaned with it, so every fill run is cold.
for i in 1 2 3; do
  git reset -q --hard && git clean -fdq
  a=$(ms); "${T[@]}" term check > /dev/null 2>&1 || true; b=$(ms)
  nomodel "${T[@]}" term fill --offline > /dev/null 2>&1; c=$(ms)
  "${T[@]}" term check > /dev/null 2>&1 || true; d=$(ms)
  "${T[@]}" graph build > /dev/null 2>&1; e=$(ms)
  "${T[@]}" graph fill docs/*.md --fields sample-questions --offline > /dev/null 2>&1; f=$(ms)
  sedit
  "${T[@]}" graph check > /dev/null 2>&1; g=$(ms)
  echo "timing$i check-before $((b - a))ms fill $((c - b))ms check-after $((d - c))ms build $((e - d))ms graph-fill $((f - e))ms graph-check $((g - f))ms" >> "$C/latency.txt"
done
git reset -q --hard && git clean -fdq
cat "$C/latency.txt"
