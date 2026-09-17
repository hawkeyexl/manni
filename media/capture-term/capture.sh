#!/usr/bin/env bash
# term-vale-1x1: build the demo repository and capture every real byte the
# video replays. Run from anywhere after `npm run build` at the repo root, with
# Vale and ttyd on PATH:
#   bash media/capture-term/capture.sh
# Input is staged from test/fixtures/term/cli/failing (the progressive lens
# entry with PAL and no-line bifocal, and the fitting guide), held as a term
# manifest rather than term pages so the whole glossary is one short file.
set -euo pipefail
cd "$(dirname "$0")/.."
C="$(pwd)/capture-term"
S=scratch-term
rm -rf "$S" && mkdir -p "$S/docs" "$S/styles"
# Git keeps no empty directory, and the timing runs reset to the commit.
touch "$S/styles/.gitkeep"

cat > "$S/manni.config.yaml" <<'EOF'
term:
  manifests: [glossary.yaml]
EOF

cat > "$S/glossary.yaml" <<'EOF'
progressive-lens:
  label: progressive lens
  alt-labels: [PAL]
  hidden-labels: [no-line bifocal]
  definition: A lens whose power rises with no line.
corrective-lens:
  label: corrective lens
  definition: A lens worn to correct the eye.
EOF

cat > "$S/docs/fitting.md" <<'EOF'
# Fitting lenses

Ask your optician about a PAL.
A no-line bifocal hides the join.
Most Progressive Lens wearers adapt fast.
EOF

cat > "$S/.vale.ini" <<'EOF'
StylesPath = styles

[*.md]
BasedOnStyles = Vale
EOF

cd "$S"
git init -q -b main
git config user.name "Sam Rivera"
git config user.email sam@example.com
git add -A
GIT_AUTHOR_DATE=2026-09-16T10:00:00Z GIT_COMMITTER_DATE=2026-09-16T10:00:00Z git commit -qm "docs: glossary and fitting guide"

# T is `manni` as typed in the video: the built CLI, told stdout/stderr are a TTY.
T=(node -r ../capture/tty.cjs ../../dist/cli.js)
ms() { date +%s%3N; }
run() { # name, then the command
  local name=$1; shift
  local a b rc=0
  a=$(ms); "$@" > "$C/$name.ans" 2>&1 || rc=$?; b=$(ms)
  echo "$rc" > "$C/$name.exit"
  echo "$name ${rc} $((b - a))ms" >> "$C/latency.txt"
}

: > "$C/latency.txt"
cat glossary.yaml > "$C/cat-glossary.txt"
cat docs/fitting.md > "$C/cat-guide.txt"
run write-vale "${T[@]}" term write -f vale
cat styles/Terms/PAL.yml > "$C/cat-pal.txt"
ls styles/Terms > "$C/ls-terms.txt"
sed -i 's/= Vale$/= Vale, Terms/' .vale.ini
cat .vale.ini > "$C/cat-vale-ini.txt"

# Vale colours only on a terminal and has no flag to force it. The coloured
# bytes come from a real pseudo-terminal (pty.mjs, through ttyd). The plain run
# beside it gives the exit code, the latency, and the text the pty capture is
# checked against.
run vale-plain vale docs/fitting.md
node ../capture-term/pty.mjs "$C/vale-pty.raw" "vale docs/fitting.md"
node ../capture-term/pty-screen.mjs

run write-md "${T[@]}" term write -f markdown -o docs/terms/
ls docs/terms > "$C/ls-pages.txt"
cat docs/terms/progressive-lens.md > "$C/cat-page.txt"

# Three timing runs on the same repository, reset between runs.
for i in 1 2 3; do
  git reset -q --hard && git clean -fdq
  a=$(ms); "${T[@]}" term write -f vale > /dev/null 2>&1; b=$(ms)
  sed -i 's/= Vale$/= Vale, Terms/' .vale.ini
  c=$(ms); vale docs/fitting.md > /dev/null 2>&1 || true; d=$(ms)
  "${T[@]}" term write -f markdown -o docs/terms/ > /dev/null 2>&1; e=$(ms)
  echo "timing$i write-vale $((b - a))ms vale $((d - c))ms write-md $((e - d))ms" >> "$C/latency.txt"
done
cat "$C/latency.txt"
