#!/usr/bin/env bash
# lint-templates-infer-1x1: build the demo repository and capture every real
# byte the video replays. Run from anywhere after `npm run build` at the repo
# root:
#   bash media/lint-templates/capture/capture.sh
#
# The page is test/lint/fixtures/formats/how-to.md, copied under the name the
# video types. Beat 5 deletes its `## See also` section in place, and the
# result is checked byte for byte against the repo's own
# test/lint/fixtures/formats/how-to-broken.md, so the "broken" page in the
# video is the fixture CI lints.
set -euo pipefail
cd "$(dirname "$0")/../.."      # media/
ROOT="$(cd .. && pwd)"
C="$(pwd)/lint-templates/capture"
S=scratch-lint
rm -rf "$S" && mkdir -p "$S/docs"

cp "$ROOT/test/lint/fixtures/formats/how-to.md" "$S/docs/rotate-key.md"

# Staged and not shown: it makes `manni lint structure docs/rotate-key.md` find
# templates.yaml with no --templates flag, so the typed command never changes
# across beats 2, 4 and 5. Only the template under it changes.
cat > "$S/manni.config.yaml" <<'EOF'
lint:
  templates: [templates.yaml]
EOF

# The hand-started template: one section, written by someone who has not
# finished. This is the wall beat 2 shows.
cat > "$S/templates.yaml" <<'EOF'
templates:
  how-to:
    types: [how-to]
    sections:
      - id: overview
        heading: Overview
EOF

cd "$S"
git init -q -b main
git config user.name "Sam Rivera"
git config user.email sam@example.com
git add -A
GIT_AUTHOR_DATE=2026-09-20T10:00:00Z GIT_COMMITTER_DATE=2026-09-20T10:00:00Z \
  git commit -qm "docs: how-to page and a half-written template"

# T is `manni` as typed in the video: the built CLI, told stdout/stderr are a TTY.
T=(node -r ../capture/tty.cjs "$ROOT/dist/cli.js")
ms() { date +%s%3N; }
run() { # name, then the command
  local name=$1; shift
  local a b rc=0
  a=$(ms); "$@" > "$C/$name.ans" 2>&1 || rc=$?; b=$(ms)
  echo "$rc" > "$C/$name.exit"
  echo "$name ${rc} $((b - a))ms" >> "$C/latency.txt"
}

: > "$C/latency.txt"
cat docs/rotate-key.md > "$C/cat-page.txt"
cat templates.yaml > "$C/cat-stub.txt"

# Beat 2: the wall.
run lint-wall "${T[@]}" lint structure docs/rotate-key.md

# Beat 3: infer to stdout.
run infer-stdout "${T[@]}" lint templates infer docs/rotate-key.md

# Beat 4: infer over the stub, then the same lint command.
run infer-write "${T[@]}" lint templates infer docs/rotate-key.md -o templates.yaml --force
cat templates.yaml > "$C/cat-inferred.txt"
run lint-pass "${T[@]}" lint structure docs/rotate-key.md

# Beat 5: break the page, lint again.
sed -i '/^## See also/,$d' docs/rotate-key.md
# The range delete leaves the blank line that separated the section, which the
# fixture does not carry. Ignoring trailing blank lines on both sides, the page
# the video lints is byte for byte the fixture CI lints. This check is the claim.
diff <(sed -e :a -e '/^\n*$/{$d;N;ba' -e '}' docs/rotate-key.md) \
     <(sed -e :a -e '/^\n*$/{$d;N;ba' -e '}' "$ROOT/test/lint/fixtures/formats/how-to-broken.md") \
  && echo "broken page == test/lint/fixtures/formats/how-to-broken.md (trailing blank lines aside)" >> "$C/latency.txt"
run lint-broken "${T[@]}" lint structure docs/rotate-key.md

# Three timing runs on the same repository, reset between runs.
for i in 1 2 3; do
  git reset -q --hard && git clean -fdq
  a=$(ms); "${T[@]}" lint structure docs/rotate-key.md > /dev/null 2>&1 || true; b=$(ms)
  "${T[@]}" lint templates infer docs/rotate-key.md > /dev/null 2>&1; c=$(ms)
  "${T[@]}" lint templates infer docs/rotate-key.md -o templates.yaml --force > /dev/null 2>&1; d=$(ms)
  echo "timing$i lint $((b - a))ms infer-stdout $((c - b))ms infer-write $((d - c))ms" >> "$C/latency.txt"
done
cat "$C/latency.txt"
