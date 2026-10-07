#!/usr/bin/env bash
# system-prompt-1x1: capture every real byte the video replays.
# Run from media/ after `npm run build` at the repo root:
#   bash system-prompt/capture/capture.sh
#
# The demo project is staged at media/scratch-system-prompt/ from the committed
# fixtures in test/tracevals/fixtures/conformance/ (the project/ directory, plus
# the system-prompt.jsonl and system-prompt-custom.jsonl traces). .gitignore
# covers media/scratch-*/, and nothing in test/ is touched. HOME and
# CLAUDE_CONFIG_DIR point at an empty scratch home, as the integration tests do,
# so no user's own CLAUDE.md is read. The fixture's manni.config.yaml sets
# `provider: mock`: extraction and judging run offline and deterministically,
# exactly as in CI.
set -euo pipefail
cd "$(dirname "$0")/../.."
C="$(pwd)/system-prompt/capture"
REPO="$(cd .. && pwd)"
FIX="$REPO/test/tracevals/fixtures/conformance"
DEMO="$(pwd)/scratch-system-prompt"
HOMEDIR="$(pwd)/scratch-system-prompt-home"

for d in "$DEMO" "$HOMEDIR"; do
  if [ -e "$d" ] && [ ! -e "$d/.system-prompt-demo" ]; then
    echo "refusing to overwrite $d (not a staged system-prompt demo)" >&2
    exit 2
  fi
done
rm -rf "$DEMO" "$HOMEDIR"
cp -r "$FIX/project" "$DEMO"
cp "$FIX/traces/system-prompt.jsonl" "$FIX/traces/system-prompt-custom.jsonl" "$DEMO/"
mkdir -p "$HOMEDIR"
touch "$DEMO/.system-prompt-demo" "$HOMEDIR/.system-prompt-demo"
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

: > "$C/latency.txt"
node "$REPO/dist/cli.js" --version > "$C/version.txt"
git -C "$REPO" rev-parse --short HEAD > "$C/build-commit.txt"

# Beat 1: the system prompt the transcript recorded, then the agent's last word.
grep -o '"systemPrompt":[^]]*' system-prompt.jsonl | head -1 > "$C/grep-prompt.txt"
tail -1 system-prompt.jsonl | grep -o '"text":"[^"]*"' > "$C/grep-done.txt"
# Beat 2, cold: the first run extracts rules from every source (mock).
run default "${T[@]}" tracevals check system-prompt.jsonl --project .
# Beat 3: the replaced prompt (no boundary marker), then its check.
grep -o '"systemPrompt":[^]]*' system-prompt-custom.jsonl | head -1 > "$C/grep-custom.txt"
run custom "${T[@]}" tracevals check system-prompt-custom.jsonl --project .

# Three timing runs per command, cold, for the composition's latency constants.
for i in 1 2 3; do
  rm -rf .manni
  a=$(ms); "${T[@]}" tracevals check system-prompt.jsonl --project . >/dev/null 2>&1 || true; b=$(ms)
  "${T[@]}" tracevals check system-prompt-custom.jsonl --project . >/dev/null 2>&1 || true; c=$(ms)
  echo "timing$i default(cold) $((b - a))ms custom(after default) $((c - b))ms" >> "$C/latency.txt"
done
cat "$C/latency.txt"
