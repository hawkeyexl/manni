# Video script: Field location (`x-manni-location`, `manni meta relocate`)

**Objective:** Show that a schema can say where each value belongs. `page`
is for what ships with the delivered page; `external` is maintainer metadata
that belongs in the collection's external-metadata manifest. `manni meta
validate` warns about a value on the wrong side (`location:external`), with
exit 0, so CI never blocks. `manni meta relocate` moves the values, creates the
manifest and writes the `externalMetadata` entry into `manni.config.yaml`.
Afterwards the page is slim and `validate` is clean.
**Format:** 1080x1080, 30 fps, silent, captions burned in (LinkedIn autoplays muted).
**Duration:** 38.2 s (spec: 20-45 s).
**Audience:** schema authors who decide what a page carries (Sara) and docs
engineers who own the pages (Maya).
**Feature:** proposal 0047, `docs/proposals/0047-field-location.md`.

Visual spec: `docs/content-strategy/design.md`. Accent `#58a6ff` (blue; never
red, green, yellow or cyan, which manni's and git's output use: the warning
sign and `warning` are yellow, field names cyan, the summary green, the diff
red and green). Terminal `#171717`, bands `#0d0d0d`, JetBrains Mono
throughout. Title band 112 px, 2 px accent rules, caption band 86 px.

## How it was made, and what is staged

Everything printed in the terminal is a real run of `cat`, git, or
`node dist/cli.js` built by `npm run build` from this branch's working tree
(`claude/schema-field-location-prefs-705019`, the uncommitted 0047
implementation on top of `88b303a`). The typed command reads `manni`, the name
the shim `media/bin/manni` gives the built CLI.

- **A Remotion replay of real bytes, as in the provenance, collections and
  sidecar videos.** The `location:external` warning is 170 characters. A real
  terminal at any phone-legible size hard-wraps it inside a token, which
  design.md check 2 forbids; the replay wraps at spaces only. So the CLI ran
  under the preload that makes stdout/stderr report as a TTY
  (`media/capture/tty.cjs`), which keeps the colour, and the bytes were saved
  verbatim to `media/capture-location/`. The composition `LocationDemo`
  (`media/remotion/src/location/beats.ts`, shared `src/Demo.tsx`) replays them.
  Typing runs at 35 ms/char, then Enter, then the output after the command's
  **measured** latency. No output byte is edited.
- **One script builds the repository and takes every capture:**
  `media/capture-location/capture.sh`. It is the record of the staging.
- **`media/scratch-location/` is the demo repository.** It has its own
  `git init` (one commit by a pinned author and date), because `media/scratch-*`
  is gitignored in manni and discovery honours `.gitignore`. Nothing was
  committed to manni.
- **Input staged from `test/fixtures/location/relocate-create/`.** Same shape:
  a `site` collection with no `externalMetadata` yet, and a schema marking
  keys. (The collection name `docs` is reserved, so the fixture and the demo use
  `site`.) Two changes, both for legibility. The page carries `description`
  beside `title`, and the three maintainer keys the story needs (`owner`,
  `stakeholders`, `review-interval`) in place of the fixture's `authors` and
  `owner`. The schema drops its `type` keywords and `$schema` line, so the
  longest schema line is 57 characters and fits one row at 28 px. Location
  preferences do not depend on types.
- **`git diff -U1`, not `git diff`.** Full context makes beat 4 26 rows, which
  would force 23 px for the whole video. One context line keeps the hunk
  headers meaningful (`title: Install`, `collections:`) at 21 rows. The diff is
  captured as `git -c color.ui=always --no-pager diff -U1`, reproducing what an
  interactive terminal prints for 19 lines. The bytes are git's.
- **The terminal y/N offer from `validate` is not filmed.** The preload makes
  stdout a TTY, but stdin stays a pipe, so `validate` correctly makes no offer.
  Filming the offer honestly needs a real pty session. The non-interactive
  `relocate` is the primary path anyway, and it is what CI and scripts run.
