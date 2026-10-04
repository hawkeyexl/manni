# Video script: `manni graph` (impact, and a CI gate)

**Objective:** A docset cannot answer one question by being read. *What breaks
if I change this page?* Show `manni graph` answering it. `graph build` derives an RDF
graph from the documents. `graph traverse --impact` walks inbound references
transitively, so it finds the page that depends on a page that depends on the
one being changed. `grep` finds only the first hop. The same graph then carries
every dead link, and `graph stats --check` exits 1 on them, so CI has something to
fail on.

**Format:** 1080x1080, 30 fps, silent, captions burned in (LinkedIn autoplays muted).
**Duration:** 32.2 s (spec: 20-45 s).
**Audience:** docs engineers who own a docset and fear editing its hub pages
(Maya), and CI engineers who want a gate for structural rot (Devin).
**Feature:** `manni graph`, the knowledge-graph domain, on `kg/reimport`.

Visual spec: `docs/content-strategy/design.md`. Accent `#58a6ff` (blue), never
red, green, yellow or cyan. Terminal `#171717`, bands `#0d0d0d`, JetBrains Mono
throughout. Title band 112 px, 2 px accent rules, caption band 86 px.

One thing about the reserved-colour rule is specific to this video and worth
recording: **`manni graph`'s pretty reporters emit no ANSI at all.** A `cat -v`
over every file in `media/graph/graph-impact-capture/` finds not one escape sequence, and
`grep -rn 'colors\.\|pc\.\|chalk' src/graph/reporters/` returns nothing. So unlike
the `meta` videos, this frame has no product colour to collide with, and the
blue accent carries the chrome and the row highlights alone. That is also why
the transcript has no colour annotations.

## How it was made, and what is staged

Everything printed in the terminal is a real run of `grep` or of
`node dist/cli.js graph ...`, built from `kg/reimport` at `48d087e`. The typed
command reads `manni`, the name `media/bin/manni` gives the built CLI.

- **A Remotion replay of real bytes**, as in the location, provenance,
  collections and sidecar videos. The CLI ran under the preload that makes
  stdout/stderr report as a TTY (`media/capture/tty.cjs`), so nothing is
  suppressed by the non-TTY path. The bytes were saved verbatim to
  `media/graph/graph-impact-capture/`. The composition `GraphImpactDemo`
  (`media/remotion/src/graph-impact/beats.ts`, shared `src/Demo.tsx`) replays them.
  Typing runs at 35 ms/char, then Enter, then the output after the command's
  **measured** latency. No output byte is edited.
- **One script stages the repository and takes every capture:**
  `media/graph/graph-impact-capture.sh`. It is the record of the staging.
- **The demo repository is `C:\kgdemo`, outside this checkout.** Two reasons,
  both about what would otherwise be on screen. `graph build` reads git history,
  so a corpus sitting inside the manni worktree stamps *manni's* commits into
  the graph. A corpus with no git at all makes `build` print
  `manni: the graph has no revision history or commit agents ...` on stderr.
  So the demo repo gets its own `git init`, one commit, pinned author and date.
  The path is short because `graph build` prints the **absolute** path it wrote
  (`src/graph/cli.ts:282`). From a temp directory that line is 120 characters.
- **Documents are `test/graph/fixtures/corpus/` verbatim**, the eight the graph
  determinism tests run against. Not one byte of a document is changed.
- **One line of the staged config is changed:** `baseIri`, from
  `https://example.com/graph/` to `https://acme.dev/`. `baseIri` is a per-site
  setting that every real user picks. It changes no count and no relationship
  in the graph, only the length of the IRIs on screen. Without it the traverse
  rows run 75 characters before the title even starts.
- **Latency is disclosed, not trimmed.** `beats.ts` holds each output for the
  slowest of four measured runs (`media/graph/graph-impact-capture/latency.txt`). Those are
  build 823-864 ms, traverse 757-793 ms, query 754-794 ms, `stats --check`
  754-855 ms, grep 27-29 ms. Nothing is sped up; there is no speed-up factor
  in this video at all.

### What is *not* claimed

`graph check` runs the bundled SHACL shapes and, on this corpus, reports **2
warnings and 0 errors, exiting 0**. It is not in the video, and no beat claims
SHACL fails here. The CI gate shown is `graph stats --check`, which exits 1 on
broken internal links. This corpus really has them, and the command really
exits 1.

## Type and geometry

Derived with `node graph/graph-impact-cols.mjs 23 72`, run from `media/`.

| Property | Value | Why |
|---|---|---|
| Font size | **23 px** | line height 32 px |
| Columns | **72** | the floor, not the ceiling. See below |
| Tallest beat | 13 rows, 416 px of 878 | fits without a crop |
| Filled row | 994 px wide, **66 px** from the frame edge | design check 2 |

The column count is the interesting number. The font-size sweep in `cols.mjs`
says 23 px *allows* 75 columns, and the first cut used that. But the wrapper
fills every long row to exactly `cols`, so `cols` is what sets the right margin
whatever the font size. At 75 the wrapped `traverse` command ended 25 px from
the frame edge. 72 is the floor: the two `graph query` rows are 72 characters
each. Wrapping either one orphans a bare `"missing.md"` onto its own row,
which reads as a broken renderer. 72 exactly is therefore both the minimum and
the choice, and it buys 66 px of margin for free.

