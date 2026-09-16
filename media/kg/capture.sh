#!/usr/bin/env bash
# kg-impact-1x1: stage the demo repository and capture every real byte the video
# replays. Run from media/ after `npm run build` at the repo root:
#   bash kg/capture.sh
#
# Two things about the staging are deliberate.
#
# 1. The demo repository lives OUTSIDE this checkout. `manni kg build` reads git
#    history, so a corpus sitting inside the manni worktree would stamp manni's
#    own commits into the graph; and a corpus with no git at all makes build
#    print `manni: the graph has no revision history or commit agents ...` on
#    stderr. Neither belongs on screen. So: its own repo, one commit, fixed
#    dates, outside the worktree.
#
# 2. The path is short on purpose. `kg build` prints the absolute path it wrote
#    (src/kg/cli.ts:282), and a temp directory would put a 120-character line in
#    a 1080px frame. C:\kgdemo keeps that line at 46 characters.
#
# The documents are test/kg/fixtures/corpus/ verbatim — the eight the kg
# determinism tests run against. The only edit to the staged copy is
# manni.config.yaml's `baseIri:`, shortened from https://example.com/kg/ to
# https://acme.dev/ so the IRIs stay phone-legible. baseIri is a per-site
# setting; it changes no count and no relationship in the graph (220 triples
# without git history, 292 with, either way).
set -euo pipefail
cd "$(dirname "$0")/.."
REPO="$(cd .. && pwd)"
C="$(pwd)/kg/capture"
S="${KGDEMO:-/c/kgdemo}"

mkdir -p "$C"
rm -rf "$S"
mkdir -p "$S"
cp -r "$REPO/test/kg/fixtures/corpus/." "$S/"

cd "$S"
sed -i 's#baseIri: https://example.com/kg/#baseIri: https://acme.dev/#' manni.config.yaml
git init -q -b main
git config user.name "Sam Rivera"
git config user.email sam@example.com
git config core.autocrlf false
git add -A
GIT_AUTHOR_DATE=2026-09-14T09:00:00Z GIT_COMMITTER_DATE=2026-09-14T09:00:00Z \
  git commit -qm "docs: the product docs"

# T is `manni` as typed in the video: the built CLI, told stdout/stderr are a TTY.
T=(node -r "$REPO/media/capture/tty.cjs" "$REPO/dist/cli.js")
IRI=https://acme.dev/doc/docs/configuration.md

ms() { date +%s%3N; }
run() { # name, then the command
  local name=$1; shift
  local a b rc=0
  a=$(ms); "$@" > "$C/$name.ans" 2>&1 || rc=$?; b=$(ms)
  echo "$rc" > "$C/$name.exit"
  echo "$name ${rc} $((b - a))ms" >> "$C/latency.txt"
}

: > "$C/latency.txt"

# Beat 1 — the question nobody can answer by reading. grep finds the pages that
# name configuration.md. It cannot find the page that depends on one of those.
run grep grep -rl configuration.md docs/

# Beat 2 — build the graph, then ask it.
run build "${T[@]}" kg build docs/
run traverse "${T[@]}" kg traverse "$IRI" --predicates dcterms:references --impact -d 2

# Beat 3 — the same graph answers "what is broken", and gates CI on it.
run query "${T[@]}" kg query --p kg:brokenLink
a=$(ms); "${T[@]}" kg stats --check > /dev/null 2>&1 && rc=0 || rc=$?; b=$(ms)
echo "$rc" > "$C/stats-check.exit"
echo "stats-check ${rc} $((b - a))ms" >> "$C/latency.txt"

# Three timing runs, so beats.ts can hold output no sooner than the real thing.
for i in 1 2 3; do
  a=$(ms); "${T[@]}" kg build docs/ > /dev/null 2>&1; b=$(ms)
  "${T[@]}" kg traverse "$IRI" --predicates dcterms:references --impact -d 2 > /dev/null 2>&1; c=$(ms)
  "${T[@]}" kg query --p kg:brokenLink > /dev/null 2>&1; d=$(ms)
  "${T[@]}" kg stats --check > /dev/null 2>&1 || true; e=$(ms)
  grep -rl configuration.md docs/ > /dev/null 2>&1; f=$(ms)
  echo "timing$i build $((b - a))ms traverse $((c - b))ms query $((d - c))ms stats $((e - d))ms grep $((f - e))ms" >> "$C/latency.txt"
done

cat "$C/latency.txt"
