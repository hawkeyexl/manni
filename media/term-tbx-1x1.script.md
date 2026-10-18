# Video script: TBX in and out (`manni term`, TBX v2 and v3)

**Objective:** Show that `manni term` reads a TBX termbase as it is. It holds one
term per language joined on the concept id and keeps every TBX field. It writes
TBX v3 with `-f tbx3`. The round trip is lossless: the written file is
byte-identical, in place there is nothing to write, and `check` exits 0.
**Format:** 1080x1080, 30 fps, silent, captions burned in (LinkedIn autoplays muted).
**Duration:** 43.7 s (spec: 20-45 s).
**Audience:** docs engineers who own a docset's terminology and trade it with
translators (Maya), and the localization side that already keeps a TBX termbase.
**Feature:** `manni term` TBX reader and writer, branch `claude/term-tbx`
(`328688a9` read TBX v2 and v3, `fddd8be3` write TBX v3, `f5ff36e3` structure
attributes and back matter, `213903df` one term per language).

Visual spec: `docs/content-strategy/design.md`. Accent `#58a6ff` (blue). Never
red, green, yellow or cyan. manni prints `notice` in cyan in beat 5, so the
accent stays blue. Terminal `#171717`, bands `#0d0d0d`, JetBrains Mono
throughout. Title band 112 px, 2 px accent rules, caption band 86 px.

## How it was made, and what is staged

Everything printed in the terminal is a real run of `grep`, `cmp`, `echo` or
`node dist/cli.js`. The CLI was built by `npm run build` from `claude/term-tbx`
at `f5ff36e3`. The typed command reads `manni`, the name the shim
`media/bin/manni` gives the built CLI.

- **A Remotion replay of real bytes, as in the earlier videos.** The
  composition `TermTbxDemo` (`media/remotion/src/tbx/beats.ts`, shared
  `src/Demo.tsx`) replays the bytes. Typing runs at 35 ms/char, then Enter,
  then the output after the command's **measured** latency. No output byte is
  edited.
- **manni's bytes come from the TTY preload.** Every `manni term` run went
  through `media/capture/tty.cjs`, which makes stdout and stderr report as a
  terminal. The bold location, the dimmed path and the cyan `notice` are
  what a terminal receives.
- **One script builds the repository and takes every capture:**
  `media/capture-tbx/capture.sh`. It is the record of the staging.
- **`media/scratch-tbx/` is the demo repository.** It has its own `git init`,
  so config discovery stops there and never reaches manni's own
  `manni.config.yaml`. `media/scratch-*` is gitignored in manni.
- **Input is a fixture, unchanged.** `glossary.tbx` is a byte copy of
  `test/fixtures/term/readers/tbx/tbx-basic-v3.tbx`. There is no
  `manni.config.yaml` in the demo repository; every command names the file.
- **Beat 1 uses `grep`, not `head`.** The brief suggested `head`. The file's
  second line is a 200-character `<?xml-model href=...>` URL, which cannot
  wrap at a space at any legible size (design.md check 2). The `grep` shows
  the three things the feature joins: concept entry, language, term.
- **Beat 4 adds `cmp`.** The written v3 file is byte-identical to its v3
  input, which the capture confirmed (`capture-tbx/cmp.exit` is `0`). `cmp`
  prints nothing on a match, so `&& echo same bytes` makes the result visible.
  That line is echo's real output, shown only because `cmp` exited 0.
- **Beat 5's notices are real and kept.** With no pages in the repository,
  `check` reports every term as unused, at notice level. Notices never fail
  `check`, so it exits 0, and the caption says so. The capture also recorded
  that `git status --porcelain glossary.tbx` was empty after the in-place
  write (`capture-tbx/status-after-write.txt`).
- **Ligatures are off for this video.** JetBrains Mono draws `</` and `/>`
  as single glyphs; a terminal prints the characters.
- **Row highlight is chrome.** A faint accent ground (`#58a6ff` at 16%) sits
  behind the rows a caption is about. The bytes in those rows are untouched.

## Derived font size

`media/capture-tbx/cols.mjs` runs the replay's own space-only wrap over every
real line from 30 px down. The longest real line is 76 characters, the
`notice manni:term/unused-term` row of beat 5. At **22 px / 78 columns** no
line wraps. At 23 px (75 columns) all three notice rows wrap. `get` lays its
own output out at 80 columns, and its longest row is 57. So the wrap of the
`tbx-markup` value is manni's, not the replay's. Line height is 31 px, and
the tallest beat (5) is 13 rows, 403 px of the 838 px available. In the render
the widest row's rightmost ink sits at about x=1022 of 1080.

## Beats (storyboard)

Five static full-frame shots. Every beat starts on a cleared terminal and cuts
to the next, with no transitions.

| # | Title (band) | Terminal | Caption (band) | Time |
|---|---|---|---|---|
| 1 | A translator's termbase | `grep -E '<(conceptEntry\|langSec\|term)[ >]' glossary.tbx` | glossary.tbx came from the translators: TBX concept entries, with English and German terms. | 0:00.0-0:06.9 |
| 2 | One term per language | `manni term list glossary.tbx` | manni term reads TBX v2 and v3. Each language is its own term, joined on the concept id. | 0:06.9-0:13.2 |
| 3 | Every field kept | `manni term get PAL glossary.tbx` | get finds the entry by its alt label: part of speech, term type, inline markup, the German term. | 0:13.2-0:20.5 |
| 4 | Write TBX v3 | `manni term write glossary.tbx -f tbx3 -o build/glossary.tbx`, `manni term list build/glossary.tbx`, `cmp glossary.tbx build/glossary.tbx && echo same bytes` | -f tbx3 writes TBX v3. Read back, it lists the same records, in a byte-identical file. | 0:20.5-0:34.0 |
| 5 | No churn in place | `manni term write glossary.tbx`, `manni term check glossary.tbx; echo $?` | Written back in place, nothing changes. check passes, exit 0: notices never fail it. | 0:34.0-0:43.7 |

