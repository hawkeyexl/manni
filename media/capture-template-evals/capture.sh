#!/usr/bin/env bash
# template-evals-1x1: build the demo repository and capture every real byte the
# video replays. Run from anywhere after `npm run build` at the repo root:
#   bash media/capture-template-evals/capture.sh
#
# Staging, disclosed: the input is test/docevals/fixtures/template-evals/ as it
# sits in the working tree (the fixture ships with the feature, so it is not yet
# at HEAD), copied unchanged. templates/how-to.yaml extends the built-in
# tgdp:how-to:1.6, skips tgdp-one-method and adds a regex eval,
# shows-the-command. docs/typed-fails.md declares `type: how-to` and names no
# manni command, so that eval fails. Nothing is edited.
#
# The repository is media/scratch-template-evals/ (gitignored, its own git), so
# config discovery stops at its own manni.config.yaml and never reaches manni's.
# Every path manni prints is relative, so no junction is needed.
set -euo pipefail
cd "$(dirname "$0")/.."
MEDIA="$(pwd)"
C="$MEDIA/capture-template-evals"
S="$MEDIA/scratch-template-evals"

rm -rf "$S" && mkdir -p "$S"
cp -r "$MEDIA/../test/docevals/fixtures/template-evals/." "$S/"
cd "$S"
git init -q -b main
git config user.name "Sam Rivera"
git config user.email sam@example.com
git config core.autocrlf false
git add -A
GIT_AUTHOR_DATE=2026-11-24T09:00:00Z GIT_COMMITTER_DATE=2026-11-24T09:00:00Z \
  git commit -qm "docs: a house how-to template"

# T is `manni` as typed in the video: the built CLI, told stdout/stderr are a TTY.
T=(node -r "$MEDIA/capture/tty.cjs" "$MEDIA/../dist/cli.js")
ms() { date +%s%3N; }

rm -f "$C"/*.ans "$C"/*.exit "$C"/*.txt
: > "$C/latency.txt"
node "$MEDIA/../dist/cli.js" --version > "$C/version.txt"
# Beat 1: the page. Typed as `cat docs/typed-fails.md`.
cat docs/typed-fails.md > "$C/page.txt"
# Beat 2: the house template. Typed as `cat templates/how-to.yaml`.
cat templates/how-to.yaml > "$C/template.txt"
# Beat 3: the resolved plan. Typed as `manni docevals list docs/typed-fails.md`.
a=$(ms); rc=0
"${T[@]}" docevals list docs/typed-fails.md > "$C/list.ans" 2>&1 || rc=$?
b=$(ms); echo "$rc" > "$C/list.exit"; echo "list ${rc} $((b - a))ms" >> "$C/latency.txt"
# Beat 4: grade it. Typed as `manni docevals run --deterministic-only docs/typed-fails.md; echo $?`.
a=$(ms); rc=0
"${T[@]}" docevals run --deterministic-only docs/typed-fails.md > "$C/run.ans" 2>&1 || rc=$?
b=$(ms); echo "$rc" > "$C/run.exit"; echo "run ${rc} $((b - a))ms" >> "$C/latency.txt"

# Three timing runs each, the repository reset between runs.
for i in 1 2 3; do
  git reset -q --hard && git clean -fdxq
  a=$(ms); "${T[@]}" docevals list docs/typed-fails.md > /dev/null 2>&1 || true; b=$(ms)
  echo "timing$i list $((b - a))ms" >> "$C/latency.txt"
  a=$(ms); "${T[@]}" docevals run --deterministic-only docs/typed-fails.md > /dev/null 2>&1 || true; b=$(ms)
  echo "timing$i run $((b - a))ms" >> "$C/latency.txt"
done
git status --short > "$C/after-status.txt"
git reset -q --hard && git clean -fdxq
cat "$C/latency.txt"
