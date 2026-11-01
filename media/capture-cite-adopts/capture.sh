#!/usr/bin/env bash
# cite-add-adopts-1x1: build the demo repo and capture every real byte the
# video replays. Run from the repo root after `npm run build`:
#   bash media/capture-cite-adopts/capture.sh
#
# media/scratch-cite-adopts/ (gitignored) is one git repository with a pinned
# author and pinned dates, so the SHA on screen is the same on every run. The
# page is written first, with a marker above its sentence and no entry, and
# the code it rests on is already committed. Proposal 0127.
set -euo pipefail
cd "$(dirname "$0")/../.."
REPO="$(pwd)"
C="$REPO/media/capture-cite-adopts"
S="$REPO/media/scratch-cite-adopts"
TTY="$REPO/media/capture/tty.cjs"

test -f dist/cli.js || { echo "run npm run build first" >&2; exit 2; }

# The tty shim tells the CLI stdout and stderr are a terminal, so the capture
# holds the colour a terminal receives. Nothing else changes.
manni() { node -r "$TTY" "$REPO/dist/cli.js" "$@"; }

rm -rf "$S"
mkdir -p "$S/docs/design" "$S/lib"
cd "$S"
git init -q -b main
git config user.name "Maya Chen"; git config user.email maya@example.com

cat > lib/limits.ts <<'TS'
// Request limits.
export const RETRIES = 3;
TS
cat > lib/limits.test.ts <<'TS'
test("retries 3 times", () => expect(RETRIES).toBe(3));
TS
cat > docs/design/retry.md <<'MD'
---
title: Retry spec
---
# Retry spec

<!-- cite retry-default retry-default-test -->
Failed requests retry 3 times by default.
MD
git add -A
GIT_AUTHOR_DATE=2026-10-30T09:00:00Z GIT_COMMITTER_DATE=2026-10-30T09:00:00Z \
  git commit -qm "docs: retry spec, limits and test"

: > "$C/latency.txt"
run() { # name, then the command
  local name=$1; shift
  local rc=0 t0 t1
  t0=$(date +%s%N)
  "$@" > "$C/$name.ans" 2>&1 || rc=$?
  t1=$(date +%s%N)
  echo "$rc" > "$C/$name.exit"
  echo "$name exit $rc $(( (t1 - t0) / 1000000 )) ms  $*" >> "$C/latency.txt"
}

# Beat 1: the page, written first. Typed as `cat -n docs/design/retry.md`.
run b1-cat cat -n docs/design/retry.md
# Beat 2: the to-do list.
run b2-check manni cite check docs/design/retry.md
# Beat 3 and 4: pin each claim, one run each. The second names line 16,
# where the sentence moved once the first entry grew the frontmatter.
run b3-add manni cite add docs/design/retry.md:7 lib/limits.ts:2 --id retry-default
run b4-add manni cite add docs/design/retry.md:16 lib/limits.test.ts:1 --id retry-default-test
# Beat 5: clean, and the body is untouched. color.ui=always stands in for the
# terminal git would colour for, as the tty shim does for manni.
run b5-check manni cite check docs/design/retry.md
run b5-diff git -c color.ui=always diff --stat docs/design/retry.md

cp docs/design/retry.md "$C/page-pinned.md"
manni --version > "$C/version.txt"
cat "$C/latency.txt"
