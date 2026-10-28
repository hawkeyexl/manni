#!/usr/bin/env bash
# flare-site-1x1: build the demo repository and capture every real byte the video
# replays. Run from anywhere after `npm run build` at the repo root:
#   bash media/capture-flare-site/capture.sh
#
# Staging, disclosed: the input is test/fixtures/flare/widget/ as committed at
# HEAD, a tiny MadCap Flare project, copied unchanged through `git archive` so no
# untracked cache from a test run comes along. It holds Widget.flprj, two topics
# under Content/, and two targets, HTML5 and Print, under Project/Targets/. Its
# manni.config.yaml sets tools.flare.target: HTML5.
#
# madbuild is a stand-in, not MadCap Flare. This machine has no Flare and no
# license. test/fixtures/flare/madbuild-standin/ is a few lines of Node that copy
# each topic as written and write a Default.htm linking them, and its one output
# line says "stand-in madbuild". Its folder is put first on PATH in its POSIX
# form: Git Bash splits a C:/... entry at the colon, and the stand-in is then
# not found. manni finds `madbuild` on PATH as it would find the real one.
#
# USERNAME=maya. madbuild stamps the account that runs it into the output path,
# Output/<account>/<target>. manni reads USERNAME, then the OS account
# (src/site/core/detect.ts), and the stand-in reads the same two in the same
# order, so both say Output/maya/HTML5, the account the docs use.
#
# The repository is media/scratch-flare-site/ (gitignored, its own git), so
# config discovery stops there and never reaches manni's own manni.config.yaml.
#
# Every command runs with C:\widget as its working directory: a directory
# junction to media/scratch-flare-site/, as in flare-resources, so any path
# manni prints stays short. The junction is removed at the end; it holds no
# files of its own. cwd.cjs starts the CLI in C:\widget as spelled.
set -euo pipefail
cd "$(dirname "$0")/.."
MEDIA="$(pwd)"
C="$MEDIA/capture-flare-site"
S="$MEDIA/scratch-flare-site"
J=/c/widget
JW='C:\widget'
PORT=4321

if netstat -ano 2>/dev/null | grep -qE ":$PORT .*LISTEN"; then
  echo "capture.sh: port $PORT is in use; stop that server first" >&2; exit 2
fi

rm -rf "$S" && mkdir -p "$S"
git -C "$MEDIA/.." archive HEAD test/fixtures/flare/widget | tar -x -C "$S" --strip-components=4
cd "$S"
git init -q -b main
git config user.name "Sam Rivera"
git config user.email sam@example.com
git config core.autocrlf false
git add -A
GIT_AUTHOR_DATE=2026-10-28T09:00:00Z GIT_COMMITTER_DATE=2026-10-28T09:00:00Z \
  git commit -qm "docs: widget help, from Flare"

if [ -e "$J" ]; then echo "capture.sh: $JW exists; remove it and rerun" >&2; exit 2; fi
MSYS2_ARG_CONV_EXCL='*' cmd /c mklink /J "$JW" "$(cygpath -w "$S")" > /dev/null
stop_preview() {
  local pid
  pid=$(netstat -ano 2>/dev/null | grep -E ":$PORT .*LISTEN" | awk '{print $NF}' | head -1 || true)
  if [ -n "$pid" ]; then taskkill //F //T //PID "$pid" > /dev/null 2>&1 || true; fi
}
trap 'stop_preview; MSYS2_ARG_CONV_EXCL="*" cmd /c rmdir "$JW"' EXIT
cd "$J"

