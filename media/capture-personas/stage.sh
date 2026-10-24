#!/usr/bin/env bash
# persona-judge-1x1: stage the demo repository the capture runs in.
# Run from anywhere after `npm run build`:
#   bash media/capture-personas/stage.sh
#
# media/scratch-persona-evals/ (gitignored by media/scratch-*/) is a byte copy
# of test/docevals/fixtures/personas/, with two changes, both recorded in
# media/persona-judge-1x1.script.md:
#   - manni.config.yaml names the local judge the repository's own config uses
#     (llama-cpp, granite-4.1-3b-q2) at temperature 0. The fixture names none,
#     because its tests stub the judge.
#   - docs/one-reader.md is replaced by one-reader.before.md, beside this
#     script. capture.sh later swaps in one-reader.after.md.
set -euo pipefail
cd "$(dirname "$0")/../.."
REPO="$(pwd)"
C="$REPO/media/capture-personas"
DEMO="$REPO/media/scratch-persona-evals"

rm -rf "$DEMO"
mkdir -p "$DEMO"
cp -r test/docevals/fixtures/personas/. "$DEMO/"
cp "$C/manni.config.yaml" "$DEMO/manni.config.yaml"
cp "$C/one-reader.before.md" "$DEMO/docs/one-reader.md"

# Its own repository: the outer checkout's .gitignore skips media/scratch-*,
# and manni honours it. The one commit is the "before" state, so beat 3's
# `git diff` shows exactly the edit.
cd "$DEMO"
git init -q
git add .
git -c user.name=demo -c user.email=demo@example.com commit -qm "personas demo"
