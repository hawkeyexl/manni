#!/usr/bin/env bash
# term-tbx-1x1: build the demo repository and capture every real byte the
# video replays. Run from anywhere after `npm run build` at the repo root:
#   bash media/capture-tbx/capture.sh
# Input is test/fixtures/term/readers/tbx/tbx-basic-v3.tbx, copied unchanged
# as glossary.tbx: two concept entries, English and German.
set -euo pipefail
cd "$(dirname "$0")/.."
C="$(pwd)/capture-tbx"
S=scratch-tbx
rm -rf "$S" && mkdir -p "$S"
cp ../test/fixtures/term/readers/tbx/tbx-basic-v3.tbx "$S/glossary.tbx"

cd "$S"
# Its own repository, so config discovery stops here and never reaches manni's
# own manni.config.yaml.
git init -q -b main
git config user.name "Sam Rivera"
git config user.email sam@example.com
git add -A
GIT_AUTHOR_DATE=2026-10-17T10:00:00Z GIT_COMMITTER_DATE=2026-10-17T10:00:00Z git commit -qm "docs: termbase from the translators"

# T is `manni` as typed in the video: the built CLI, told stdout/stderr are a TTY.
T=(node -r ../capture/tty.cjs ../../dist/cli.js)
ms() { date +%s%3N; }
run() { # name, then the command
  local name=$1; shift
  local a b rc=0
  a=$(ms); "$@" > "$C/$name.ans" 2>&1 || rc=$?; b=$(ms)
  echo "$rc" > "$C/$name.exit"
  echo "$name ${rc} $((b - a))ms" >> "$C/latency.txt"
}

: > "$C/latency.txt"
grep -E '<(conceptEntry|langSec|term)[ >]' glossary.tbx > "$C/grep-tbx.txt"
run list "${T[@]}" term list glossary.tbx
run get "${T[@]}" term get PAL glossary.tbx
run write-tbx3 "${T[@]}" term write glossary.tbx -f tbx3 -o build/glossary.tbx
run list-build "${T[@]}" term list build/glossary.tbx
cmp glossary.tbx build/glossary.tbx > "$C/cmp.txt" 2>&1; echo $? > "$C/cmp.exit"
run write-inplace "${T[@]}" term write glossary.tbx
git status --porcelain glossary.tbx > "$C/status-after-write.txt"
run check "${T[@]}" term check glossary.tbx

# Three timing runs on the same repository, reset between runs.
for i in 1 2 3; do
  git reset -q --hard && git clean -fdq
  a=$(ms); "${T[@]}" term list glossary.tbx > /dev/null 2>&1; b=$(ms)
  "${T[@]}" term get PAL glossary.tbx > /dev/null 2>&1; c=$(ms)
  "${T[@]}" term write glossary.tbx -f tbx3 -o build/glossary.tbx > /dev/null 2>&1; d=$(ms)
  "${T[@]}" term write glossary.tbx > /dev/null 2>&1; e=$(ms)
  "${T[@]}" term check glossary.tbx > /dev/null 2>&1; f=$(ms)
  echo "timing$i list $((b - a))ms get $((c - b))ms write-tbx3 $((d - c))ms write-inplace $((e - d))ms check $((f - e))ms" >> "$C/latency.txt"
done
git reset -q --hard && git clean -fdq
cat "$C/latency.txt"
