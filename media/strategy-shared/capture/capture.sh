#!/usr/bin/env bash
# strategy-shared-1x1: capture every real byte the video replays.
# Run from the repo root after `npm run build`:
#   bash media/strategy-shared/capture/capture.sh
#
# The demo is two checkouts side by side under media/scratch-strategy-shared/
# (gitignored by media/scratch-*/), the layout the strategy docs' "Share one
# strategy across repositories" section draws:
#
#   manni/         owns the records. A copy of this checkout's
#                  docs/content-strategy/, its docs pages with their sidecars,
#                  the page schema those sidecars need and its
#                  manni.config.yaml. So `strategy list` there counts the pages
#                  that name each journey exactly as this repository does.
#   manni-plugin/  borrows them. Its config, one page and its own journey p1
#                  are manni-plugin/ beside this script. It also keeps a copy
#                  of manni's personas/maya.md, the stale copy beat 1 finds.
#
# Each gets its own git repository: the outer repo's .gitignore would otherwise
# hide every file from manni, and beat 2 removes the copy with git rm.
#
# `manni` is `node -r media/capture/tty.cjs dist/cli.js`: stdout and stderr read
# as a terminal, so colour is emitted. Nothing else changes. The join in beat 3
# is join.txt beside this script, run as typed. jq is not installed on the
# capture machine, so it is node -e in place of the docs' jq.
set -euo pipefail
cd "$(dirname "$0")/../../.."
REPO="$(pwd)"
C="$REPO/media/strategy-shared/capture"
WORK="$REPO/media/scratch-strategy-shared"

commit() { git add -A && git -c user.name=demo -c user.email=demo@example.com commit -qm "$1"; }

rm -rf "$WORK"
mkdir -p "$WORK/manni/docs/src/content" "$WORK/manni-plugin"
cp -r docs/content-strategy "$WORK/manni/docs/"
cp -r docs/src/content/docs "$WORK/manni/docs/src/content/"
cp docs/doc-frontmatter.schema.json "$WORK/manni/docs/"
cp manni.config.yaml "$WORK/manni/"
(cd "$WORK/manni" && git init -q && commit "records and pages")
cp -r "$C/manni-plugin/." "$WORK/manni-plugin/"
mkdir -p "$WORK/manni-plugin/strategy/personas"
cp docs/content-strategy/personas/maya.md "$WORK/manni-plugin/strategy/personas/maya.md"
(cd "$WORK/manni-plugin" && git init -q && commit "plugin docs, with last spring's copy of maya")

manni() { node -r "$REPO/media/capture/tty.cjs" "$REPO/dist/cli.js" "$@"; }

: > "$C/latency.txt"
ms() { echo $(( $(date +%s%N) / 1000000 )); }
run() { # name, then the command; stdout and stderr interleave as a terminal shows them
  local name=$1; shift
  local rc=0 a b
  a=$(ms); "$@" > "$C/$name.ans" 2>&1 || rc=$?; b=$(ms)
  echo "$rc" > "$C/$name.exit"
  echo "$name exit $rc $((b - a)) ms" >> "$C/latency.txt"
}
timing() { # label, then the command; output discarded
  local label=$1; shift
  local a b
  a=$(ms); "$@" > /dev/null 2>&1 || true; b=$(ms)
  echo "timing $label $((b - a)) ms" >> "$C/latency.txt"
}

node dist/cli.js --version > "$C/version.txt"
git rev-parse --short HEAD > "$C/build-commit.txt"

cd "$WORK/manni-plugin"
# Beat 1: two Mayas. Timing runs first, then the captured run.
for i in 1 2 3; do timing "check-copy-$i" manni strategy check; done
run check-copy manni strategy check
# Beat 2: the copy goes, and manni's Maya is the only one.
run rm git rm strategy/personas/maya.md
run check-borrowed manni strategy check
for i in 1 2 3; do timing "check-borrowed-$i" manni strategy check; done

# Beat 3: coverage across both, from the folder that holds them. Each
# repository's list, then the join, both exactly as typed on screen. Timing
# runs of each follow, for the replay's latency constants.
cd "$WORK"
lists() { for r in manni manni-plugin; do (cd $r && manni strategy list -f json > ../$r.json); done; }
run lists lists
for i in 1 2 3; do timing "lists-$i" lists; done
run join bash "$C/join.txt"
for i in 1 2 3; do timing "join-$i" bash "$C/join.txt"; done

# Not shown: the clean check as JSON, for the script's record of summary.borrowed.
(cd "$WORK/manni-plugin" && node "$REPO/dist/cli.js" strategy check -f json > "$C/check-borrowed.json" 2>&1 || true)
(cd "$REPO" && git status --short) > "$C/status-after.txt"
cat "$C/latency.txt"
