#!/usr/bin/env bash
# conformance-1x1: capture every real byte the video replays.
# Run from media/ after `npm run build` at the repo root:
#   bash conformance/capture/capture.sh
#
# The demo project is staged at media/scratch-conformance/ from the committed
# fixtures in test/tracevals/fixtures/conformance/ (the project, plus the
# breaks.jsonl trace). .gitignore covers media/scratch-*/, and nothing in
# test/ is touched. HOME and CLAUDE_CONFIG_DIR point at an empty scratch home,
# as the integration tests do, so no user's own CLAUDE.md is read. The
# fixture's manni.config.yaml sets `provider: mock`: extraction and judging
# run offline and deterministically, exactly as in CI.
set -euo pipefail
cd "$(dirname "$0")/../.."
C="$(pwd)/conformance/capture"
REPO="$(cd .. && pwd)"
FIX="$REPO/test/tracevals/fixtures/conformance"
DEMO="$(pwd)/scratch-conformance"
HOMEDIR="$(pwd)/scratch-conformance-home"

for d in "$DEMO" "$HOMEDIR"; do
  if [ -e "$d" ] && [ ! -e "$d/.conformance-demo" ]; then
    echo "refusing to overwrite $d (not a staged conformance demo)" >&2
    exit 2
  fi
done
rm -rf "$DEMO" "$HOMEDIR"
cp -r "$FIX/project" "$DEMO"
cp "$FIX/traces/breaks.jsonl" "$DEMO/breaks.jsonl"
mkdir -p "$HOMEDIR"
touch "$DEMO/.conformance-demo" "$HOMEDIR/.conformance-demo"
# The Stop envelope Claude Code writes to the hook's stdin, cut to the fields
# the hook reads. The session id is the trace's own.
cat > "$DEMO/stop.json" <<'JSON'
{
  "hook_event_name": "Stop",
  "session_id": "3b265d00-0000-4000-8000-000000000001",
  "transcript_path": "breaks.jsonl"
}
JSON
cd "$DEMO"
git init -q
git add -A
git -c user.name=demo -c user.email=demo@example.com commit -qm "demo project"

export HOME="$HOMEDIR" USERPROFILE="$HOMEDIR" CLAUDE_CONFIG_DIR="$HOMEDIR/.claude" MANNI_TRACEVALS_JUDGE=
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
hook() { "${T[@]}" check < stop.json; }
GREP='"command": "[^"]*"'

: > "$C/latency.txt"
node "$REPO/dist/cli.js" --version > "$C/version.txt"
git -C "$REPO" rev-parse --short HEAD > "$C/build-commit.txt"

cat CLAUDE.md > "$C/cat-claude-md.txt"
grep -o "$GREP" breaks.jsonl > "$C/grep-commands.txt"
# Cold: the first run extracts rules from the files that need it (mock).
run check "${T[@]}" tracevals check breaks.jsonl --project .
cat stop.json > "$C/cat-stop-json.txt"
# Warm, as in the video: the hook runs after the check, so extraction is cached.
run hook hook

# Three timing runs per command, for the composition's latency constants.
for i in 1 2 3; do
  rm -rf .manni
  a=$(ms); "${T[@]}" tracevals check breaks.jsonl --project . >/dev/null 2>&1 || true; b=$(ms)
  hook >/dev/null 2>&1 || true; c=$(ms)
  echo "timing$i check(cold) $((b - a))ms hook(warm) $((c - b))ms" >> "$C/latency.txt"
done
cat "$C/latency.txt"
