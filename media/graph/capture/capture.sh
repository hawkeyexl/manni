#!/usr/bin/env bash
# graph-vocabulary-1x1: build the demo repository and capture every real byte
# the video replays. Run from anywhere after `npm run build` at the repo root:
#   bash media/graph/capture/capture.sh [demo-dir]
# The demo repository is built OUTSIDE this checkout: in the directory given,
# else $GRAPH_DEMO_DIR, else ${TMPDIR:-/tmp}/manni-graph-demo. It is wiped and
# rebuilt on every run.
#
# Input is staged from committed fixtures:
#   - the term page is test/fixtures/term/cli/clean/docs/terms/progressive-lens.md,
#     cut to type, id, label and a one-line definition. Its broader: and
#     alt-labels: are dropped so the set is one term and nothing else can fire.
#     The definition is the fixture's own abstract: line.
#   - the guide is test/fixtures/term/cli/clean/docs/guides/fitting.md with its
#     page-level concepts: moved into a graph: block, the shape of
#     test/fixtures/term/vocabulary/graph-definition.md.
#   - manni.config.yaml is the clean fixture's, with the comment dropped.
#   - graph-1.0.0-proposal.1.json is a byte copy of
#     docs/proposals/0023/schemas/graph/1.0.0-proposal.1.json.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"   # media/graph/capture
MEDIA="$(cd "$HERE/../.." && pwd)"      # media
ROOT="$(cd "$MEDIA/.." && pwd)"         # the checkout
C="$HERE"
S="${1:-${GRAPH_DEMO_DIR:-${TMPDIR:-/tmp}/manni-graph-demo}}"

mkdir -p "$(dirname "$S")"
case "$(cd "$(dirname "$S")" && pwd)/" in
  "$ROOT"/*) echo "capture.sh: the demo repository must be outside $ROOT" >&2; exit 2 ;;
esac

rm -rf "$S"
mkdir -p "$S/docs/terms"

cat > "$S/manni.config.yaml" <<'EOF'
collections:
  - name: site
    paths:
      - "docs/**/*.md"
EOF

cat > "$S/docs/terms/progressive-lens.md" <<'EOF'
---
type: term
id: progressive-lens
label: progressive lens
definition: Lenses that correct presbyopia without a visible line.
---
EOF

cat > "$S/docs/fitting.md" <<'EOF'
---
title: Fitting lenses
graph:
  concepts: [progressive lens]
---
# Fitting lenses
EOF

cp "$ROOT/docs/proposals/0023/schemas/graph/1.0.0-proposal.1.json" "$S/graph-1.0.0-proposal.1.json"

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

# Beat 1: the graph: block names the term, and the check resolves it.
cat docs/terms/progressive-lens.md > "$C/b1-cat-term.txt"
cat docs/fitting.md > "$C/b1-cat-guide.txt"
run b1-term-check "${T[@]}" term check

# Beat 2: the same block spelled kg:.
sed -i 's/^graph:/kg:/' docs/fitting.md
cat docs/fitting.md > "$C/b2-cat-guide.txt"
run b2-term-check "${T[@]}" term check

# Beat 3: back to graph:, with a typo inside the closed block.
sed -i 's/^kg:/graph:/; s/concepts:/concept:/' docs/fitting.md
cat docs/fitting.md > "$C/b3-cat-guide.txt"
run b3-validate "${T[@]}" meta validate -s graph-1.0.0-proposal.1.json docs/fitting.md

# Three timing runs of each manni command, on the same three states.
for i in 1 2 3; do
  sed -i 's/concept:/concepts:/' docs/fitting.md   # back to beat 1's state
  a=$(ms); "${T[@]}" term check > /dev/null 2>&1 || true; b=$(ms)
  sed -i 's/^graph:/kg:/' docs/fitting.md
  c=$(ms); "${T[@]}" term check > /dev/null 2>&1 || true; d=$(ms)
  sed -i 's/^kg:/graph:/; s/concepts:/concept:/' docs/fitting.md
  e=$(ms); "${T[@]}" meta validate -s graph-1.0.0-proposal.1.json docs/fitting.md > /dev/null 2>&1 || true; f=$(ms)
  echo "timing$i b1-term-check $((b - a))ms b2-term-check $((d - c))ms b3-validate $((f - e))ms" >> "$C/latency.txt"
done

# The capture is only as good as its last state: the file must end as beat 3 shows it.
diff "$C/b3-cat-guide.txt" docs/fitting.md
echo "demo repository: $S"
cat "$C/latency.txt"
for f in "$C"/*.exit; do echo "$(basename "$f") $(cat "$f")"; done
