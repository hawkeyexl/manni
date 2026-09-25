#!/usr/bin/env bash
# manni-vocabularies-1x1: build the demo directory and capture every real byte
# the video replays. Run from anywhere after `npm run build` at the repo root:
#   bash media/vocabularies/capture/capture.sh [demo-dir]
# The demo directory is built OUTSIDE this checkout, so the repo's own
# manni.config.yaml is never discovered: in the directory given, else
# $VOCAB_DEMO_DIR, else ${TMPDIR:-/tmp}/manni-vocabularies-demo. It is wiped and
# rebuilt on every run, which also means fill's proposal cache
# (.manni/meta/cache under the project root) starts cold.
#
# Input is staged from one committed fixture and nothing else:
#   - page.md is a byte copy of test/fixtures/missing-description.md. It carries
#     `type: guide` because google:okf:0.1, also in the default set, requires
#     `type`. Without it the first validate would report two missing keys, and
#     this video is about the one manni:core:1.0.0 adds.
#   - there is no manni.config.yaml and no -s, so every run uses the default
#     schema set.
#
# fill runs a real model. The provider is not named: `auto` picks the claude
# CLI on the capture machine, and the run says so on stderr. Its proposals are
# whatever that run returned; rerunning this script gives different wording.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"   # media/vocabularies/capture
MEDIA="$(cd "$HERE/../.." && pwd)"      # media
ROOT="$(cd "$MEDIA/.." && pwd)"         # the checkout
C="$HERE"
S="${1:-${VOCAB_DEMO_DIR:-${TMPDIR:-/tmp}/manni-vocabularies-demo}}"

mkdir -p "$(dirname "$S")"
case "$(cd "$(dirname "$S")" && pwd)/" in
  "$ROOT"/*) echo "capture.sh: the demo directory must be outside $ROOT" >&2; exit 2 ;;
esac

rm -rf "$S"
mkdir -p "$S"
cp "$ROOT/test/fixtures/missing-description.md" "$S/page.md"
git -C "$S" init -q

# T is `manni` as typed in the video: the built CLI of this checkout (the same
# file media/bin/manni execs), told that stdout and stderr are a terminal so it
# colours as it would in one. Nothing else changes.
T=(node -r "$MEDIA/capture/tty.cjs" "$ROOT/dist/cli.js")
ms() { date +%s%3N; }
run() { # name, then the command. Output and exit code saved, latency logged.
  local name=$1; shift
  local a b rc=0
  a=$(ms); "$@" > "$C/$name.ans" 2>&1 || rc=$?; b=$(ms)
  echo "$rc" > "$C/$name.exit"
  echo "$name exit=${rc} $((b - a))ms" >> "$C/latency.txt"
}

cd "$S"
: > "$C/latency.txt"
node --version > "$C/node-version.txt"
git -C "$ROOT" rev-parse --short HEAD > "$C/build-commit.txt"

FIELDS=description,audiences,lifecycle

# Beat 1: a page with a title and no description.
cat page.md > "$C/b1-cat-page.txt"

# Beat 2: a bare validate. The default set now includes manni:core:1.0.0.
run b2-validate "${T[@]}" meta validate page.md

# Beat 3: fill, under bash's `time`, whose three lines are part of the capture
# and disclose the real wait the replay compresses.
rc=0
{ time "${T[@]}" meta fill page.md --fields "$FIELDS" ; } > "$C/b3-fill.ans" 2>&1 || rc=$?
echo "$rc" > "$C/b3-fill.exit"
echo "b3-fill exit=${rc} $(grep -a '^real' "$C/b3-fill.ans" | tr '\t' ' ')" >> "$C/latency.txt"

# Beat 4: the frontmatter, down to the last filled field. The line count is
# read from the file, and the video types the number this computes.
N=$(grep -n '^lifecycle:' page.md | cut -d: -f1)
echo "$N" > "$C/b4-head-n.txt"
head -n "$N" page.md > "$C/b4-head-page.txt"
cp page.md "$C/b4-page-full.txt"   # the whole file, for the record; not replayed

# Beat 5: the same bare validate, now passing.
run b5-validate "${T[@]}" meta validate page.md

# Three timing runs of validate on each state (fill is timed by `time` above).
cp "$ROOT/test/fixtures/missing-description.md" "$S/before.md"
for i in 1 2 3; do
  a=$(ms); "${T[@]}" meta validate before.md > /dev/null 2>&1 || true; b=$(ms)
  c=$(ms); "${T[@]}" meta validate page.md > /dev/null 2>&1 || true; d=$(ms)
  echo "timing$i b2-validate $((b - a))ms b5-validate $((d - c))ms" >> "$C/latency.txt"
done
rm before.md

echo "demo directory: $S"
cat "$C/latency.txt"
for f in "$C"/*.exit; do echo "$(basename "$f") $(cat "$f")"; done
