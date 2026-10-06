# Video script: `manni graph` reads every format lint parses

**Objective:** Show that `manni graph` is no longer Markdown-only. Before
proposal 0077, a directory walk collected `.md`, `.mdx` and `.markdown` and
nothing else, so an HTML, DITA, AsciiDoc or reStructuredText page never
reached the graph. Nothing failed: the links into those pages just looked
broken. Now `graph build` with no flag reads all of them, and links resolve
across formats in both directions. `graph traverse --impact` on a Markdown
page answers with pages in four other formats.

**Format:** 1080x1080, 30 fps, silent, captions burned in (LinkedIn autoplays muted).
**Duration:** 34.75 s (spec: 20-45 s).
**Audience:** docs engineers whose docset is not only Markdown. Think of a
Sphinx HTML build, a DITA map, or AsciiDoc release notes. That is Maya, M18
and M19 in proposal 0077's "Serves" line.
**Feature:** `feat(graph): read html, xml, asciidoc and restructuredtext`
(`17cf2de0`), on branch `claude/graph-input-formats-66ec60`, filmed at
`d5b258e7`. Proposal: `docs/proposals/0077-graph-reads-every-format-lint-parses.md`.

Visual spec: `docs/content-strategy/design.md`. Accent `#58a6ff` (blue), never
red, green, yellow or cyan. Terminal `#171717`, bands `#0d0d0d`, JetBrains Mono
throughout. Title band 112 px, 2 px accent rules, caption band 86 px.

## The accent, and why nothing collides

**`manni graph`'s pretty reporters emit no ANSI at all**, as the graph-impact
video already recorded. It still holds on this branch:
`grep -rnE 'colors\.|pc\.|chalk|picocolors|\\x1b' src/graph/` returns nothing,
and `cat -v` over every file in `media/graph/capture-formats/` shows no escape
sequence. The only non-ASCII bytes are the em dashes in the traverse rows.
So the frame carries no product colour, and the blue accent carries the chrome
and the row highlights alone. Blue is the series accent, and it is not one of
the four colours `manni` reserves in its other reporters.

## How it was made, and what is staged

Everything printed in the terminal is a real run of `node dist/cli.js graph ...`
from this branch's `dist/`. The typed command reads `manni`, the name
`media/bin/manni` gives the built CLI.

- **A Remotion replay of real bytes**, as in the graph-impact and lint videos.
  Each command ran under `media/capture/tty.cjs`, so stdout and stderr report as a
  terminal and nothing is suppressed by a non-TTY path. The bytes are saved
  verbatim in `media/graph/capture-formats/`. The composition
  `GraphFormatsDemo` (`media/remotion/src/graph-formats/beats.ts`, shared
  `src/Demo.tsx`) replays them. Typing runs at 35 ms/char, then Enter, then the
  output after the command's **measured** latency. No output byte is edited.
- **One script stages the repository and takes every capture:**
  `media/graph/graph-formats-capture.sh`. It is the record of the staging.
- **`media/scratch-formats/` is the demo repository.** It has its own
  `git init` and one commit, by a pinned author (Sam Rivera) and date
  (2026-10-01T09:00:00Z). `graph build` reads git history. A corpus with none
  prints a no-history notice on stderr. A corpus inside the manni worktree
  would stamp manni's own commits. `media/scratch-*` is gitignored.
- **The pages are `test/graph/fixtures/formats/` verbatim**, config included.
  That is `index.md`, `guide.html`, `topic.dita`, `map.ditamap`, `notes.adoc`,
  `ref.rst`, the decoy `pom.xml` and `manni.config.yaml`, the corpus CI tests
  0077 against. The capture script `diff -r`s the staged copy against the
  fixture and records the result in `capture-formats/staging.txt`. Not one byte
  is changed, not even `baseIri`: `https://example.com/formats/` is already
  short enough. The config's one collection, `paths: ["."]`, is why
  `manni graph build` needs no path argument.
- **Beat 1 is the old default, passed by hand to today's build.**
  `--ext .md,.mdx,.markdown` is exactly `DEFAULT_EXTENSIONS` at `59fd1ea5`
  (`src/graph/core/discover.ts`, the 4.3.0 release this branch starts from). The
  video does not run the old binary. It runs the new one with the old walk,
  which is what a user who pinned that list would still get. The old binary
  would also have filtered out the non-Markdown pages. Proposal 0077 records
  that it read them as Markdown when they were forced in.
