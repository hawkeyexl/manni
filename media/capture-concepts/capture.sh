#!/usr/bin/env bash
# concept-lifecycle-1x1: build the demo repository and capture every real byte the
# video replays. Run from anywhere after `npm run build` at the repo root:
#   bash media/capture-concepts/capture.sh
#
# Input is media/capture-concepts/docset/, staged by hand from two fixtures:
# test/fixtures/term/fill/basic/ (a term page, pages naming concepts it lacks)
# and test/graph/fixtures/sample-questions/ (pages that each ask one question,
# `top: 1`). Two pages name Upload, Retry and Quota in concepts:. Only Upload
# has a term page. limits.md asks a question its own text does not answer.
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
set -euo pipefail
cd "$(dirname "$0")/.."
MEDIA="$(pwd)"
C="$MEDIA/capture-concepts"
S="$MEDIA/scratch-concepts"
J=/c/concepts
JW='C:\concepts'

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
grep concepts: docs/*.md > "$C/grep-concepts.txt"
run check-before "${T[@]}" term check
run fill "${T[@]}" term fill --offline
git status --porcelain -uall > "$C/status-after-fill.txt"
cp docs/glossary/retry.md "$C/retry-stub.md"
run check-after "${T[@]}" term check
run build "${T[@]}" graph build
run graph-check "${T[@]}" graph check
grep -E 'skos:(ConceptScheme|hasTopConcept)' graph.ttl > "$C/scheme.txt"

# Three timing runs on the same repository, reset between runs.
for i in 1 2 3; do
  git reset -q --hard && git clean -fdq
  a=$(ms); "${T[@]}" term check > /dev/null 2>&1 || true; b=$(ms)
  "${T[@]}" term fill --offline > /dev/null 2>&1; c=$(ms)
  "${T[@]}" term check > /dev/null 2>&1 || true; d=$(ms)
  "${T[@]}" graph build > /dev/null 2>&1; e=$(ms)
  "${T[@]}" graph check > /dev/null 2>&1; f=$(ms)
  echo "timing$i check-before $((b - a))ms fill $((c - b))ms check-after $((d - c))ms build $((e - d))ms graph-check $((f - e))ms" >> "$C/latency.txt"
done
git reset -q --hard && git clean -fdq
cat "$C/latency.txt"