Wrapping at 72 also fixed the `traverse` invocation, which is 106 characters.
`--predicates dcterms:references --impact -d 2` is the same command as
`--impact -d 2 --predicates dcterms:references`, but only the first order wraps
onto a row boundary that leaves the whole flag set intact on row two. The
capture script runs the order that is filmed.

One change was needed in the shared component. Captions are now rendered one
`white-space: nowrap` span per word, because CSS breaks after a hyphen by
default. The beat 3 caption rendered `--check` as `--` / `check`, reading as
two flags. Design check 2 forbids a token split across a line break; this makes
it hold for every video, not just this one.

## Beats

### 1. Two pages mention it (0:00-0:05)

VISUAL: empty prompt, then one command.
```
$ grep -rl configuration.md docs/
docs/getting-started.md
docs/windows-notes.md
```
CALLOUT: both result rows on the faint accent ground.
CAPTION: grep finds the pages that name configuration.md. It cannot find the
pages that depend on those.

### 2. manni graph finds three (0:05-0:20)

VISUAL: build, then the impact walk.
```
$ manni graph build docs/
Wrote C:\kgdemo\graph.ttl (8 docs, 292 triples)
$ manni graph traverse https://acme.dev/doc/docs/configuration.md --predicates dcterms:references --impact -d 2
  https://acme.dev/doc/docs/getting-started.md — Getting Started
  https://acme.dev/doc/docs/windows-notes.md — Windows Notes
    https://acme.dev/doc/docs/harvest.md — Upgrading

3 nodes, 4 hops, 0 excluded
```
CALLOUT: the indented `harvest.md` row and the `3 nodes, 4 hops` summary.
CAPTION: harvest.md is reached through windows-notes.md. Two hops out, where
grep never looked.

The indent is the whole point of the beat. The first two rows are what grep
found, and the third is one hop further. It is reachable only because
`windows-notes.md` references `configuration.md` and `harvest.md` references
`windows-notes.md`. `--predicates dcterms:references` is not decoration.
Without it the walk also follows the `prov:used` edges from the build activity,
which touch every document in the corpus and drown the answer.

### 3. The build fails on it (0:20-0:32)

VISUAL: the same graph, queried for dead links, then the exit code.
```
$ manni graph query --predicate graph:brokenLink
<https://acme.dev/doc/docs/de/regional.md> graph:brokenLink "../missing.md"
<https://acme.dev/doc/docs/no-frontmatter.md> graph:brokenLink "missing.md"

2 match(es)
$ manni graph stats --check > /dev/null; echo $?
1
```
CALLOUT: both `missing.md` rows, and the `1`.
CAPTION: The same graph carries every dead link, and stats --check exits 1. CI
has something to fail on.

The redirect is there because `graph stats` prints a 49-line report and the beat
is about the status, not the report. It is what a person types when they care
about the exit code. The exit code is real: `media/graph/graph-impact-capture/stats-check.exit`
holds `1`.

## Reproducing

From the repo root, with `npm run build` already done:

```bash
cd media
bash graph/graph-impact-capture.sh                    # stages C:\kgdemo, writes graph/graph-impact-capture/
node graph/graph-impact-cols.mjs 23 72                # re-check the geometry
cd remotion
npm ci
node scripts/captures-graph-impact.mjs          # capture bytes -> src/graph-impact/captures.json
npx remotion render src/index.ts GraphImpactDemo out/graph-impact-1x1.mp4
npx tsc src/graph-impact/beats.ts src/beats.ts --ignoreConfig --outDir scripts/out-graph-impact \
  --module commonjs --target es2020 --resolveJsonModule --esModuleInterop --skipLibCheck
cd scripts && node vtt-graph-impact.cjs && node transcript-graph-impact.cjs
```

GIF and thumbnail, from `media/`:

```bash
M=remotion/out/graph-impact-1x1.mp4
ffmpeg -y -i "$M" -vf "fps=15,scale=540:-1:flags=lanczos,palettegen=stats_mode=diff" pal.png
ffmpeg -y -i "$M" -i pal.png -lavfi "fps=15,scale=540:-1:flags=lanczos[x];[x][1:v]paletteuse=dither=bayer:bayer_scale=3" -loop 0 graph/graph-impact-1x1.gif
ffmpeg -y -ss 18.5 -i "$M" -frames:v 1 graph/graph-impact-1x1.thumb.png
```

## Shipping checks (design.md)

1. **Longest line measured against the font size.** `node graph/graph-impact-cols.mjs 23 72`
   prints every row; no token is split and no row exceeds 72 columns.
2. **No text touching the frame edge.** A filled row ends 66 px short of it;
   the caption keeps every token whole (the nowrap change above).
3. **Captions present on every beat.** Three beats, three captions, burned in,
   plus `graph-impact-1x1.vtt`.
4. **`ffprobe` confirms the frame and duration.** 1080x1080, 30 fps, 32.28 s.
5. **Loudness.** Not applicable: the video is silent. Remotion writes an empty
   AAC track; there is no mix to normalise.
6. **Accent is not red, green, yellow or cyan.** `#58a6ff`. And in this video
   there is no product colour on screen at all. See the note at the top.
