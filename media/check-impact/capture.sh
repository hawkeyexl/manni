#!/usr/bin/env bash
# check-impact-1x1: capture every real byte the video replays.
# Run from the repo root after `npm run build`:
#   bash media/check-impact/capture.sh
#
# The demo repository is media/scratch-check-impact/ (gitignored by
# media/scratch-*/): a clone of this repository at 9caf1313, the commit that
# holds the feature. A clone keeps the whole history, so every citation's
# commit-sha resolves. One commit is added on top. It rewords line 2 of the
# doc comment above resolveSchemaSet in src/meta/core/resolve-schema.ts.
# Six citations pin a range holding that line, three of them on pages that
# serve journey m1. Nothing else changes.
#
# jq is jq 1.6 in WSL (Ubuntu-22.04); Git Bash on this machine has none. The
# jq beat runs as one real pipe inside WSL, `node.exe … | jq …`, so jq reads
# the bytes manni writes to a pipe.
set -euo pipefail
cd "$(dirname "$0")/../.."
REPO="$(pwd)"
C="$REPO/media/check-impact"
DEMO="$REPO/media/scratch-check-impact"
BASE=9caf1313b5382362f92ff80dec8c2c6df07d0e1e
CLI="$REPO/dist/cli.js"

case "$DEMO" in */media/scratch-check-impact) ;; *) echo "refusing: $DEMO" >&2; exit 2 ;; esac
rm -rf "$DEMO"
git clone -q --no-hardlinks "$REPO" "$DEMO"
cd "$DEMO"
git checkout -q --detach "$BASE"
sed -i '2s/.*/ * Resolve the schema *set* for one file, in precedence order:/' src/meta/core/resolve-schema.ts
git -c color.ui=always diff > "$C/diff.ans"
GIT_AUTHOR_DATE=2026-10-23T09:00:00Z GIT_COMMITTER_DATE=2026-10-23T09:00:00Z \
  git -c user.name=demo -c user.email=demo@example.com commit -qam "refactor(meta): reword the precedence comment"

# The tty shim tells the CLI stdout/stderr are a terminal, so the colour a
# terminal receives is the colour the capture holds. Nothing else changes.
# The two piped beats run without it, as a pipe would.
TTY="$REPO/media/capture/tty.cjs"

: > "$C/latency.txt"
stamp() { date +%s%N; }
note() { echo "$1 exit $2 $(( ($4 - $3) / 1000000 )) ms" >> "$C/latency.txt"; }

# Beat 1 (and 2): the red run.
t0=$(stamp); rc=0
node -r "$TTY" "$CLI" check > "$C/check-red.ans" 2>&1 || rc=$?
t1=$(stamp); echo "$rc" > "$C/check-red.exit"; note check-red "$rc" "$t0" "$t1"

# Beat 3: the JSON roll-up, filtered to m1's pages, as one pipe in WSL.
WDEMO="/mnt/c${DEMO#/c}"
t0=$(stamp)
wsl.exe -d Ubuntu-22.04 -e bash -c "cd '$WDEMO' && node.exe ../../dist/cli.js check -f json | jq -r '.impact[] | select(.id == \"m1\") | .pages[]'; echo \"\${PIPESTATUS[*]}\" >&2" \
  > "$C/jq.txt" 2> "$C/jq.pipestatus"
t1=$(stamp); note jq "$(tr -d '\r\n' < "$C/jq.pipestatus")" "$t0" "$t1"

# Beat 4: re-mint the six pins at HEAD (cite's own guidance line says to),
# then the rerun.
t0=$(stamp); rc=0
{ node "$CLI" cite update --accept | tail -n 1; } > "$C/accept.ans" 2>&1 || rc=$?
t1=$(stamp); echo "$rc" > "$C/accept.exit"; note accept "$rc" "$t0" "$t1"

t0=$(stamp); rc=0
node -r "$TTY" "$CLI" check > "$C/check-green.ans" 2>&1 || rc=$?
t1=$(stamp); echo "$rc" > "$C/check-green.exit"; note check-green "$rc" "$t0" "$t1"

node "$CLI" --version > "$C/version.txt"
git -C "$REPO" rev-parse HEAD > "$C/build-commit.txt"
cat "$C/latency.txt"
