#!/usr/bin/env bash
# a11y-exclude-1x1: capture every real byte the video replays.
#
# Unlike the other demos, this one has no scratch repository. The material is
# this repository's own docs site, served by `astro preview`, and the seed URL
# comes from `manni.config.yaml`'s `site` collection, which is why the typed
# command carries no URL. That is the same command the Docs workflow's a11y
# job runs.
#
# Before running, from the repo root:
#   npm ci && npm run build
#   cd docs && npm ci && npm run build
#   npx astro preview --host 127.0.0.1 --port 4321     # answers at /manni/
#
# Then, from the repo root:
#   bash media/capture-a11y/capture.sh
#
# Staging, disclosed because design.md's "Honesty" section requires it:
#
#   The built site ships `sitemap-index.xml`, whose every `<loc>` is a
#   production `hawkeyexl.github.io` URL. Against a local preview it parses and
#   yields nothing, so the run reports `sitemap: <url>, 0 pages; followed
#   links` — 106 characters of header, three wrapped rows in a 1080 square, all
#   of it about a sitemap that contributed no pages. This script moves the two
#   sitemap files out of `docs/dist` for the duration of the capture and puts
#   them back afterwards. Discovery is unchanged: link-following found all 101
#   pages either way (checked, both ways, before the capture). Nothing about
#   `--exclude` depends on a sitemap.
#
# The three runs are real, uncapped and cold. Each full crawl is a real browser
# over 101 and 67 pages, so this script takes about four minutes.
set -euo pipefail
cd "$(dirname "$0")/../.."
C="$(pwd)/media/capture-a11y"
DIST="$(pwd)/docs/dist"
ASIDE="$C/.sitemap-aside"

mkdir -p "$ASIDE"
restore() { mv "$ASIDE"/sitemap-*.xml "$DIST/" 2>/dev/null || true; rmdir "$ASIDE" 2>/dev/null || true; }
trap restore EXIT
mv "$DIST"/sitemap-*.xml "$ASIDE/"

# T is `manni` as typed in the video: the built CLI, told stdout/stderr are a
# TTY, so the colour a terminal receives is the colour the capture holds.
T=(node -r ./media/capture/tty.cjs dist/cli.js)

: > "$C/latency.txt"
run() { # name, then the command; `time` output is part of the capture
  local name=$1; shift
  local rc=0
  { time "$@" ; } > "$C/$name.ans" 2>&1 || rc=$?
  echo "$rc" > "$C/$name.exit"
  echo "$name exit $rc" >> "$C/latency.txt"
  grep -a '^real' "$C/$name.ans" >> "$C/latency.txt" || true
}
runPlain() { # same, without `time`: for a command whose own latency is the point
  local name=$1; shift
  local a b rc=0
  a=$(date +%s%3N); "$@" > "$C/$name.ans" 2>&1 || rc=$?; b=$(date +%s%3N)
  echo "$rc" > "$C/$name.exit"
  echo "$name exit $rc $((b - a))ms" >> "$C/latency.txt"
}

# 1. The whole site, as the Docs workflow checks it today.
run full "${T[@]}" a11y check -q --no-progress

# 2. The same run with the reference shelf out of the crawl.
run excluded "${T[@]}" a11y check -q --no-progress --exclude "/manni/meta/reference/**"

# 3. A pattern that excludes its own seed. Refused before anything is fetched,
#    so its own half second is the whole story and `time` would only add noise.
#    Progress is on here (the preload says stdout is a terminal), so the spinner
#    erases its own line with `\r\x1b[2K` before the refusal prints. That erase
#    is applied when the capture is converted; see remotion/scripts/captures-a11y.mjs.
runPlain seed-clash "${T[@]}" a11y check http://127.0.0.1:4321/manni/meta/reference/ --exclude "/manni/meta/reference/**"

# 4. The excluded run again as JSON. Not replayed in the video; it is what the
#    footer's `34 excluded` is checked against, as `summary.excluded`.
"${T[@]}" a11y check --no-progress -f json --exclude "/manni/meta/reference/**" > "$C/excluded.json" 2>/dev/null || true

cat "$C/latency.txt"
