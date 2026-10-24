#!/usr/bin/env bash
# plugin-records-1x1: capture every real byte the video replays.
# Run from the repo root after `npm run build`:
#   bash media/plugin-records/capture/capture.sh
#
# Everything runs against this repository's own pages and records, from the
# repo root, so the manni config, the collections and the strategy records are
# the ones the docs ship with. Nothing in the repository is written: the one
# file a beat writes is /tmp/reply.txt.
#
# `manni` is `node -r media/capture/tty.cjs dist/cli.js` (stdout reads as a
# terminal, so colour is emitted). `read-page` is media/plugin-metadata/repo/
# read-page.mjs: it hands the plugin's real hook, plugin/manni/hooks/
# page-metadata.mjs, the PostToolUse envelope Claude Code sends after a Read,
# and prints the additionalContext the hook returns. Inside the repo the hook's
# launcher runs this checkout's own dist/cli.js.
set -euo pipefail
cd "$(dirname "$0")/../../.."
ROOT="$(pwd -W)"
C="$ROOT/media/plugin-records/capture"
STALE=docs/src/content/docs/cite/ci/stale-windows.mdx
CLI_PAGE=docs/src/content/docs/cite/reference/cli.mdx

manni() { node -r "$ROOT/media/capture/tty.cjs" "$ROOT/dist/cli.js" "$@"; }
read-page() { node "$ROOT/media/plugin-metadata/repo/read-page.mjs" "$@"; }
export MANNI_PAGE_HOOK="$ROOT/plugin/manni/hooks/page-metadata.mjs"
export DEMO_SESSION="records-demo-$(date +%s)"   # a fresh session: the hook has given it nothing yet

ms() { date +%s%3N; }
run() { # name, then the command; stdout and stderr interleave as a terminal shows them
  local name=$1; shift
  local a b rc=0
  a=$(ms); "$@" > "$C/$name.ans" 2>&1 || rc=$?; b=$(ms)
  echo "$rc" > "$C/$name.exit"
  echo "$name ${rc} $((b - a))ms" >> "$C/latency.txt"
}

: > "$C/latency.txt"
node dist/cli.js --version > "$C/version.txt"
git rev-parse --short HEAD > "$C/build-commit.txt"

# Beat 1: the sidecar holds the ids, nothing more.
run head head -4 docs/src/content/docs/cite/ci/stale-windows.meta.yaml
# Beat 2: meta get names the records, with no new flag.
run get manni meta get personas "$STALE"
# Beat 3: the Read hook on that page. `cut -c -500` keeps each line to 500
# characters, so the page JSON is trimmed by a command the viewer sees typed.
stale_read() { read-page "$STALE" | cut -c -500; }
run read stale_read
# The same reply, whole, for the record.
DEMO_SESSION="$DEMO_SESSION-whole" read-page "$STALE" > "$C/read-whole.txt"
# Beat 4: the biggest page, 59,000+ characters of stored metadata.
big_read() { read-page "$CLI_PAGE" > /tmp/reply.txt; }
run big big_read
run wc wc -c /tmp/reply.txt
run tail tail -1 /tmp/reply.txt
# The size the reply would have had: every stored field, as the hook asks for them.
node dist/cli.js meta get --all-fields --no-derived -f json "$CLI_PAGE" 2>/dev/null \
  | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log("values JSON length", JSON.stringify(JSON.parse(s)[0].values).length))' \
  > "$C/big-values-length.txt"
git status --short > "$C/status-after.txt"

# Timing runs, for the composition's latency constants.
for i in 1 2 3; do
  a=$(ms); manni meta get personas "$STALE" >/dev/null 2>&1 || true; b=$(ms)
  DEMO_SESSION="timing-$i-$(date +%s%N)" read-page "$STALE" >/dev/null 2>&1 || true; c=$(ms)
  DEMO_SESSION="timing-big-$i-$(date +%s%N)" read-page "$CLI_PAGE" >/dev/null 2>&1 || true; d=$(ms)
  echo "timing$i get $((b - a))ms read $((c - b))ms big $((d - c))ms" >> "$C/latency.txt"
done
cat "$C/latency.txt"
