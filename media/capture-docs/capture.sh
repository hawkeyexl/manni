#!/usr/bin/env bash
# docs-preview-1x1: capture every real byte the video replays.
#
# Like the a11y video, there is no scratch repository. The material is this
# repository: `docs/` is a Starlight site, and `manni.config.yaml`'s `site`
# collection carries `url: http://127.0.0.1:4321/manni/`, which is where both
# `manni docs preview` (the port and host it serves on) and `manni a11y check`
# (the seed it crawls) read it from.
#
# Before running, from the repo root:
#   npm ci && npm run build
#   cd docs && npm ci
#
# Then, from the repo root, with port 4321 free:
#   bash media/capture-docs/capture.sh
#
# Staging, disclosed because design.md's "Honesty" section requires it:
#
#   - Every command runs through clean-env.sh, which removes the AI-agent
#     variables (CLAUDECODE, CLAUDE_*, AI_AGENT, ...). Astro 7 reads them
#     through `am-i-vibing` and, inside an agent, backgrounds `astro preview`
#     and prints JSON. The video shows what a person's shell prints.
#   - manni runs under media/capture/tty.cjs, so it believes stdout and stderr
#     are a terminal. npm and astro are its children and inherit the capture
#     file, not the preload, so FORCE_COLOR=1 gives them the colour a terminal
#     would. No other variable is set.
#   - `ls docs` is captured as `ls -C -w "$COLS" docs`: the column layout a
#     terminal of the replay's width draws. A file redirect would print one
#     name per line.
#   - git grep is captured without colour. In a terminal git paints the match
#     red, and red means failure in manni's own output (design.md).
set -euo pipefail
cd "$(dirname "$0")/../.."
C="$(pwd)/media/capture-docs"
COLS="${COLS:-61}"
CLEAN=(bash "$C/clean-env.sh")
# T is `manni` as typed in the video: the built CLI, told it is on a TTY.
T=("${CLEAN[@]}" env FORCE_COLOR=1 node -r ./media/capture/tty.cjs dist/cli.js)

if netstat -ano 2>/dev/null | grep -qE ":4321 .*LISTEN"; then
  echo "port 4321 is in use; stop that server first" >&2; exit 1
fi

: > "$C/latency.txt"
ms() { date +%s%3N; }

# 1. The problem: a docs folder, and the serve command main's CI hand-typed.
ls -C -w "$COLS" docs > "$C/ls.ans"
git grep -h "npx astro" main -- .github > "$C/git-grep.ans"

# 2. manni docs preview, stamped per line so the replay's waits are measured,
#    not guessed. The stamp file is the record; preview.ans is its bytes.
t0=$(ms)
( "${T[@]}" docs preview 2>&1 | while IFS= read -r line; do printf '%s\t%s\n' "$(( $(ms) - t0 ))" "$line"; done ) > "$C/preview.stamped" &
for _ in $(seq 1 600); do
  grep -aq "Local .*4321" "$C/preview.stamped" 2>/dev/null && break
  sleep 0.5
done
grep -aq "Local .*4321" "$C/preview.stamped" || { echo "preview never answered" >&2; cat "$C/preview.stamped" >&2; exit 1; }
sleep 1
cut -f2- "$C/preview.stamped" > "$C/preview.ans"
echo "preview: $(grep -ac '' "$C/preview.ans") lines" >> "$C/latency.txt"
grep -a "manni: \|Complete!\|Local " "$C/preview.stamped" | sed 's/\x1b\[[0-9;]*m//g' >> "$C/latency.txt"

# 3. A second terminal, while the preview runs: Hugo, detected in a fixture.
#    Hugo is not installed on this machine, and the run says so. Not stubbed.
a=$(ms); rc=0; "${T[@]}" docs build test/fixtures/docs/hugo > "$C/hugo.ans" 2>&1 || rc=$?; b=$(ms)
echo "$rc" > "$C/hugo.exit"; echo "hugo exit $rc $((b - a))ms" >> "$C/latency.txt"

# 4. a11y check with no URL: the seed is the same collection url: the preview
#    serves on. Real, cold, uncapped. `time` is bash's.
rc=0
{ time "${T[@]}" a11y check -q --no-progress ; } > "$C/a11y.ans" 2>&1 || rc=$?
echo "$rc" > "$C/a11y.exit"
echo "a11y exit $rc" >> "$C/latency.txt"; grep -a '^real' "$C/a11y.ans" >> "$C/latency.txt" || true

# 5. Stop the preview and confirm the port is free.
(cd docs && "${CLEAN[@]}" npx astro preview stop) || true
sleep 2
pid=$(netstat -ano 2>/dev/null | grep -E ":4321 .*LISTEN" | awk '{print $NF}' | head -1 || true)
[ -n "$pid" ] && taskkill //F //T //PID "$pid" > /dev/null 2>&1 || true
wait || true
sleep 1
if netstat -ano 2>/dev/null | grep -qE ":4321 .*LISTEN"; then echo "port 4321 STILL IN USE" >> "$C/latency.txt"; else echo "port 4321 free" >> "$C/latency.txt"; fi
cat "$C/latency.txt"