- **Row highlight is chrome.** A faint accent ground (`#58a6ff` at 16%) sits
  behind the rows a caption is about. The bytes in those rows are untouched.

## Derived font size

`media/capture-location/cols.mjs` runs the space-only wrap over every real line
from 30 px down. The longest real line is 170 characters (the `/review-interval`
warning), and it wraps at spaces. The longest token plus indent is only 37
(`collections[site].externalMetadata[0]`), so height decides the size. The
tallest beat is beat 4, 21 rows. **28 px / 61 columns, 39 px line height** is
the largest size at which it fits the 838 px terminal (819 px), with no orphan
rows. At 29 px it would need 861 px. The read-back from the render is that the
widest row (beat 2, `the page; page.schema.json prefers external metadata. Run`,
exactly 61 characters) ends at x=1045 of 1080.

## Beats (storyboard)

| # | Title (band) | Terminal | Caption (band) | Time |
|---|---|---|---|---|
| 1 | Maintainer data on the page | `cat docs/install.md`, `cat page.schema.json` | owner, stakeholders and review-interval ship with the page. The schema marks them external. | 0:00.0-0:08.1 |
| 2 | validate: warn, don't fail | `manni meta validate`, `echo $?` | validate flags each misplaced value as location:external. Exit 0, so CI never blocks. | 0:08.1-0:16.7 |
| 3 | relocate moves them | `manni meta relocate`, `cat site.metadata.yaml` | relocate creates site.metadata.yaml and moves the three values into it, keyed by page. | 0:16.7-0:25.1 |
| 4 | The page slims down | `git diff -U1` | The page drops three lines. manni.config.yaml now says the manifest owns those keys. | 0:25.1-0:31.5 |
| 5 | validate: clean | `manni meta validate`, `echo $?` | Same values, now in the manifest. validate is clean: no warnings, exit 0. | 0:31.5-0:38.2 |

Every beat starts on a cleared terminal and cuts to the next, with no
transitions. Beat 1 highlights the three maintainer keys in the page and their
`"external"` schema lines. Beat 2 highlights the three warnings, beat 3 the
three `→ site.metadata.yaml` rows, beat 4 the removed page lines and the added
`externalMetadata` entry, beat 5 the summary.

Thumbnail (`.thumb.png`): frame 500, the end of beat 2, with the three
`location:external` warnings and `0` on screen.

## Real output quoted

Beat 2, `manni meta validate` (exit 0):

```
Using manni.config.yaml (.)
⚠ docs/install.md
    /owner  warning "owner" is stored in the page; page.schema.json prefers external metadata. Run manni meta relocate.  (line 4)  [location:external]
    /stakeholders  warning "stakeholders" is stored in the page; page.schema.json prefers external metadata. Run manni meta relocate.  (line 5)  [location:external]
    /review-interval  warning "review-interval" is stored in the page; page.schema.json prefers external metadata. Run manni meta relocate.  (line 6)  [location:external]

1 file checked, 1 passed, 0 failed, 0 errors, 3 warnings
```

Beat 3, `manni meta relocate` (exit 0), then `cat site.metadata.yaml`:

```
Using manni.config.yaml (.)
Created site.metadata.yaml; collections[site].externalMetadata[0] owns owner, stakeholders, review-interval.
docs/install.md
    owner            → site.metadata.yaml:2
    stakeholders     → site.metadata.yaml:3
    review-interval  → site.metadata.yaml:6
1 file, 3 values moved to 1 manifest
docs/install.md:
  owner: platform
  stakeholders:
    - ada
    - grace
  review-interval: 90d
```

Beat 4, `git diff -U1`:

