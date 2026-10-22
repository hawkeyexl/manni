#!/usr/bin/env bash
# cite-repos-1x1: build the three demo checkouts and capture every real byte
# the video replays. Run from the repo root after `npm run build`:
#   bash media/capture-repos/capture.sh
#
# media/scratch-cite-repos/ (gitignored) holds docs, api and sdk side by side,
# each its own git repository with a pinned author and pinned dates, so the
# SHAs on screen are the same on every run. api/lib/limits.ts and
# sdk/src/client.ts are byte copies of test/fixtures/cite-repos/, the fixture
# the proposal 0100 tests read.
#
# Two passes over the same page:
#   before  no manni.config.yaml. Each pin is minted the only way it could be
#           before 0100, with --root naming one checkout. Beat 1 checks it
#           under each root.
#   after   the page goes back to unpinned, cite.repos is declared, and both
#           pins are minted with a repo. Beats 2 to 5.
set -euo pipefail
cd "$(dirname "$0")/../.."
REPO="$(pwd)"
C="$REPO/media/capture-repos"
S="$REPO/media/scratch-cite-repos"
F="$REPO/test/fixtures/cite-repos"
TTY="$REPO/media/capture/tty.cjs"

test -f dist/cli.js || { echo "run npm run build first" >&2; exit 2; }

# The tty shim tells the CLI stdout and stderr are a terminal, so the capture
# holds the colour a terminal receives. Nothing else changes.
manni() { node -r "$TTY" "$REPO/dist/cli.js" "$@"; }

commit() { # dir, iso date, subject
  ( cd "$1" && git add -A &&
    GIT_AUTHOR_DATE="$2" GIT_COMMITTER_DATE="$2" git commit -qm "$3" )
}
init() { # dir
  mkdir -p "$1"
  ( cd "$1" && git init -q -b main &&
    git config user.name "Maya Chen" && git config user.email maya@example.com )
}

rm -rf "$S"
init "$S/api"; mkdir -p "$S/api/lib"; cp "$F/api/lib/limits.ts" "$S/api/lib/"
commit "$S/api" 2026-10-20T09:00:00Z "feat: request limits"
init "$S/sdk"; mkdir -p "$S/sdk/src"; cp "$F/sdk/src/client.ts" "$S/sdk/src/"
commit "$S/sdk" 2026-10-20T09:10:00Z "feat: retry failed requests"

init "$S/docs"; mkdir -p "$S/docs/pages"
cat > "$S/docs/pages/limits.md" <<'EOF'
---
title: Limits
description: The request timeout and the retry count.
---
# Limits

A request times out after 30 seconds.

The SDK retries a failed request three times.
EOF
commit "$S/docs" 2026-10-20T09:20:00Z "docs: limits page"

: > "$C/latency.txt"
run() { # name, then the command; runs in docs
  local name=$1; shift
  local rc=0 t0 t1
  t0=$(date +%s%N)
  ( cd "$S/docs" && "$@" ) > "$C/$name.ans" 2>&1 || rc=$?
  t1=$(date +%s%N)
  echo "$rc" > "$C/$name.exit"
  echo "$name exit $rc $(( (t1 - t0) / 1000000 )) ms  $*" >> "$C/latency.txt"
}
line() { grep -n -F "$1" "$S/docs/pages/limits.md" | cut -d: -f1; }

# ---- before: one root per run ----------------------------------------------
P="$S/docs/pages/limits.md"
run mint-before-timeout manni cite add "pages/limits.md:$(line 'times out')" lib/limits.ts:2 --id timeout --root ../api
run mint-before-retries manni cite add "pages/limits.md:$(line 'SDK retries')" src/client.ts:2 --id retries --root ../sdk
commit "$S/docs" 2026-10-20T09:30:00Z "docs: pin the limits page"

run b1-api manni cite check pages/limits.md --root ../api
run b1-sdk manni cite check pages/limits.md --root ../sdk

# ---- after: cite.repos ------------------------------------------------------
( cd "$S/docs" && git checkout -q HEAD~1 -- pages/limits.md )
cat > "$S/docs/manni.config.yaml" <<'EOF'
cite:
  repos:
    api: ../api
    sdk: ../sdk
EOF
cp "$S/docs/manni.config.yaml" "$C/cat-config.txt"
run mint-timeout manni cite add "pages/limits.md:$(line 'times out')" api:lib/limits.ts:2 --id timeout
run mint-retries manni cite add "pages/limits.md:$(line 'SDK retries')" sdk:src/client.ts:2 --id retries
commit "$S/docs" 2026-10-20T09:40:00Z "docs: pin the limits page to api and sdk"
cp "$P" "$C/page-pinned.md"

run b3-check manni cite check pages/limits.md

# Beat 4: the SDK moves to five attempts.
sed -i 's/attempts: 3/attempts: 5/' "$S/sdk/src/client.ts"
commit "$S/sdk" 2026-10-21T10:00:00Z "feat: retry five times"
# Typed as `git -C ../sdk log -1 -p --oneline -U0`. color.ui=always stands in
# for the terminal git would colour for, as the tty shim does for manni.
run b4-log git -c color.ui=always -C ../sdk log -1 -p --oneline -U0

run b5-check manni cite check pages/limits.md

manni --version > "$C/version.txt"
cat "$C/latency.txt"
