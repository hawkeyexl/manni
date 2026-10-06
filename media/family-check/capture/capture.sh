#!/usr/bin/env bash
# family-check-1x1: capture every real byte the video replays.
# Run from media/ after `npm run build` at the repo root:
#   bash family-check/capture/capture.sh
#
# The demo repository is staged at media/scratch-family-check/ from the
# sources in family-check/repo/, with its own `git init`. .gitignore covers
# media/scratch-*/, so it never reaches this repository. `manni check` prints
# paths relative to the repo it runs in, so staging it here costs no width.
set -euo pipefail
cd "$(dirname "$0")/../.."
C="$(pwd)/family-check/capture"
SRC="$(pwd)/family-check/repo"
REPO="$(cd .. && pwd)"
DEMO="$(pwd)/scratch-family-check"

if [ -e "$DEMO" ] && [ ! -e "$DEMO/hook-edit.json" ]; then
  echo "refusing to overwrite $DEMO (not a staged family-check demo)" >&2
  exit 2
fi
rm -rf "$DEMO"
cp -r "$SRC" "$DEMO"
cd "$DEMO"
git init -q
git add -A
git -c user.name=demo -c user.email=demo@example.com commit -qm "docs: limits page"

# T is `manni` as typed in the video: the built CLI, told stdout/stderr are a TTY.
T=(node -r "$REPO/media/capture/tty.cjs" "$REPO/dist/cli.js")
ms() { date +%s%3N; }
run() { # name, then the command; stdout and stderr interleave as a terminal shows them
  local name=$1; shift
  local a b rc=0
  a=$(ms); "$@" > "$C/$name.ans" 2>&1 || rc=$?; b=$(ms)
  echo "$rc" > "$C/$name.exit"
  echo "$name ${rc} $((b - a))ms" >> "$C/latency.txt"
}
hook() { "${T[@]}" check < hook-edit.json; }

: > "$C/latency.txt"
node "$REPO/dist/cli.js" --version > "$C/version.txt"
git -C "$REPO" rev-parse --short HEAD > "$C/build-commit.txt"

run status "${T[@]}" status
run check1 "${T[@]}" check
cat hook-edit.json > "$C/cat-hook-edit.txt"
run hook hook
# The fix, as typed in beat 4.
sed -i '2a description: Timeouts and retries.' docs/limits.md
head -4 docs/limits.md > "$C/fixed-head.txt"
run check2 "${T[@]}" check

# Three timing runs per command, for the composition's latency constants.
git checkout -q docs/limits.md
for i in 1 2 3; do
  a=$(ms); "${T[@]}" status >/dev/null 2>&1 || true; b=$(ms)
  "${T[@]}" check >/dev/null 2>&1 || true; c=$(ms)
  hook >/dev/null 2>&1 || true; d=$(ms)
  echo "timing$i status $((b - a))ms check $((c - b))ms hook $((d - c))ms" >> "$C/latency.txt"
done
git checkout -q docs/limits.md
cat "$C/latency.txt"
