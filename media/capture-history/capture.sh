#!/usr/bin/env bash
# claim-history-1x1: build the demo repository and capture every real byte the
# video replays. Run from media/ after `npm run build` at the repo root:
#   npm i --prefix scratch-prev @hawkeyexl/manni@2.3.7
#   bash capture-history/capture.sh
#
# Input is staged from test/fixtures/cite/a11y-replay, which holds this
# repository's five a11y pages, their src/a11y/ sources and the citations the
# dogfood minted, at the state before the merges. Three commits then replay
# what landed: the docs corrections #41 and #42, and the marker hoist that
# #43's anchor rule asks for. Paths are shortened to docs/a11y/ so the rows
# fit a phone-legible font.
#
# No `pipefail`: beats 1, 2, 4 and 5 pipe into `head` and `tail`, which close
# the pipe and would otherwise report 141 for a command that printed correctly.
# Beat 5's exit code is taken from an unpiped run, which is the honest one.
set -eu
cd "$(dirname "$0")/.."
C="$(pwd)/capture-history"
S=scratch-history
F="$(pwd)/../test/fixtures/cite/a11y-replay"

command -v git >/dev/null
test -x ../dist/cli.js -o -f ../dist/cli.js || { echo "run npm run build first" >&2; exit 2; }
test -d "$F" || { echo "missing fixture: $F" >&2; exit 2; }
test -f scratch-prev/node_modules/@hawkeyexl/manni/dist/cli.js || {
  echo "run: npm i --prefix scratch-prev @hawkeyexl/manni@2.3.7" >&2; exit 2; }

rm -rf "$S" && mkdir -p "$S"
cp -R "$F/base/." "$S/"

cd "$S"
git init -q -b main
git config user.name "Maya Chen"
git config user.email maya@example.com
git add -A
GIT_AUTHOR_DATE=2026-09-16T09:00:00Z GIT_COMMITTER_DATE=2026-09-16T09:00:00Z \
  git commit -qm "docs(a11y): pin the a11y pages to source"
git rev-parse --short HEAD > "$C/baseline.txt"

# The three merges, in the order they landed. Each step is a whole tree, so the
# replay cannot drift from the fixture the tests read.
i=0
while IFS= read -r subject; do
  i=$((i + 1))
  rm -rf docs src
  cp -R "$F/step$i/." .
  git add -A
  GIT_AUTHOR_DATE="2026-09-16T1$i:00:00Z" GIT_COMMITTER_DATE="2026-09-16T1$i:00:00Z" \
    git commit -qm "$subject"
done < "$F/subjects.txt"

git log --oneline > "$C/git-log.txt"

# The two builds. `mnow` is typed as `manni` in the video and `mprev` as
# `manni-2.3.7`; only the name differs, and the beats file carries the typed
# line. Each runs under the preload that tells it stdout and stderr are a TTY,
# so the colour is the colour a user sees.
mnow() { node -r ../capture/tty.cjs ../../dist/cli.js "$@"; }
mprev() { node -r ../capture/tty.cjs \
  ../scratch-prev/node_modules/@hawkeyexl/manni/dist/cli.js "$@"; }

ms() { date +%s%3N; }
run() { # name, then the command line exactly as the video types it
  local name=$1; shift
  local a b rc=0
  a=$(ms); eval "$*" > "$C/$name.ans" 2>&1 || rc=$?; b=$(ms)
  echo "$rc" > "$C/$name.exit"
  echo "$name ${rc} $((b - a))ms  $*" >> "$C/latency.txt"
}

: > "$C/latency.txt"

# Beat 1. The published build: 92 rows, one status.
run b1-page 'mprev cite check docs/a11y/index.mdx | head -4'
run b1-all  'mprev cite check docs/a11y/ | tail -1'

# Beat 2. This build, same pins, same pages: 68 notices and 24 warnings.
run b2-page 'mnow cite check docs/a11y/index.mdx | head -4'
run b2-all  'mnow cite check docs/a11y/ | tail -1'

# Beat 3. update clears the 68, with no --accept. This rewrites the manifest,
# so every later capture runs after it, as the video shows them.
run b3-update "mnow cite update docs/a11y/ | sed -n '1p;\$p'"

# Beat 4. One of the 24, with its commit and its diff.
run b4-diff 'mnow cite check --show-diff docs/a11y/index.mdx | head -7'

# Beat 5. The count that is left, and the exit code from an unpiped run.
run b5-all  'mnow cite check docs/a11y/ | tail -1'
run b5-exit 'mnow cite check docs/a11y/ > /dev/null; echo $?'

# Three timing runs of each beat, the repository reset between them. The video
# replays the middle value; design.md wants the measurement, not an estimate.
for n in 1 2 3; do
  git reset -q --hard HEAD && git clean -fdq
  a=$(ms); mprev cite check docs/a11y/ > /dev/null 2>&1 || true; b=$(ms)
  mnow cite check docs/a11y/ > /dev/null 2>&1 || true; c=$(ms)
  mnow cite update docs/a11y/ > /dev/null 2>&1 || true; d=$(ms)
  mnow cite check --show-diff docs/a11y/index.mdx > /dev/null 2>&1 || true; e=$(ms)
  mnow cite check docs/a11y/ > /dev/null 2>&1 || true; f=$(ms)
  echo "timing$n before $((b - a))ms check $((c - b))ms update $((d - c))ms show-diff $((e - d))ms check-after $((f - e))ms" \
    >> "$C/latency.txt"
done

# Leave the repository in the state beats 4 and 5 were captured in.
git reset -q --hard HEAD && git clean -fdq
mnow cite update docs/a11y/ > /dev/null 2>&1 || true

echo "captures in $C; baseline $(cat "$C/baseline.txt")"