```
diff --git a/docs/install.md b/docs/install.md
index fa8f624..c98a640 100644
--- a/docs/install.md
+++ b/docs/install.md
@@ -3,5 +3,2 @@ title: Install
 description: Install manni and run it.
-owner: platform
-stakeholders: [ada, grace]
-review-interval: 90d
 ---
diff --git a/manni.config.yaml b/manni.config.yaml
index 4c7510f..f60e623 100644
--- a/manni.config.yaml
+++ b/manni.config.yaml
@@ -5 +5,4 @@ collections:
     paths: ["docs/**/*.md"]
+    externalMetadata:
+      - file: ./site.metadata.yaml
+        keys: [owner, stakeholders, review-interval]
```

Beat 5, `manni meta validate` (exit 0):

```
Using manni.config.yaml (.)
✓ docs/install.md

1 file checked, 1 passed, 0 failed, 0 errors
```

## Timing rules applied

- Typing 35 ms per character (spec: 35-70 ms). The cursor is a solid block
  and does not blink.
- Output appears after the command's real measured latency, from the capture
  run plus three timing runs (`media/capture-location/latency.txt`): validate
  536-558 ms, relocate 571-584 ms, validate after relocate 532-552 ms, git diff
  37-38 ms. The replay uses 0.56, 0.58 and 0.55 s, and 2 frames for git and cat.
- Beats run 6.4-8.6 s. Each holds 3.0-5.0 s after its main output, so the
  72-91 character caption can be read on it.
- No narration, so no loudness pass. The AAC 48 kHz track is silence
  (`anullsrc`), measured on the finished file: integrated -70.0 LUFS (the
  meter's floor) and true peak -inf dBFS.
- Caption cues are one per beat, 6.4-8.6 s each, burned in over at most two
  lines of about 55 characters. That is longer per cue and per line than
  broadcast caption guidance (6-7 s, ~42 characters), and matches the band the
  earlier videos use. Each cue is a static step title plus caption, not speech,
  so there is nothing to sync against.

## Exact commands, as typed in the video

```bash
cd media/scratch-location          # its own git repo
cat docs/install.md
cat page.schema.json
manni meta validate
echo $?
manni meta relocate
cat site.metadata.yaml
git diff -U1
manni meta validate
echo $?
```

## Reproduce

```bash
# 0. Build the CLI (repo root)
npm run build

# 1. Demo repository and captures (from media/)
bash capture-location/capture.sh
node capture-location/cols.mjs 28          # font-size derivation

# 2. Render and package (from media/remotion; npm ci first in a fresh worktree)
node scripts/captures-location.mjs
npx tsc src/location/beats.ts --outDir scripts/out-location --module commonjs --target es2020 --resolveJsonModule --esModuleInterop --skipLibCheck
cp src/location/captures.json scripts/out-location/location/
npx remotion render src/index.ts LocationDemo out/location/render.mp4
npx remotion still src/index.ts LocationDemo ../field-location-1x1.thumb.png --frame=500
node scripts/vtt-location.cjs && node scripts/transcript-location.cjs
cd .. && ffmpeg -i remotion/out/location/render.mp4 -f lavfi -i anullsrc=r=48000:cl=stereo -shortest -c:v copy -c:a aac -b:a 128k -movflags +faststart field-location-1x1.mp4
ffmpeg -i field-location-1x1.mp4 -vf "fps=12,scale=540:540:flags=lanczos,split[a][b];[a]palettegen=max_colors=128:stats_mode=diff[p];[b][p]paletteuse=dither=none:diff_mode=rectangle" field-location-1x1.gif
```

## Suggested LinkedIn post (text only; posting is the author's call)

> Your docs page carries `owner`, `stakeholders` and `review-interval` in its
> frontmatter. That page ships to readers, and now to agents reading your
> docs. None of those three were ever meant for them.
>
> manni meta now lets the schema say where a value belongs. Mark a property
> `"x-manni-location": "page"` or `"external"`. `manni meta validate` warns
> about every value on the wrong side, with exit 0, so CI never blocks on it.
> `manni meta relocate` moves the values into the collection's external
> metadata manifest, creating it and the config entry if they don't exist yet.
> It works in the other direction too. The page gets slimmer, and the values
> still validate.
>
> #docsascode #technicalwriting #devtools #AI
