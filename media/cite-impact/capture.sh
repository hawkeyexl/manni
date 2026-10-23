#!/usr/bin/env bash
# cite-impact-1x1: capture every real byte the video replays.
# Run from the repo root after `npm run build`:
#   bash media/cite-impact/capture.sh
#
# The demo repository is media/scratch-cite-impact/ (gitignored by
# media/scratch-*/), staged from test/fixtures/cite/impact/: two records under
# strategy/ (persona maya, journeys m5 and m6), src/value.ts, and pages whose
# {page}.meta.yaml sidecars name the records. Three edits make it a clean
# starting point, all to the input:
#   - the fixture's stale.md carries an all-zero source hash; it gets the real
#     one (clean.md's), so the run starts green, and is renamed pages/guide.md;
#   - clean.md is renamed pages/config.md;
#   - unnamed.md and the two alternate configs, which test other paths, go.
# The guide's sidecar names maya and m5 only (the fixture adds M5 and m99 to
# test case folding and unknown ids). The config page's names maya and m6.
# Both pages pin line 1 of src/value.ts, so one edit there stales both.
set -euo pipefail
cd "$(dirname "$0")/../.."
REPO="$(pwd)"
C="$REPO/media/cite-impact"
DEMO="$REPO/media/scratch-cite-impact"
ZERO=sha256-0000000000000000000000000000000000000000000000000000000000000000
REAL=sha256-fbb9581aeceea2275ca30c7996fde9dbeb12aa0b1b8fc330c5e5d68620a663a1

rm -rf "$DEMO"
mkdir -p "$DEMO/pages"
cp -r test/fixtures/cite/impact/manni.config.yaml test/fixtures/cite/impact/src test/fixtures/cite/impact/strategy "$DEMO/"
sed -e "s/$ZERO/$REAL/" -e 's/^title: Stale$/title: Guide/' -e 's/^# Stale$/# Guide/' \
  test/fixtures/cite/impact/pages/stale.md > "$DEMO/pages/guide.md"
sed -e 's/^title: Clean$/title: Config/' -e 's/^# Clean$/# Config/' \
  test/fixtures/cite/impact/pages/clean.md > "$DEMO/pages/config.md"
printf 'pages/guide.md:\n  personas: [maya]\n  journeys: [m5]\n' > "$DEMO/pages/guide.meta.yaml"
printf 'pages/config.md:\n  personas: [maya]\n  journeys: [m6]\n' > "$DEMO/pages/config.meta.yaml"
cd "$DEMO"
git init -q
git add .
git -c user.name=demo -c user.email=demo@example.com commit -qm "docs and source"

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

# Beat 1: the page's sidecar names its readers, and the pins are current.
cat pages/guide.meta.yaml > "$C/cat-sidecar.txt"
run check-before "${T[@]}" cite check

# Beat 2: one source line changes. git colours its diff on a terminal; the
# capture is a file, so color.ui=always stands in for the terminal.
sed -i 's/TIMEOUT_SECONDS = 10;/TIMEOUT_SECONDS = 30;/' src/value.ts
run diff git -c color.ui=always diff src/value.ts

# Beat 3: the CI format, then its exit code.
run github "${T[@]}" cite check -f github pages/guide.md

# Beat 4: the pretty report, quiet, with its roll-up.
run pretty "${T[@]}" cite check -q

"${T[@]}" --version > "$C/version.txt"
cat "$C/latency.txt"