- **Every build is typed with `> /dev/null`.** `graph build` prints the
  **absolute** path it wrote, because `src/graph/commands/build.ts` resolves
  `out` against the working directory. From `media/scratch-formats/` that path
  is one unbroken 118-character token. No phone-legible size shows it without
  splitting the token, which design.md check 2 forbids. The graph-impact video
  solved the same problem by staging at `C:\graphdemo`. This one stays under
  `media/scratch-*`, as the capture conventions ask, and reads the counts back
  with `graph stats` instead. The redirect drops stdout only, so a warning on
  stderr would still be on screen (there is none: `build-*.ans` are empty). The
  line it hides is kept, unedited, in `capture-formats/build-md.stdout`
  (`(1 docs, 43 triples)`) and `build-all.stdout` (`(6 docs, 185 triples)`).
  Those counts agree with what `stats` prints.
- **`| head -13` is a cut, and it is on screen.** `graph stats --top 6` prints a
  43-line report here. Thirteen lines take beat 1 exactly to
  `Broken internal links (8):` and beat 2 to the last of the six
  most-connected documents. `--top 6` makes that list name all six pages
  (the default is five, which drops `map.ditamap`).
- **Latency is disclosed, not trimmed.** `beats.ts` holds each output for the
  slowest of four measured runs (`capture-formats/latency.txt`). Those are
  `build --ext` 1124-1129 ms, `build` 1158-1175 ms, `stats` 993-1005 ms, and
  `traverse` 999-1010 ms. Nothing is sped up, so the 1.3x ceiling does not
  apply.
- **Ligatures are off.** JetBrains Mono joins `--` and `//`, and a terminal
  prints two glyphs. `DemoView` takes `ligatures={false}`, as the lint and term
  videos do.
- **Row highlight is chrome.** A faint accent ground (`#58a6ff` at 16%) sits
  behind the rows a caption is about. The bytes in those rows are untouched.

### What is *not* claimed

- The video does not claim the old binary printed these exact numbers. Beat 1
  is today's build restricted to the old extension set, labelled "old" because
  that set was the old default.
- Section anchors kept verbatim (`topic.dita#GUID-A1B2-C3D4`) are real in this
  graph (`guide.html` references
  `https://example.com/formats/doc/topic.dita#GUID-A1B2-C3D4`). They are not on
  screen, though, so no caption claims them. The post text mentions them as a
  property of the feature, not as something the video shows.
- The decoy `pom.xml` is staged and stays out of the graph: 6 documents, not 7.
  No caption calls it out.

## Type and geometry

Derived with `node graph/graph-formats-cols.mjs 27 64`, run from `media/`.

| Property | Value | Why |
|---|---|---|
| Font size | **27 px** | line height 38 px |
| Columns | **64** | the narrowest that keeps the traverse command to two clean rows |
| Tallest beat | 16 rows, 608 px of 838 | fits without a crop |
| Widest row | 63 chars, ends ~40 px from the frame edge | design check 2 |

The sweep: 28 px gives 61 columns, which still fits every output row (the
longest is the 61-character `map.ditamap` traverse row). But it breaks the
102-character traverse command into three rows. `manni graph traverse` is
stranded alone on the first. At 27 px / 64 columns the command wraps once: IRI
on row one, the whole flag set on row two. No output row wraps at all.
Below 28 px nothing wraps except that command. Above it, three output rows wrap
and orphan a single word.

## Beats (storyboard)

Three static full-frame shots. Every beat starts on a cleared terminal and cuts
to the next, with no transitions.

| # | Title (band) | Terminal | Caption (band) | Time |
|---|---|---|---|---|
| 1 | Markdown only | `manni graph build --ext .md,.mdx,.markdown > /dev/null`, then `manni graph stats --top 6 \| head -13` | The old Markdown-only walk reads 1 page of 6. Its 8 links into the other formats look broken. | 0:00.0-0:12.0 |
| 2 | Every format, no flag | `manni graph build > /dev/null`, then the same `stats` | With no --ext, graph build also reads HTML, DITA, AsciiDoc and reStructuredText. 6 pages. | 0:12.0-0:23.2 |
| 3 | Links cross formats | `manni graph traverse https://example.com/formats/doc/index.md --predicates dcterms:references --impact` | What depends on the Markdown page: HTML, AsciiDoc and RST pages, and a DITA map one hop out. | 0:23.2-0:34.7 |

Beat 1 highlights `Documents:  1` and `Broken internal links (8):`. Beat 2
highlights `Documents:  6` and the five non-Markdown rows. Beat 3 highlights
the four inbound pages.

Thumbnail (`.thumb.png`): frame 690, the end of beat 2, with `Documents:  6`
and all six formats on screen.

## Real output quoted

Beat 1 (both exit 0):

```
$ manni graph build --ext .md,.mdx,.markdown > /dev/null
$ manni graph stats --top 6 | head -13
Triples:    43
Documents:  1
Sections:   1
Concepts:   0
References: 0

Most connected:
  (none)

Orphan docs (1):
  index.md

Broken internal links (8):
```

