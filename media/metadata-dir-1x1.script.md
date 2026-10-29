# Video script for id-keyed external metadata (`metadata/<id>.yaml`, `manni meta relocate --from`)

**Objective:** Show that a page's external metadata kept in `metadata/<id>.yaml`
survives a rename, where a `{page}.meta.yaml` beside the page does not.
`manni meta relocate --from "{page}.meta.yaml"` moves an existing per-page
setup into the directory in one command. It mints an `id` for a page that has
none. `MANNI_EXTERNAL_METADATA_DIR` moves the directory, and a missing one
exits 2.
**Format:** 1080x1080, 30 fps, silent, captions burned in (LinkedIn autoplays muted).
**Duration:** 43.3 s (spec: 20-45 s).
**Audience:** docs engineers who keep page bookkeeping outside the page (Maya,
`docs/content-strategy/personas/`). Also the CI engineer who checks the
metadata out of another repository (Devin).
**Feature:** proposal 0126, `docs/proposals/0126-id-keyed-external-metadata.md`,
`feat(meta): manni meta relocate --from empties a manifest into where its keys
now live`. Branch `claude/manni-sidecar-identification-migrate` at `60e7f8126`,
`dist/` built from it (`manni --version` 4.27.1, `capture-metadata-dir/version.txt`).

Visual spec: `docs/content-strategy/design.md`. Accent `#58a6ff` (blue). Never
red, green, yellow or cyan. In this video manni's own output carries three of
those, and none of them is chrome. relocate prints field names cyan, validate
prints its pass green, and `get` dims its path. Terminal `#171717`, bands
`#0d0d0d`, JetBrains Mono throughout. Title band 112 px, 2 px accent rules,
caption band 86 px.

## How it was made, and what is staged

Everything printed in the terminal is a real run of `cat`, `git mv` or
`node dist/cli.js`. The typed command reads `manni`, the name the shim
`media/bin/manni` gives the built CLI.

- **The input is written by the script, not copied from a fixture.** It is the
  smallest repository that shows the feature, modelled on
  `test/fixtures/external-metadata-dir/relocate-from/`. It holds one page,
  `docs/guide.md`, with a title and no `id`. Its per-page manifest
  `docs/guide.meta.yaml` holds `personas` and `owner`. `manni.config.yaml`
  gives the collection that manifest with `externalMetadata: - file:
  "{page}.meta.yaml"`. `page.schema.json` marks both fields
  `x-manni-location: external` and requires `owner`.
- **The schema does not declare `id`.** A first draft did, and relocate then
  refused to mint one. Its report read `no id could be minted
  (./page.schema.json gives id a meaning of its own; set one by hand)`, and
  it exited 1. That is the designed behaviour, and not this video's subject.
- **The collection is named `site`.** A first draft named it `docs`, and
  manni refused it, exit 2, because the name collides with the `docs` table
  every query reads.
- **The repository is `media/scratch-metadata-dir/`** (gitignored, its own
  `git init` and one commit by a demo author). Config discovery stops there
  and never reaches manni's own `manni.config.yaml`. manni prints only
  relative paths here, so no directory junction is needed.
- **`../elsewhere` does not exist,** and `capture.sh` refuses to run if it
  does. Beat 6 types the variable inline, as a CI step would set it.
- **Beat 3 undoes the rename on screen** with `git mv` back, so relocate runs
  on the page the sidecar names. Beat 5 renames it again.
- **Beat 4 does not show the page.** relocate's report in beat 3 names the
  minted id. `capture-metadata-dir/cat-page.txt` records the page after the
  run, with its new `id: guide` line, and `config-after.txt` records the
  config with the `externalMetadata` entry gone.
- **A Remotion replay of real bytes, as in the earlier videos.** The
  composition `MetadataDirDemo` (`media/remotion/src/metadata-dir/beats.ts`,
  shared `src/Demo.tsx`) replays the bytes. Typing runs at 35 ms/char, then
  Enter, then the output after the command's measured latency. No output byte
  is edited.
- **manni's bytes come from the TTY preload.** Every manni run went through
  `media/capture/tty.cjs`, so the colour is what a terminal gets.
