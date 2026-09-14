#!/usr/bin/env bash
# field-location-1x1: build the demo repository and capture every real byte the
# video replays. Run from media/ after `npm run build` at the repo root:
#   bash capture-location/capture.sh
# Input is staged from test/fixtures/location/relocate-create (a `site`
# collection with no externalMetadata yet, and a schema marking keys external),
# with the page grown to the three maintainer keys the story needs and the
# schema's type keywords dropped so every line fits a phone-legible font.
set -euo pipefail
cd "$(dirname "$0")/.."
C="$(pwd)/capture-location"
S=scratch-location
rm -rf "$S" && mkdir -p "$S/docs"

cat > "$S/manni.config.yaml" <<'EOF'
meta:
  schemas: [./page.schema.json]
collections:
  - name: site
    paths: ["docs/**/*.md"]
EOF

cat > "$S/page.schema.json" <<'EOF'
{
  "properties": {
    "title": { "x-manni-location": "page" },
    "description": { "x-manni-location": "page" },
    "owner": { "x-manni-location": "external" },
    "stakeholders": { "x-manni-location": "external" },
    "review-interval": { "x-manni-location": "external" }
  }
}
EOF

cat > "$S/docs/install.md" <<'EOF'
---
title: Install
description: Install manni and run it.
owner: platform
stakeholders: [ada, grace]
review-interval: 90d
---
# Install
EOF

cd "$S"
git init -q -b main
git config user.name "Sam Rivera"
git config user.email sam@example.com
git add -A
GIT_AUTHOR_DATE=2026-09-13T10:00:00Z GIT_COMMITTER_DATE=2026-09-13T10:00:00Z git commit -qm "docs: install page"

# T is `manni` as typed in the video: the built CLI, told stdout/stderr are a TTY.
T=(node -r ../capture/tty.cjs ../../dist/cli.js)
ms() { date +%s%3N; }
run() { # name, then the command
  local name=$1; shift
  local a b rc=0
  a=$(ms); "$@" > "$C/$name.ans" 2>&1 || rc=$?; b=$(ms)
  echo "$rc" > "$C/$name.exit"
  echo "$name ${rc} $((b - a))ms" >> "$C/latency.txt"
}

: > "$C/latency.txt"
cat docs/install.md > "$C/cat-page1.txt"
cat page.schema.json > "$C/cat-schema.txt"
run validate1 "${T[@]}" meta validate
run relocate "${T[@]}" meta relocate
cat site.metadata.yaml > "$C/cat-manifest.txt"
git -c color.ui=always --no-pager diff -U1 > "$C/diff-all.ans"
run validate2 "${T[@]}" meta validate

# Three timing runs on the same repository, reset between runs.
for i in 1 2 3; do
  git reset -q --hard && git clean -fdq
  a=$(ms); "${T[@]}" meta validate > /dev/null 2>&1 || true; b=$(ms)
  "${T[@]}" meta relocate > /dev/null 2>&1; c=$(ms)
  git -c color.ui=always --no-pager diff -U1 > /dev/null; d=$(ms)
  "${T[@]}" meta validate > /dev/null 2>&1; e=$(ms)
  echo "timing$i validate $((b - a))ms relocate $((c - b))ms git-diff $((d - c))ms validate-clean $((e - d))ms" >> "$C/latency.txt"
done
cat "$C/latency.txt"
