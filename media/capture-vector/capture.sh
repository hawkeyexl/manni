#!/usr/bin/env bash
# vector-1x1: capture every real byte the video replays.
# Run from the repo root after `npm run build`, with the optional peer
# @huggingface/transformers resolvable and its model already downloaded
# (one warm-up `manni vector build` off camera; see the script):
#   bash media/capture-vector/capture.sh
#
# The material is this repository: its own manni.config.yaml, its `site`
# collection, its baseIri. Output goes to media/scratch-vector/out (gitignored
# as media/scratch-*), so nothing under docs/public changes.
set -euo pipefail
cd "$(dirname "$0")/../.."
REPO="$(pwd)"
C="$REPO/media/capture-vector"
OUT=media/scratch-vector/out

# T is `manni` as typed in the video: the built CLI, told stdout/stderr are a TTY.
T=(node -r "$REPO/media/capture/tty.cjs" "$REPO/dist/cli.js")
ms() { date +%s%3N; }
run() { # name, then the command
  local name=$1; shift
  local a b rc=0
  a=$(ms); "$@" > "$C/$name.ans" 2>&1 || rc=$?; b=$(ms)
  echo "$rc" > "$C/$name.exit"
  echo "$name ${rc} $((b - a))ms" >> "$C/latency.txt"
}
runTimed() { # same, with bash's `time`, whose output is part of the capture
  local name=$1; shift
  local a b rc=0
  a=$(ms); { time "$@" ; } > "$C/$name.ans" 2>&1 || rc=$?; b=$(ms)
  echo "$rc" > "$C/$name.exit"
  echo "$name ${rc} $((b - a))ms" >> "$C/latency.txt"
}

: > "$C/latency.txt"
rm -rf "$OUT"

# Beat 1: the old third step, as it answers on this branch.
run embed "${T[@]}" graph embed

# Beat 2: one command from pages to vectors. --no-cache, so every vector is
# computed on camera rather than read back from .manni/vector/cache.
runTimed build "${T[@]}" vector build --collection site --no-cache -o "$OUT"
ls -1 "$OUT" > "$C/ls.txt"   # typed as `ls -1`: the bytes a pipe gets are one per line
ls -1 "$OUT"

# Beat 3: a question, ranked by meaning alone.
run search "${T[@]}" vector search "pin a sentence to its source" --limit 3 -i "$OUT"

# Three more search timings, for the composition's latency constant.
for i in 1 2 3; do
  a=$(ms); "${T[@]}" vector search "pin a sentence to its source" --limit 3 -i "$OUT" >/dev/null 2>&1 || true; b=$(ms)
  echo "timing$i search $((b - a))ms" >> "$C/latency.txt"
done
git rev-parse --short HEAD > "$C/build-commit.txt"
node --version > "$C/version.txt"
cat "$C/latency.txt"