- **One script builds the repository and takes every capture:**
  `media/capture-metadata-dir/capture.sh`. It is the record of the staging.
- **Ligatures are off.** JetBrains Mono draws `$?` and `../` as single glyphs;
  a terminal prints the characters.
- **Row highlight is chrome.** A faint accent ground (`#58a6ff` at 16%) sits
  behind the rows a caption is about. The bytes in those rows are untouched.

## Derived font size

`media/capture-metadata-dir/cols.mjs` runs the replay's own wrap over every
real line from 30 px down. A row breaks at a space. The longest line is beat
2's orphan error, at 125 characters. No size from 30 px down to 18 px
hard-breaks a token.

**The video runs at 24 px / 72 columns.** The binding line is the widest typed
command, beat 6's `$ MANNI_EXTERNAL_METADATA_DIR=../elsewhere manni meta
validate; echo $?`, at 70 characters. At 25 px (69 columns) it would wrap
while being typed. At 24 px it stays whole. Line height is 34 px.

At 72 columns four output lines wrap, each at a space: the orphan error, the
refusal, and relocate's config line, directory line and footer. No wrap
splits a path, a flag or `metadata/`. The tallest beat is 3, at 14 rows,
476 px of the 838 px available. In the render the widest row's rightmost ink,
beat 6's typed command, sits at about x=1040 of 1080.

Captions are 30 px in a 992 px band, 55 characters to a row. The longest is
54, so every caption is one row. A first cut ran beat 3 at 56 characters,
and it orphaned `id.` onto a second row.

## Beats (storyboard)

Six static full-frame shots. Every beat starts on a cleared terminal and cuts
to the next, with no transitions.

| # | Title (band) | Terminal | Caption (band) | Time |
|---|---|---|---|---|
| 1 | Metadata beside the page | `cat docs/guide.meta.yaml` | The sidecar holds personas and owner, keyed by path. | 0:00.0-0:04.0 |
| 2 | Rename it, and the run stops | `git mv docs/guide.md docs/getting-started.md`, `manni meta validate; echo $?` | The sidecar still names docs/guide.md. Exit 2. | 0:04.0-0:11.6 |
| 3 | manni meta relocate --from | `git mv docs/getting-started.md docs/guide.md`, `manni meta relocate --from "{page}.meta.yaml"` | Rename undone. Values move to metadata/, keyed by id. | 0:11.6-0:21.0 |
| 4 | One file per id | `cat metadata/guide.yaml` | Named and keyed by guide, the id minted into the page. | 0:21.0-0:25.2 |
| 5 | Rename it again | `git mv docs/guide.md docs/getting-started.md`, `manni meta validate; echo $?`, `manni meta get docs/getting-started.md --fields owner` | Found by id, not path. Exit 0; owner still reads ada. | 0:25.2-0:36.6 |
| 6 | Another checkout, not there | `MANNI_EXTERNAL_METADATA_DIR=../elsewhere manni meta validate; echo $?` | The variable moves the directory. Missing, it exits 2. | 0:36.6-0:43.3 |

Beat 1 highlights the `docs/guide.md:` key. Beat 2 highlights the orphan
error. Beat 3 highlights the minted id and the two moves. Beat 4 highlights
the `guide:` key. Beat 5 highlights the pass summary and `owner=ada`. Beat 6
highlights the refusal.

Thumbnail (`.thumb.png`): frame 625, the end of beat 3, with relocate's whole
report on screen.

## Real output quoted

Beat 1:

```
docs/guide.md:
  personas: [maya]
  owner: ada
```

Beat 2 (exit 2):

```
Using manni.config.yaml (.)
manni: Manifest docs/guide.meta.yaml:1 names "docs/guide.md", which this run did not load. Fix the entry, or remove the file.
2
```

Beat 3 (exit 0):

```
Using manni.config.yaml (.)
Removed collections[site].externalMetadata[0] ({page}.meta.yaml); collection site reads metadata/.
Created metadata/; it owns what each page's schemas mark external, one <id>.yaml per page.
docs/guide.md
    id        ← minted guide
    personas  → metadata/guide.yaml:2  (from docs/guide.meta.yaml)
    owner     → metadata/guide.yaml:4  (from docs/guide.meta.yaml)
