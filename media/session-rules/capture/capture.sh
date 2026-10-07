#!/usr/bin/env bash
# session-rules-1x1: capture every real byte the video replays.
# Run from media/ after `npm run build` at the repo root:
#   bash session-rules/capture/capture.sh
#
# The demo project is staged at media/scratch-session-rules/ from the committed
# fixtures in test/tracevals/fixtures/conformance/ (the requests/ project, plus
# the requests.jsonl trace). .gitignore covers media/scratch-*/, and nothing in
# test/ is touched. HOME and CLAUDE_CONFIG_DIR point at an empty scratch home,
# as the integration tests do, so no user's own CLAUDE.md is read. The
# fixture's manni.config.yaml sets `provider: mock`: extraction and judging
# run offline and deterministically, exactly as in CI.
set -euo pipefail
cd "$(dirname "$0")/../.."
C="$(pwd)/session-rules/capture"
REPO="$(cd .. && pwd)"
FIX="$REPO/test/tracevals/fixtures/conformance"
DEMO="$(pwd)/scratch-session-rules"
HOMEDIR="$(pwd)/scratch-session-rules-home"

for d in "$DEMO" "$HOMEDIR"; do
  if [ -e "$d" ] && [ ! -e "$d/.session-rules-demo" ]; then
    echo "refusing to overwrite $d (not a staged session-rules demo)" >&2
    exit 2
  fi
done
rm -rf "$DEMO" "$HOMEDIR"
cp -r "$FIX/requests" "$DEMO"
cp "$FIX/traces/requests.jsonl" "$DEMO/requests.jsonl"
mkdir -p "$HOMEDIR"
touch "$DEMO/.session-rules-demo" "$HOMEDIR/.session-rules-demo"
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
sources() { "${T[@]}" tracevals check requests.jsonl --project . -f json | grep '"path"'; }

: > "$C/latency.txt"
node "$REPO/dist/cli.js" --version > "$C/version.txt"
git -C "$REPO" rev-parse --short HEAD > "$C/build-commit.txt"

# Beat 1: the two prompts the user typed (the human turns' content).
grep human requests.jsonl | grep -o '"content":"[^"]*"' > "$C/grep-prompts.txt"
# Beat 2: the files the agent edited, then its last word.
grep -o '"Edit","input":{"file_path":"[^"]*"' requests.jsonl > "$C/grep-edits.txt"
tail -1 requests.jsonl | grep -o '"text":"[^"]*"' > "$C/grep-done.txt"
# Beat 3, cold: the first run extracts rules from every source (mock).
run check "${T[@]}" tracevals check requests.jsonl --project .
# Beat 4, warm, as in the video: it runs after beat 3, so extraction is cached.
run sources sources

# Three timing runs per command, for the composition's latency constants.
for i in 1 2 3; do
  rm -rf .manni
  a=$(ms); "${T[@]}" tracevals check requests.jsonl --project . >/dev/null 2>&1 || true; b=$(ms)
  sources >/dev/null 2>&1 || true; c=$(ms)
  echo "timing$i check(cold) $((b - a))ms sources(warm) $((c - b))ms" >> "$C/latency.txt"
done
cat "$C/latency.txt"
