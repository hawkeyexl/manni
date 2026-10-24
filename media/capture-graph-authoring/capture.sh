#!/usr/bin/env bash
# graph-authoring-1x1: capture every real byte the video replays.
# Run from the repo root after `npm run build`:
#   bash media/capture-graph-authoring/capture.sh
#
# Everything runs against this repository itself, from the repo root, so the
# manni config, the collections and the 82 strategy records are the ones the
# docs ship with. The graphs land in .manni/graph/internal/ and
# .manni/graph/readers/, which .gitignore covers. The plugin's server publishes
# into its own data directory: with CLAUDE_PLUGIN_DATA unset, as here, that is
# <tmpdir>/manni/graph/<hash>, never beside graph.out.
#
# `manni` is `node -r media/capture/tty.cjs dist/cli.js` (stdout reads as a
# terminal, so colour is emitted where the CLI has any).
set -euo pipefail
cd "$(dirname "$0")/../.."
C="media/capture-graph-authoring"
D11=https://hawkeyexl.github.io/manni/id/strategy/journey/d11

manni() { node -r ./media/capture/tty.cjs dist/cli.js "$@"; }
ms() { date +%s%3N; }
run() { # name, then the command; stdout and stderr interleave as a terminal shows them
  local name=$1; shift
  local a b rc=0
  a=$(ms); "$@" > "$C/$name.ans" 2>&1 || rc=$?; b=$(ms)
  echo "$rc" > "$C/$name.exit"
  echo "$name ${rc} $((b - a))ms" >> "$C/latency.txt"
}
# bash's own `time`, in frame, so the real elapsed time is on screen.
timed() { time "$@"; }

: > "$C/latency.txt"
node dist/cli.js --version > "$C/version.txt"
git rev-parse --short HEAD > "$C/build-commit.txt"
rm -rf .manni/graph/internal .manni/graph/readers

# Beat 1: the default build types the records.
run internal timed manni graph publish -o .manni/graph/internal
# Beat 2: a journey's pages, walked backwards along dcterms:isPartOf.
run traverse manni graph traverse -g .manni/graph/internal/graph.ttl "$D11" --reverse --predicates dcterms:isPartOf
# Beat 3: the reader-only graph.
run readers timed manni graph publish --collection site --no-authoring -o .manni/graph/readers
run query manni graph query -g .manni/graph/readers/graph.ttl --predicate dcterms:created

# Beat 4: the plugin's own server script, as .mcp.json starts it. stdin is
# closed, so the stdio server ends once it is up, as when a client hangs up.
# Each line is stamped with when it arrived, so the replay keeps the real
# timing. Its data directory is cleared first, so the run publishes cold.
DATA=$(node --input-type=module -e "const m = await import('./plugin/manni/hooks/graph-server.mjs'); console.log(m.serverPlan('collections:', process.cwd(), process.env).args.at(-1))")
rm -rf "$DATA"
a=$(ms)
node plugin/manni/hooks/graph-server.mjs < /dev/null 2>&1 | while IFS= read -r line; do
  printf '%s\t%s\n' "$(( $(ms) - a ))" "$line"
done > "$C/server.times"
echo "${PIPESTATUS[0]}" > "$C/server.exit"
cut -f2- "$C/server.times" > "$C/server.ans"
echo "server $(cat "$C/server.exit") $(( $(ms) - a ))ms" >> "$C/latency.txt"
echo "$DATA" > "$C/server-data-dir.txt"
ls "$DATA" > "$C/server-data-files.txt"

# For the record: the default graph's created dates, which the reader graph drops.
manni graph query -g .manni/graph/internal/graph.ttl --predicate dcterms:created | tail -1 > "$C/internal-created.txt"
manni strategy get d11 > "$C/strategy-get-d11.txt"
git status --short > "$C/status-after.txt"
cat "$C/latency.txt"