1 file, 2 values moved to 1 manifest, 1 id minted, 1 emptied manifest deleted
```

Beat 4:

```
guide:
  personas:
    - maya
  owner: ada
```

Beat 5 (exit 0, then `get` exits 0):

```
Using manni.config.yaml (.)
✓ docs/getting-started.md

1 file checked, 1 passed, 0 failed, 0 errors
0
Using manni.config.yaml (.)
docs/getting-started.md: owner=ada (asserted)
```

Beat 6 (exit 2):

```
Using manni.config.yaml (.)
manni: MANNI_EXTERNAL_METADATA_DIR: ../elsewhere does not exist. Create it, or check out the repository it names.
2
```

## Timing rules applied

- Typing 35 ms per character, the spec's floor (35-70 ms). At 40 ms with the
  first holds the cut ran 47.0 s, over the 45 s ceiling. The cursor is a
  solid block and does not blink. No speed-up anywhere, and no wait is
  compressed.
- Output appears after the command's measured latency. That comes from the
  capture run plus three timing runs (`media/capture-metadata-dir/latency.txt`),
  each line stamped with its millisecond after Enter. Every manni run prints
  `Using manni.config.yaml (.)` first, at 301-456 ms. The orphan error lands
  41-48 ms after it, and the refusal 41-47 ms. The relocate report lands at
  556-635 ms. The validate pass follows the config line by 22-83 ms, and the
  `get` value by 33-36 ms. `git mv` takes 58-106 ms and `cat` 37-90 ms. The
  replay uses the first whole frame inside each range, or the first after it
  when none falls inside: 10 or 11 frames for the config line, then 2, 7, 1, 1
  and 2. `git mv` and `cat` get 2.
- Lines of one chunk land together. The stamps put them about 20 ms apart, and
  that gap is the stamping loop's own `date` process per line, not the CLI.
- Beats run 4.0-11.5 s. Each holds 2.2-3.9 s after its main output, and the
  46-54 character caption is on screen for the whole beat.
- No narration, so no loudness pass. The AAC 48 kHz track is silence
  (`anullsrc`). Measured on the finished file with `ebur128=peak=true`, it is
  -70.0 LUFS integrated (the meter's floor) and -inf dBFS true peak.
- Caption cues are one per beat, burned in on one row of at most 54
  characters. Beats 2, 3 and 5 run 7.6, 9.4 and 11.5 s, over broadcast
  caption guidance (6-7 s). Each cue is a static step title plus caption,
  not speech, and the sidecar matches the burned-in text. So it is not split.

## Reproduce

```bash
# 0. Build the CLI (repo root).
npm ci && npm run build

# 1. Demo repository and every capture (from anywhere; media/elsewhere must not exist)
bash media/capture-metadata-dir/capture.sh
node capture-metadata-dir/cols.mjs 24   # run from media/: the font-size table

# 2. Render and package (from media/remotion, after npm ci there)
node scripts/captures-metadata-dir.mjs
npx tsc --ignoreConfig src/metadata-dir/beats.ts --outDir scripts/out-metadata-dir --module commonjs --target es2020 --resolveJsonModule --esModuleInterop --skipLibCheck
cp src/metadata-dir/captures.json scripts/out-metadata-dir/metadata-dir/
npx remotion render src/index.ts MetadataDirDemo out/metadata-dir/render.mp4
npx remotion still src/index.ts MetadataDirDemo ../metadata-dir-1x1.thumb.png --frame=625
node scripts/vtt-metadata-dir.cjs && node scripts/transcript-metadata-dir.cjs
cd .. && ffmpeg -i remotion/out/metadata-dir/render.mp4 -f lavfi -i anullsrc=r=48000:cl=stereo -shortest -c:v copy -c:a aac -b:a 128k -movflags +faststart metadata-dir-1x1.mp4
ffmpeg -i metadata-dir-1x1.mp4 -vf "fps=12,scale=540:540:flags=lanczos,split[a][b];[a]palettegen=max_colors=128:stats_mode=diff[p];[b][p]paletteuse=dither=none:diff_mode=rectangle" metadata-dir-1x1.gif
```

The suggested LinkedIn post is `media/metadata-dir-1x1.post.txt`. Posting is
the author's call.