Beat 1 highlights the German `langSec` and its term. Beat 2 highlights the
`de` row. Beat 3 highlights `designations`, `tbx-markup` and
`other languages`. Beat 4 highlights the write report and `same bytes`, and
beat 5 `Nothing to write` and the notice summary.

Thumbnail (`.thumb.png`): frame 608, the end of beat 3, with the full `get`
record on screen.

## Real output quoted

Beat 2, `manni term list glossary.tbx` (exit 0):

```
progressive-lens   en   progressive lens   PAL
progressive-lens   de   Gleitsichtglas
bifocal            en   bifocal
3 terms
```

Beat 3, `manni term get PAL glossary.tbx` (exit 0, ANSI stripped):

```
progressive lens                        glossary.tbx:15
  id               progressive-lens
  language         en
  alt-labels       PAL
  definition       A lens whose power changes gradually.
  concept-entry    subject-field: optics
  designations     progressive lens: part-of-speech noun
                   PAL: term-type acronym
  tbx-markup       A lens whose power changes <sc id="b1"
                   type="bold"/>gradually<ec startRef="b1"/>.
  other languages  de (Gleitsichtglas)
```

Beat 4, `manni term write glossary.tbx -f tbx3 -o build/glossary.tbx` (exit 0):

```
Wrote 3 terms to build/glossary.tbx
```

Beat 5, `manni term write glossary.tbx` (exit 0) and `manni term check glossary.tbx` (exit 0):

```
Nothing to write
```

```
glossary.tbx:15
  notice manni:term/unused-term          no page's concepts: names this term
glossary.tbx:28
  notice manni:term/unused-term          no page's concepts: names this term
glossary.tbx:37
  notice manni:term/unused-term          no page's concepts: names this term

3 notices in 3 terms
```

## Timing rules applied

- Typing 35 ms per character (spec: 35-70 ms). The cursor is a solid block
  and does not blink.
- Output appears after the command's real measured latency, from the capture
  run plus three timing runs (`media/capture-tbx/latency.txt`). Every
  `manni term` command took 281-328 ms. The replay uses 0.30-0.33 s, and 2
  frames for `grep` and `cmp`.
- Beats run 6.4-13.5 s. Each holds 3.4-5.0 s after its main output, so the
  85-97 character caption can be read on it.
- No narration, so no loudness pass. The AAC 48 kHz track is silence
  (`anullsrc`), measured on the finished file: integrated -inf LUFS and true
  peak -inf dBTP.
- Caption cues are one per beat, 6.4-13.5 s each, burned in over two lines of
  about 55 characters. That is longer per cue and per line than broadcast
  caption guidance (6-7 s, about 42 characters). It matches the band the
  earlier videos use. Each cue is a static step title plus caption, not
  speech, so there is nothing to sync against.

## Exact commands, as typed in the video

```bash
cd media/scratch-tbx          # its own git repo
grep -E '<(conceptEntry|langSec|term)[ >]' glossary.tbx
manni term list glossary.tbx
manni term get PAL glossary.tbx
manni term write glossary.tbx -f tbx3 -o build/glossary.tbx
manni term list build/glossary.tbx
cmp glossary.tbx build/glossary.tbx && echo same bytes
manni term write glossary.tbx
manni term check glossary.tbx; echo $?
```

## Reproduce

```bash
# 0. Build the CLI (repo root).
npm ci && npm run build

# 1. Demo repository and every capture (from anywhere)
bash media/capture-tbx/capture.sh
node media/capture-tbx/cols.mjs 22          # run from media/: the font-size table

# 2. Render and package (from media/remotion, after npm ci there;
#    if esbuild's postinstall was skipped: node node_modules/esbuild/install.js)
node scripts/captures-tbx.mjs
npx tsc src/tbx/beats.ts --outDir scripts/out-tbx --module commonjs --target es2020 --resolveJsonModule --esModuleInterop --skipLibCheck
cp src/tbx/captures.json scripts/out-tbx/tbx/
npx remotion render src/index.ts TermTbxDemo out/tbx/render.mp4
npx remotion still src/index.ts TermTbxDemo ../term-tbx-1x1.thumb.png --frame=608
node scripts/vtt-tbx.cjs && node scripts/transcript-tbx.cjs
cd .. && ffmpeg -i remotion/out/tbx/render.mp4 -f lavfi -i anullsrc=r=48000:cl=stereo -shortest -c:v copy -c:a aac -b:a 128k -movflags +faststart term-tbx-1x1.mp4
ffmpeg -i term-tbx-1x1.mp4 -vf "fps=12,scale=540:540:flags=lanczos,split[a][b];[a]palettegen=max_colors=128:stats_mode=diff[p];[b][p]paletteuse=dither=none:diff_mode=rectangle" term-tbx-1x1.gif
```

The suggested LinkedIn post is `media/term-tbx-1x1.post.txt`. Posting is the
author's call.