export PATH="$MEDIA/../test/fixtures/flare/madbuild-standin:$PATH"
export USERNAME=maya
# T is `manni` as typed in the video: the built CLI, told stdout/stderr are a TTY.
export DEMO_CWD="$JW"
T=(node -r "$C/cwd.cjs" -r "$MEDIA/capture/tty.cjs" "$MEDIA/../dist/cli.js")
ms() { date +%s%3N; }
# stamped NAME CMD...: each output line with its millisecond after Enter, the exit
# code in NAME.exit, and the bytes alone in NAME.ans.
stamped() {
  local name=$1; shift
  local t0; t0=$(ms)
  { rc=0; "$@" 2>&1 || rc=$?; echo "$rc" > "$C/$name.exit"; } |
    while IFS= read -r line; do printf '%s\t%s\n' "$(( $(ms) - t0 ))" "$line"; done > "$C/$name.stamped"
  echo "$name exit $(cat "$C/$name.exit") $(( $(ms) - t0 ))ms" >> "$C/latency.txt"
  cut -f1 "$C/$name.stamped" | tr '\n' ' ' | sed 's/^/  line ms: /;s/ $/\n/' >> "$C/latency.txt"
  cut -f2- "$C/$name.stamped" > "$C/$name.ans"
}
# The replay's column count for beat 1 (cols.mjs). On a terminal, ls lays its
# names out in columns to the terminal's width; -C -w is that layout, written to
# a file, and -T 0 pads with spaces where a terminal would draw tabs. Typed on
# screen as `ls`.
COLS=72

rm -f "$C"/*.ans "$C"/*.exit "$C"/*.stamped "$C"/*.txt "$C"/timing*
: > "$C/latency.txt"
# Beat 1: the project, and the config line that names the target.
ls -C -T 0 -w "$COLS" > "$C/ls.txt"
tail -n 3 manni.config.yaml > "$C/tail-config.txt"
# Beat 2: build. Typed as `manni site build; echo $?`. manni announces the
# madbuild it runs, then the stand-in prints its one line.
stamped build "${T[@]}" site build
# Beat 3: preview, left running. Typed as `manni site preview`.
t0=$(ms)
( "${T[@]}" site preview 2>&1 | while IFS= read -r line; do printf '%s\t%s\n' "$(( $(ms) - t0 ))" "$line"; done ) > "$C/preview.stamped" &
for _ in $(seq 1 100); do
  grep -aq "127.0.0.1:$PORT" "$C/preview.stamped" 2>/dev/null && break
  sleep 0.1
done
grep -aq "127.0.0.1:$PORT" "$C/preview.stamped" || { echo "preview never answered" >&2; cat "$C/preview.stamped" >&2; exit 1; }
cut -f2- "$C/preview.stamped" > "$C/preview.ans"
echo "preview url at $(cut -f1 "$C/preview.stamped" | head -1)ms" >> "$C/latency.txt"
# Beat 4: a second terminal asks the server for /. Typed as
# `curl -s http://127.0.0.1:4321/ | head -3`. head keeps the XML declaration,
# the html element and the head with its title, "Stand-in build". Whole, the page
# is 11 lines and its two topic links are 82 characters wide. curl.full.txt is
# the whole page, kept as the record of what head dropped.
a=$(ms); curl -s "http://127.0.0.1:$PORT/" > "$C/curl.full.txt"; b=$(ms)
echo "curl $((b - a))ms" >> "$C/latency.txt"
head -3 "$C/curl.full.txt" > "$C/curl.txt"
# Beat 5: start, in the second terminal. Typed as `manni site start; echo $?`.
stamped start "${T[@]}" site start
stop_preview
wait || true

# Three timing runs on the same repository, reset between runs.
for i in 1 2 3; do
  git reset -q --hard && git clean -fdxq
  stamped "timing$i-build" "${T[@]}" site build
  t0=$(ms)
  ( "${T[@]}" site preview 2>&1 | while IFS= read -r line; do printf '%s\t%s\n' "$(( $(ms) - t0 ))" "$line"; done ) > "$C/timing$i-preview.stamped" &
  for _ in $(seq 1 100); do grep -aq "127.0.0.1:$PORT" "$C/timing$i-preview.stamped" 2>/dev/null && break; sleep 0.1; done
  echo "timing$i-preview url at $(cut -f1 "$C/timing$i-preview.stamped" | head -1)ms" >> "$C/latency.txt"
  a=$(ms); curl -s "http://127.0.0.1:$PORT/" > /dev/null; b=$(ms)
  echo "timing$i-curl $((b - a))ms" >> "$C/latency.txt"
  stamped "timing$i-start" "${T[@]}" site start
  stop_preview
  wait || true
done
rm -f "$C"/timing*
git reset -q --hard && git clean -fdxq
cat "$C/latency.txt"