The eight, from the uncut report, are `index.md`'s links to `guide.html`,
`guide.html#install-the-sdk`, `notes.adoc`, `notes.adoc#_upgrade`, `ref.rst`,
`ref.rst#install-ref`, `topic.dita` and `topic.dita#GUID-A1B2-C3D4`. Every
target exists on disk. The graph just never read it.

Beat 2 (both exit 0):

```
$ manni graph build > /dev/null
$ manni graph stats --top 6 | head -13
Triples:    185
Documents:  6
Sections:   11
Concepts:   0
References: 18

Most connected:
  index.md (11)
  guide.html (8)
  topic.dita (6)
  notes.adoc (4)
  ref.rst (4)
  map.ditamap (2)
```

Beat 3 (exit 0):

```
$ manni graph traverse https://example.com/formats/doc/index.md --predicates dcterms:references --impact
  https://example.com/formats/doc/guide.html — Install guide
  https://example.com/formats/doc/notes.adoc — Release notes
  https://example.com/formats/doc/ref.rst — Reference
    https://example.com/formats/doc/map.ditamap — Formats map

4 nodes, 8 hops, 0 excluded
```

Each row is a real cross-format edge. `guide.html` links `index.md` with an
`<a href>`, `notes.adoc` with `link:index.md[...]`, and `ref.rst` with the
`.. _home: index.md` target. `map.ditamap` reaches it one hop out, through its
`<topicref href="guide.html">`. `--predicates dcterms:references` is not
decoration. Without it the walk also follows the build activity's `prov:used`
edge to every document, and `https://example.com/formats/activity/build`
joins the answer.

`--impact` was chosen over `--reverse` because it shows the second hop. A plain
`--reverse` on `index.md` (same predicates) lists the same three direct pages,
without the DITA map.

## Exact commands, as typed in the video

```bash
cd media/scratch-formats          # its own git repo, test/graph/fixtures/formats/ verbatim
manni graph build --ext .md,.mdx,.markdown > /dev/null
manni graph stats --top 6 | head -13
manni graph build > /dev/null
manni graph stats --top 6 | head -13
manni graph traverse https://example.com/formats/doc/index.md --predicates dcterms:references --impact
```

## Reproduce

From the repo root, with `npm run build` already done:

```bash
bash media/graph/graph-formats-capture.sh          # stages media/scratch-formats, writes media/graph/capture-formats/
cd media
node graph/graph-formats-cols.mjs 27 64            # re-check the geometry
cd remotion
npm ci
node scripts/captures-graph-formats.mjs            # capture bytes -> src/graph-formats/captures.json
npx tsc src/graph-formats/beats.ts --outDir scripts/out-graph-formats \
  --module commonjs --target es2020 --resolveJsonModule --esModuleInterop --skipLibCheck
(cd scripts && node vtt-graph-formats.cjs && node transcript-graph-formats.cjs)
npx remotion render src/index.ts GraphFormatsDemo out/graph-formats/render.mp4
npx remotion still src/index.ts GraphFormatsDemo ../graph/graph-formats-1x1.thumb.png --frame=690
cd ..
ffmpeg -y -i remotion/out/graph-formats/render.mp4 -c copy -movflags +faststart graph/graph-formats-1x1.mp4
ffmpeg -y -i graph/graph-formats-1x1.mp4 \
  -vf "fps=12,scale=540:540:flags=lanczos,split[a][b];[a]palettegen=max_colors=128:stats_mode=diff[p];[b][p]paletteuse=dither=none:diff_mode=rectangle" \
  graph/graph-formats-1x1.gif
```

Remotion already muxes an AAC 48 kHz track, so no `anullsrc` pass is needed.
The remux only moves the `moov` atom to the front for streaming.

The suggested LinkedIn post is `media/graph/graph-formats-1x1.post.txt`.
Posting is the author's call.

## Shipping checks (design.md)

1. **Longest line measured against the font size.** `graph-formats-cols.mjs`
   prints every row at 27 px / 64 columns. No token is split, no output row
   wraps, and the only wrapped line is the typed traverse command, which breaks
   at a space.
2. **No text touching the frame edge.** The widest row, the first traverse
   command row, ends about 40 px short of it. Captions keep every token whole
   (the shared nowrap-per-word caption).
3. **Captions present on every beat.** Three beats, three captions, burned in,
   plus `graph-formats-1x1.vtt`.
4. **`ffprobe` confirms the frame and duration.** `graph-formats-1x1.mp4`:
   h264 yuv420p 1080x1080 at 30 fps, AAC 48 kHz, 34.752 s (1041 frames).
5. **Loudness.** Not applicable, since the video is silent. Measured on the
   finished file anyway: `ebur128` reports integrated -70.0 LUFS (its gate
   floor, meaning digital silence) and LRA 0.0 LU.
6. **Accent is not red, green, yellow or cyan.** `#58a6ff`. And the product
   output on screen carries no colour at all; see the note at the top.
