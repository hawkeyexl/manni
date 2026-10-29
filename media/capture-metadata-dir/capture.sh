#!/usr/bin/env bash
# metadata-dir-1x1: build the demo repository and capture every real byte the video
# replays. Run from anywhere after `npm run build` at the repo root:
#   bash media/capture-metadata-dir/capture.sh
#
# Staging, disclosed: the input is written here, not copied from a fixture. It is
# the smallest repository that shows proposal 0126, modelled on
# test/fixtures/external-metadata-dir/relocate-from/: one page, docs/guide.md,
# with no id, and its per-page manifest docs/guide.meta.yaml holding personas
# and owner. manni.config.yaml gives the collection that manifest with
# `externalMetadata: - file: "{page}.meta.yaml"`, and page.schema.json marks the
# two fields x-manni-location: external. The schema does not declare id: a
# schema that does gives id a meaning of its own, and relocate then refuses to
# mint one ("set one by hand").
#
# The repository is media/scratch-metadata-dir/ (gitignored, its own git), so
# config discovery stops there and never reaches manni's own manni.config.yaml.
# manni prints only relative paths here, so no junction is needed.
set -euo pipefail
cd "$(dirname "$0")/.."
MEDIA="$(pwd)"
C="$MEDIA/capture-metadata-dir"
S="$MEDIA/scratch-metadata-dir"

if [ -e "$MEDIA/elsewhere" ]; then echo "capture.sh: media/elsewhere exists; beat 6 needs it missing" >&2; exit 2; fi

build_repo() {
  rm -rf "$S" && mkdir -p "$S/docs"
  cd "$S"
  cat > manni.config.yaml <<'EOF'
collections:
  - name: site
    paths: ["docs/*.md"]
    externalMetadata:
      - file: "{page}.meta.yaml"
meta:
  defaults: false
  schemas: [./page.schema.json]
EOF
  cat > page.schema.json <<'EOF'
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "required": ["title", "owner"],
  "properties": {
    "title": { "type": "string", "x-manni-location": "page" },
    "personas": { "type": "array", "items": { "type": "string" }, "x-manni-location": "external" },
    "owner": { "type": "string", "x-manni-location": "external" }
  }
}
EOF
  printf -- '---\ntitle: Guide\n---\n\n# Guide\n' > docs/guide.md
  printf 'docs/guide.md:\n  personas: [maya]\n  owner: ada\n' > docs/guide.meta.yaml
  git init -q -b main
  git config user.name "Sam Rivera"
  git config user.email sam@example.com
  git config core.autocrlf false
  git add -A
  GIT_AUTHOR_DATE=2026-10-29T09:00:00Z GIT_COMMITTER_DATE=2026-10-29T09:00:00Z \
    git commit -qm "docs: the guide, with its metadata beside it"
}

# T is `manni` as typed in the video: the built CLI, told stdout/stderr are a TTY.
T=(node -r "$MEDIA/capture/tty.cjs" "$MEDIA/../dist/cli.js")
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

# timed NAME CMD...: a command that prints nothing to keep (git mv, cat), its
# wall-clock milliseconds in latency.txt.
timed() {
  local name=$1; shift
  local a b; a=$(ms); "$@"; b=$(ms)
  echo "$name $((b - a))ms" >> "$C/latency.txt"
}

# run PREFIX: the whole session once, every capture named PREFIX<name>.
run() {
  local p=$1
  build_repo
  # Beat 1: the page's metadata beside it, keyed by the page's path.
  timed "${p}cat-sidecar" cat docs/guide.meta.yaml > "$C/${p}cat-sidecar.txt"
  # Beat 2: rename the page; the whole-corpus run stops on the stranded manifest.
  # Typed as `manni meta validate; echo $?`.
  timed "${p}git-mv" git mv docs/guide.md docs/getting-started.md
  stamped "${p}validate-orphan" "${T[@]}" meta validate
  # Beat 3: undo the rename, then empty the manifest into metadata/.
  # Typed as `manni meta relocate --from "{page}.meta.yaml"`.
  timed "${p}git-mv-back" git mv docs/getting-started.md docs/guide.md
  stamped "${p}relocate" "${T[@]}" meta relocate --from "{page}.meta.yaml"
  git status --short > "$C/${p}status.txt"
  cat manni.config.yaml > "$C/${p}config-after.txt"
  # Beat 4: the manifest, named by the id relocate minted into the page.
  # cat-page.txt is the record of that id line; the video does not show it.
  cat docs/guide.md > "$C/${p}cat-page.txt"
  timed "${p}cat-manifest" cat metadata/guide.yaml > "$C/${p}cat-manifest.txt"
  # Beat 5: rename again. Typed as `manni meta validate; echo $?`, then get.
  timed "${p}git-mv-again" git mv docs/guide.md docs/getting-started.md
  stamped "${p}validate-renamed" "${T[@]}" meta validate
  stamped "${p}get" "${T[@]}" meta get docs/getting-started.md --fields owner
  # Beat 6: the directory moved to a checkout that is not there.
  # Typed as `MANNI_EXTERNAL_METADATA_DIR=../elsewhere manni meta validate; echo $?`.
  MANNI_EXTERNAL_METADATA_DIR=../elsewhere stamped "${p}env-missing" "${T[@]}" meta validate
  cd "$MEDIA"
}

rm -f "$C"/*.ans "$C"/*.exit "$C"/*.stamped "$C"/*.txt
: > "$C/latency.txt"
node "$MEDIA/../dist/cli.js" --version > "$C/version.txt"
run ""
# Three timing runs, each on a freshly built repository.
for i in 1 2 3; do run "timing$i-"; done
rm -f "$C"/timing*
# Leave the scratch repository in the state the capture run ended in.
build_repo && cd "$S"
git mv docs/guide.md docs/getting-started.md
git mv docs/getting-started.md docs/guide.md
"${T[@]}" meta relocate --from "{page}.meta.yaml" > /dev/null 2>&1
git mv docs/guide.md docs/getting-started.md
cat "$C/latency.txt"
