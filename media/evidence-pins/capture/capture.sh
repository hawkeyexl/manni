#!/usr/bin/env bash
# evidence-pins-1x1: capture every real byte the video replays.
# Run from the repo root after `npm run build`:
#   bash media/evidence-pins/capture/capture.sh
#
# The demo repository is media/scratch-evidence-pins/ (gitignored by
# media/scratch-*/). It is a copy of test/fixtures/strategy/evidence/: an
# audience, a persona theo with two pains, a page, the persona schema that
# requires citations, and a research note. The copy is its own git repository
# with one baseline commit, so cite pins the commit. The note is cited by its
# path in that repository, so the fixture's cite.repos entry goes unused.
set -euo pipefail
cd "$(dirname "$0")/../../.."
REPO="$(pwd)"
C="$REPO/media/evidence-pins/capture"
DEMO="$REPO/media/scratch-evidence-pins"
THEO=records/personas/theo.md
NOTE=research/contributor.md

rm -rf "$DEMO"
mkdir -p "$DEMO"
cp -r test/fixtures/strategy/evidence/. "$DEMO/"
cd "$DEMO"
# One trim: the note moves up out of notes/ and drops its date prefix, which
# its heading still carries. The fixture's 40-character path wrapped every pin
# row at a legible size; research/contributor.md keeps each on one row.
mv research/notes/2026-09-12-contributor.md "$NOTE"
rmdir research/notes
git init -q
git add .
git -c user.name=demo -c user.email=demo@example.com commit -qm "evidence set"

# The tty shim tells the CLI stdout/stderr are a terminal, so the colour a
# terminal receives is the colour the capture holds. Nothing else changes.
TTY="$REPO/media/capture/tty.cjs"
T=(node -r "$TTY" "$REPO/dist/cli.js")

: > "$C/latency.txt"
run() { # name, then the command
  local name=$1; shift
  local rc=0 t0 t1
  t0=$(date +%s%N)
  "$@" > "$C/$name.ans" 2>&1 || rc=$?
  t1=$(date +%s%N)
  echo "$rc" > "$C/$name.exit"
  echo "$name exit $rc $(( (t1 - t0) / 1000000 )) ms" >> "$C/latency.txt"
}

# Beat 1: the persona's claims, as the file holds them.
cat "$THEO" > "$C/cat-persona.txt"

# Beat 2: pin the first pain to line 3 of the research note.
run add "${T[@]}" cite add "$THEO#/pains/0" "$NOTE:3" --id terse-messages

# Beat 3: the pin reads current.
run check-current "${T[@]}" cite check "$THEO"

# Beat 4: swap the two pains. theo.reordered.md (beside this script) is the
# fixture's persona with its two pains in the other order; git shows the edit.
# The pin follows the value, and update rewrites the pointer.
cp "$C/theo.reordered.md" "$THEO"
run diff-persona git -c color.ui=always diff -U1 "$THEO"
run check-moved "${T[@]}" cite check "$THEO"
run update "${T[@]}" cite update "$THEO"

# Beat 5: edit the evidence line the pin rests on. note.edited.md (beside this
# script) is the fixture's note with line 3 rewritten.
cp "$C/note.edited.md" "$NOTE"
run diff-note git -c color.ui=always diff "$NOTE"
run check-changed "${T[@]}" cite check "$THEO"

"${T[@]}" --version > "$C/version.txt"
cat "$C/latency.txt"
