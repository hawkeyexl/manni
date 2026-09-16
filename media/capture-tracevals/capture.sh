#!/usr/bin/env bash
# tracevals-1x1: capture every real byte the video replays.
# Run from media/ after `npm run build` at the repo root:
#   bash capture-tracevals/capture.sh
#
# The demo repository is staged at $DEMO (default ~/demo) rather than under
# media/, and the reason is a line-length one. `manni tracevals run` prints the
# resolved absolute path of the trace, so a demo repo inside
# .claude/worktrees/<branch>/media/ puts a 140-character unbreakable token in
# the first line of every report. design.md forbids splitting a token across a
# line break, so the path has to be short enough to fit. ~/demo makes the
# header 57 characters. The directory is disposable: make-demo.mjs rebuilds it.
set -euo pipefail
cd "$(dirname "$0")/.."
C="$(pwd)/capture-tracevals"
REPO="$(cd .. && pwd)"
DEMO="${DEMO:-$HOME/demo}"

if [ -e "$DEMO" ] && [ ! -e "$DEMO/session-1.jsonl" ]; then
  echo "refusing to overwrite $DEMO (not a staged tracevals demo); set DEMO=" >&2
  exit 2
fi
rm -rf "$DEMO"
node "$C/make-demo.mjs" "$DEMO"

cd "$DEMO"
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

: > "$C/latency.txt"
cat CLAUDE.md > "$C/cat-claude-md.txt"
run run1 "${T[@]}" tracevals run session-1.jsonl --deterministic-only
run run2 "${T[@]}" tracevals run session-2.jsonl --deterministic-only

# Three timing runs, for the composition's latency constants.
for i in 1 2 3; do
  a=$(ms); "${T[@]}" tracevals run session-1.jsonl --deterministic-only >/dev/null 2>&1 || true; b=$(ms)
  "${T[@]}" tracevals run session-2.jsonl --deterministic-only >/dev/null 2>&1 || true; c=$(ms)
  echo "timing$i run1 $((b - a))ms run2 $((c - b))ms" >> "$C/latency.txt"
done
cat "$C/latency.txt"
