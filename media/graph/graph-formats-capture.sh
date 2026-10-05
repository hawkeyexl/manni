#!/usr/bin/env bash
# graph-formats-1x1: stage the demo repository and capture every real byte the
# video replays. Run from anywhere after `npm run build` at the repo root:
#   bash media/graph/graph-formats-capture.sh
#
# The pages are test/graph/fixtures/formats/ verbatim, config included: one page
# per format graph reads (proposal 0077), linked across formats in both
# directions, plus the pom.xml decoy a walk must never collect. Not one byte of
# a page or of manni.config.yaml is changed, so the graph on screen is the graph
# CI builds.
#
# The demo repository is media/scratch-formats/ (gitignored), with its own
# `git init` and one commit by a pinned author and date. graph build reads git
# history; a corpus with none would print a no-history notice on stderr, and a
# corpus inside the manni worktree would stamp manni's own commits.
#
# Why every build is typed with `> /dev/null`: `graph build` prints the absolute
# path it wrote (src/graph/commands/build.ts resolves `out` against cwd), and
# from media/scratch-formats/ that path is one 118-character token. No phone-legible
# font size can show it without splitting the token (design.md check 2). The
# redirect drops stdout only, so any warning build writes to stderr still lands
# on screen; the stdout line is kept in capture-formats/*.stdout for the record.
# The counts are read back with `graph stats`, which is the same graph.
set -euo pipefail
cd "$(dirname "$0")/.."            # media/
ROOT="$(cd .. && pwd)"
C="$(pwd)/graph/capture-formats"
S=scratch-formats
mkdir -p "$C"
rm -rf "$S" && mkdir "$S"
cp -r "$ROOT/test/graph/fixtures/formats/." "$S/"
# The claim that the staged pages are the fixture, checked rather than asserted.
diff -r "$ROOT/test/graph/fixtures/formats" "$S" \
  && echo "staged pages == test/graph/fixtures/formats/ (byte for byte)" > "$C/staging.txt"

cd "$S"
git init -q -b main
git config user.name "Sam Rivera"
git config user.email sam@example.com
git config core.autocrlf false
git add -A
GIT_AUTHOR_DATE=2026-10-01T09:00:00Z GIT_COMMITTER_DATE=2026-10-01T09:00:00Z \
  git commit -qm "docs: one page per format"
ls -1 >> "$C/staging.txt"

# T is `manni` as typed in the video: the built CLI, told stdout/stderr are a TTY.
T=(node -r "$ROOT/media/capture/tty.cjs" "$ROOT/dist/cli.js")
IRI=https://example.com/formats/doc/index.md
git -C "$ROOT" rev-parse --short HEAD > "$C/build-commit.txt"
node -p process.version > "$C/node-version.txt"

ms() { date +%s%3N; }
# build NAME [args]: what the typed `manni graph build ... > /dev/null` shows is
# its stderr; stdout goes to NAME.stdout for the record.
build() {
  local name=$1; shift
  local a b rc=0
  a=$(ms); "${T[@]}" graph build "$@" > "$C/$name.stdout" 2> "$C/$name.ans" || rc=$?; b=$(ms)
  echo "$rc" > "$C/$name.exit"
  echo "$name ${rc} $((b - a))ms" >> "$C/latency.txt"
}
stats() { # NAME: `manni graph stats --top 6 | head -13`
  local a b rc=0
  a=$(ms); { "${T[@]}" graph stats --top 6 | head -13; } > "$C/$1.ans" 2>&1 || rc=$?; b=$(ms)
  echo "$rc" > "$C/$1.exit"
  echo "$1 ${rc} $((b - a))ms" >> "$C/latency.txt"
}

: > "$C/latency.txt"

# Beat 1: the extension set graph walked before 0077 (DEFAULT_EXTENSIONS at
# 59fd1ea5), passed explicitly to today's build.
build build-md --ext .md,.mdx,.markdown
stats stats-md

# Beat 2: the same build with no --ext, which now walks every format lint parses.
build build-all
stats stats-all

# Beat 3: who depends on the Markdown page. --predicates dcterms:references keeps
# the walk to links; without it the build activity's prov:used edge to every
# document is in the answer too.
a=$(ms); rc=0
"${T[@]}" graph traverse "$IRI" --predicates dcterms:references --impact > "$C/traverse.ans" 2>&1 || rc=$?
b=$(ms); echo "$rc" > "$C/traverse.exit"; echo "traverse ${rc} $((b - a))ms" >> "$C/latency.txt"

# Three timing runs, so beats.ts holds output no sooner than the real thing.
for i in 1 2 3; do
  a=$(ms); "${T[@]}" graph build --ext .md,.mdx,.markdown > /dev/null 2>&1; b=$(ms)
  "${T[@]}" graph stats --top 6 > /dev/null 2>&1; c=$(ms)
  "${T[@]}" graph build > /dev/null 2>&1; d=$(ms)
  "${T[@]}" graph stats --top 6 > /dev/null 2>&1; e=$(ms)
  "${T[@]}" graph traverse "$IRI" --predicates dcterms:references --impact > /dev/null 2>&1; f=$(ms)
  echo "timing$i build-md $((b - a))ms stats-md $((c - b))ms build-all $((d - c))ms stats-all $((e - d))ms traverse $((f - e))ms" >> "$C/latency.txt"
done
cat "$C/latency.txt"
