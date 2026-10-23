#!/usr/bin/env bash
# plugin-metadata-1x1: capture every real byte the video replays.
# Run from media/ after `npm run build` at the repo root:
#   bash plugin-metadata/capture/capture.sh
#
# The demo repository is staged at media/scratch-plugin-metadata/ from the
# sources in plugin-metadata/repo/, with its own `git init`. .gitignore covers
# media/scratch-*/. The plugin's data directory is media/scratch-pd/, also
# ignored, so nothing is written into this repository's docs or graph output.
# manni resolves through node_modules/@hawkeyexl/manni, a junction to the
# checkout root, so the hooks find this branch's build the way an install would.
set -euo pipefail
cd "$(dirname "$0")/../.."
C="$(pwd)/plugin-metadata/capture"
SRC="$(pwd)/plugin-metadata/repo"
ROOT="$(cd .. && pwd -W)"
DEMO="$(pwd)/scratch-plugin-metadata"
DATA="$(pwd -W)/scratch-pd"

if [ -e "$DEMO" ] && [ ! -e "$DEMO/read-page.mjs" ]; then
  echo "refusing to overwrite $DEMO (not a staged plugin-metadata demo)" >&2
  exit 2
fi
rm -rf "$DEMO" scratch-pd
cp -r "$SRC" "$DEMO"
cd "$DEMO"
git init -q
echo node_modules/ >> .git/info/exclude
git add -A
git -c user.name=demo -c user.email=demo@example.com commit -qm "docs: limits and install"
mkdir -p node_modules/@hawkeyexl
node -e 'require("fs").symlinkSync(process.argv[1], "node_modules/@hawkeyexl/manni", "junction")' "$ROOT"

CLI="node_modules/@hawkeyexl/manni/dist/cli.js"
T=(node -r "$ROOT/media/capture/tty.cjs" "$CLI")
export MANNI_PAGE_HOOK="$ROOT/plugin/manni/hooks/page-metadata.mjs"
export MANNI_GRAPH_SERVER="$ROOT/plugin/manni/hooks/graph-server.mjs"
export CLAUDE_PLUGIN_DATA="$DATA"
export DEMO_SESSION="demo-$(date +%s)"   # a fresh session: the hook has given this one nothing yet
ms() { date +%s%3N; }
run() { # name, then the command; stdout and stderr interleave as a terminal shows them
  local name=$1; shift
  local a b rc=0
  a=$(ms); "$@" > "$C/$name.ans" 2>&1 || rc=$?; b=$(ms)
  echo "$rc" > "$C/$name.exit"
  echo "$name ${rc} $((b - a))ms" >> "$C/latency.txt"
}

: > "$C/latency.txt"
node "$CLI" --version > "$C/version.txt"
git -C "$ROOT" rev-parse --short HEAD > "$C/build-commit.txt"

# Beat 1: the page, and the sidecar the agent never sees.
run head head -4 docs/limits.md
run sidecar cat docs/limits.meta.yaml
# Beat 2: the flag.
run get "${T[@]}" meta get --all-fields --no-derived docs/limits.md
# Beats 3 and 4: the plugin's Read hook, the real script.
run read1 node read-page.mjs docs/limits.md
run read2 node read-page.mjs docs/limits.md
sed -i 's/platform-docs/docs-team/' docs/limits.meta.yaml
run read3 node read-page.mjs docs/limits.md
git checkout -q docs/limits.meta.yaml

# Beat 5: the plugin's MCP server, started as a client would. Each line is
# stamped with when it arrived, so the replay keeps the real timing.
a=$(ms)
node mcp-call.mjs lookup "What is the fetch timeout?" 2>&1 | while IFS= read -r line; do
  printf '%s\t%s\n' "$(( $(ms) - a ))" "$line"
done > "$C/graph.times"
cut -f2- "$C/graph.times" > "$C/graph.ans"
git status --short > "$C/status-after.txt"

# Timing runs, for the composition's latency constants.
for i in 1 2 3; do
  a=$(ms); "${T[@]}" meta get --all-fields --no-derived docs/limits.md >/dev/null 2>&1 || true; b=$(ms)
  rm -rf "$(node -p 'require("os").tmpdir()')/manni/reads"
  node read-page.mjs docs/limits.md >/dev/null 2>&1 || true; c=$(ms)
  echo "timing$i get $((b - a))ms read $((c - b))ms" >> "$C/latency.txt"
done
cat "$C/latency.txt"
