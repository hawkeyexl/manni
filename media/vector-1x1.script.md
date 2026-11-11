# Video script: Vectors without a graph (`manni vector build` and `manni vector search`)

**Objective:** Show that a semantic index of the docs no longer runs through the
graph. The old third step, `manni graph embed`, now refuses with exit 2 and
names its new home. One `manni vector build --collection site` turns this
repository's 268 pages into 3174 vectors and writes no `graph.ttl`. Then
`manni vector search` answers a plain question with the right concept and page.
**Format:** 1080x1080, 30 fps, silent, captions burned in (LinkedIn autoplays muted).
**Duration:** 39.9 s (spec: 20-45 s).
**Audience:** Devin, the CI engineer who wants a vector index for a search box
or a RAG ingester (D13). Also Maya, finding a page by meaning (M18).
**Feature:** proposal 0128, `docs/proposals/0128-vector-domain.md`, Problem and
Worked example. Built on `tool/vector` at `70cbacb`.

Visual spec: `docs/content-strategy/design.md`. Accent `#58a6ff` (blue), the
series accent and the one design.md derives. It is **not red, green, yellow or
cyan**, which manni's own output uses for failure, success, warning and field
names. This video's terminal output carries no colour at all, so nothing in
frame competes with the accent. Terminal `#171717`, bands `#0d0d0d`,
JetBrains Mono throughout. Title band 112 px, 2 px accent rules, caption band
86 px.

## How it was made, and what is staged

Everything printed in the terminal is a real run of `node dist/cli.js`, built
from `tool/vector` at `70cbacb` (Node v24.11.0). The typed command reads
`manni`. `time` is bash's.

- **The material is this repository, not a mock.** Every command runs at the
  repo root, with its own `manni.config.yaml`, its `site` collection and its
  `baseIri`. The IRIs in frame are the site's real node ids.
- **The old chain is a caption, not a capture.** On this branch
  `manni graph embed` prints only its refusal. The three-command chain it used
  to sit at the end of (`graph build`, `graph export search`, `graph embed`) is
  stated in beat 1's caption, from proposal 0128's Problem section. No old
  output is reproduced.
- **The real default model, downloaded off camera.** The optional peer
  `@huggingface/transformers` (4.3.2) was installed into
  `media/scratch-vector/deps` and linked into the worktree's `node_modules`, so
  `package.json` and `package-lock.json` are untouched. One warm-up
  `vector build` downloaded
  `onnx-community/granite-embedding-small-english-r2-ONNX` before any capture.
  The download is not part of what the video claims.
- **The build is cold and says so.** `--no-cache` is typed, so every vector is
  computed on camera, and the output reads `3174 embedded, 0 from cache`.
- **Nothing under `docs/public` changes.** `-o media/scratch-vector/out`
  writes the three files into the gitignored scratch directory (`media/scratch-*`),
  and search reads them back with `-i`. `ls -1` in beat 2 shows the three files
  and no `graph.ttl`.
- **The wait is compressed, and the real time is on screen.** The build took
  3m21.828s. The replay shortens the wait between Enter and output by one
  factor, 1/100.9, to 2.0 s. The `time` output from bash is in frame, unedited.
  An accent italic note under the command reads
  `[201.8 s run; the wait is cut to 2 s]`, as `check-impact` does. That note is
  chrome, drawn in the accent, never as output. The refusal (606 ms) and the
  search (1.6 s, model load included) run at real speed.
- **One script takes every capture:** `media/capture-vector/capture.sh`. Each
  run goes through `media/capture/tty.cjs`, so stdout and stderr report as a
  terminal. `vector build` and `vector search` print no colour either way.
- **A Remotion replay of real bytes, as in the earlier videos.** The search
  hits carry IRIs up to 97 characters long, wider than any legible row. The
  replay (`VectorDemo`, `media/remotion/src/vector/beats.ts`, shared
  `src/Demo.tsx`) wraps at spaces, and inside an IRI or a path only after a
  `/`, as `graph-authoring-1x1` does. No token is split anywhere else.
- **One rendering applied to the captured bytes, no edits.**
  `media/remotion/scripts/captures-vector.mjs` expands `time`'s tab to the
  terminal's own 8-column stops. No visible character is added or removed.
- **Ligatures are off.** JetBrains Mono draws `->` and `--` as single glyphs.
  A terminal prints the characters.
- **Row highlight is chrome.** A faint accent ground (`#58a6ff` at 16%) sits
  behind the rows a caption is about. The bytes in those rows are untouched.
- **The page count is the branch's own.** Proposal 0128's example says 266
  pages and 3145 entries. This branch's docs had grown to 268 pages and 3174
  entries when it was captured, and the video shows what ran.

## Derived font size

`media/capture-vector/cols.mjs` runs the replay's own wrap over every real
line, from 34 px down. The longest real line is the third search hit, 162
characters. Its IRI is a 97-character token, so a size that fits it whole
would be 17 px, illegible at phone size. That is why IRIs break after `/`.

- **Beats 1 and 2: 30 px / 57 columns.** At 31 px beat 2 is 20 rows, 860 px,
  taller than the terminal. At 30 px it is 19 rows, 798 px, and every token in
  beats 1 and 2 stays whole. The model id
  `onnx-community/granite-embedding-small-english-r2-ONNX)` is 56 columns with
  its indent and fits 57.
- **Beats 3 and 4: 26 px / 66 columns**, with continuation rows hung under the
  CLI's 8-column score gutter. 26 px is the largest at which each hit's title
  (`Pin a fact to the sentence it is about`) stays whole on one row. At 27 and
  28 px the third hit orphans `about`.

## Beats (storyboard)

Four static full-frame shots. Beat 4 continues beat 3's screen with a new
title and caption.

| # | Title (band) | Terminal | Caption (band) | Time |
|---|---|---|---|---|
| 1 | Vectors used to need a graph | `manni graph embed`, `echo $?` | It took three graph commands, build, export search and embed. The last one now says where it went. | 0:00.0-0:09.4 |
| 2 | Pages to vectors, one step | `time manni vector build --collection site --no-cache -o media/scratch-vector/out`, `ls -1 media/scratch-vector/out` | The site's 268 pages become 3174 vectors, every one computed fresh. No graph.ttl is written. | 0:09.4-0:25.2 |
| 3 | Search by meaning | `manni vector search "pin a sentence to its source" --limit 3 -i media/scratch-vector/out` | The top hits are the concept of pinning a fact to a sentence and the page that teaches it. | 0:25.2-0:35.4 |
| 4 | Same ids as the graph | (no new command; the same screen, re-captioned) | Every hit is a graph node IRI, so the graph, its chunks and the vectors join on one id. | 0:35.4-0:39.9 |

Beat 1 highlights the refusal. Beat 2 highlights `3174 embedded, 0 from cache`
and `real 3m21.828s`. Beat 3 highlights the two hits titled
`Pin a fact to the sentence it is about`. Beat 4 highlights all three IRIs.

Thumbnail (`.thumb.png`): frame 1050, the end of beat 3, with all three hits on
screen.

## Real output quoted

Beat 1, `manni graph embed` (exit 2):

```
manni: graph embed moved to manni vector build.
```

Beat 2, `time manni vector build --collection site --no-cache -o media/scratch-vector/out` (exit 0):

```
Indexed 268 pages: 3174 entries in 1 language
Wrote 1 sidecar, recorded in media/scratch-vector/out/localizations.json
  en: 3174 vectors (384-d, onnx-community/granite-embedding-small-english-r2-ONNX) -> media/scratch-vector/out/vectors.en.bin
  3174 embedded, 0 from cache

real    3m21.828s
user    0m0.000s
sys     0m0.015s
```

`ls -1 media/scratch-vector/out`:

```
localizations.json
search.en.json
vectors.en.bin
```

Beat 3, `manni vector search "pin a sentence to its source" --limit 3 -i media/scratch-vector/out` (exit 0):

```
0.8817  https://hawkeyexl.github.io/manni/id/concept/pin-a-fact-to-the-sentence-it-is-about [skos:Concept] — Pin a fact to the sentence it is about
0.8448  https://hawkeyexl.github.io/manni/id/concept/pin [skos:Concept] — pin
0.8303  https://hawkeyexl.github.io/manni/id/doc/docs/src/content/docs/meta/set-up/inline-statements.mdx [graph:Document] — Pin a fact to the sentence it is about

3 results (vector)
```

The em dashes above are the CLI's own separator, quoted as printed.

## Timing rules applied

- Typing 40 ms per character (spec: 35-70 ms). The cursor is a solid block and
  does not blink.
- Output appears after the command's real latency, except the build, whose
  wait is cut by one disclosed factor.
- Beats run 4.5-15.8 s. Beat 4 carries no command, only a new title and caption
  over beat 3's screen, and holds 4.4 s.
- No narration, so no loudness pass. The AAC 48 kHz track is silence
  (`anullsrc`). Measured on the finished file with `ebur128=peak=true`, it
  reads -70.0 LUFS integrated and -inf dBFS true peak, both the meter's floor.
- Caption cues are one per beat, burned in over two lines. Each cue is a
  static step title plus caption, not speech, so there is nothing to sync
  against.

## Exact commands, as typed in the video

```bash
manni graph embed
echo $?
time manni vector build --collection site --no-cache -o media/scratch-vector/out
ls -1 media/scratch-vector/out
manni vector search "pin a sentence to its source" --limit 3 -i media/scratch-vector/out
```

## Reproduce

```bash
# 0. Build the CLI (repo root), and make the optional peer resolvable without
#    touching package.json: install it in the scratch dir and link it in.
npm ci && npm run build
mkdir -p media/scratch-vector/deps && (cd media/scratch-vector/deps \
  && echo '{"private":true}' > package.json && npm install @huggingface/transformers)
#    Windows: New-Item -ItemType Junction node_modules\@huggingface\transformers
#    -> media\scratch-vector\deps\node_modules\@huggingface\transformers
node dist/cli.js vector build --collection site -o media/scratch-vector/warm   # warm-up: downloads the model

# 1. Every capture (repo root). About four minutes: one cold build.
bash media/capture-vector/capture.sh
(cd media && node capture-vector/cols.mjs 30)        # the font-size table

# 2. Render and package (from media/remotion, after npm ci there)
node scripts/captures-vector.mjs
npx tsc --ignoreConfig src/vector/beats.ts --outDir scripts/out-vector --module commonjs --target es2020 --resolveJsonModule --esModuleInterop --skipLibCheck
mkdir -p scripts/out-vector/vector && cp src/vector/captures.json scripts/out-vector/vector/
npx remotion render src/index.ts VectorDemo out/vector/render.mp4
npx remotion still src/index.ts VectorDemo ../vector-1x1.thumb.png --frame=1050
node scripts/vtt-vector.cjs && node scripts/transcript-vector.cjs
cd .. && ffmpeg -i remotion/out/vector/render.mp4 -f lavfi -i anullsrc=r=48000:cl=stereo -shortest -c:v copy -c:a aac -b:a 128k -movflags +faststart vector-1x1.mp4
ffmpeg -i vector-1x1.mp4 -vf "fps=12,scale=540:540:flags=lanczos,split[a][b];[a]palettegen=max_colors=128:stats_mode=diff[p];[b][p]paletteuse=dither=none:diff_mode=rectangle" vector-1x1.gif

# 3. Remove the link so the worktree's node_modules matches its lockfile again
rm node_modules/@huggingface/transformers
```

The suggested LinkedIn post is `media/vector-1x1.post.txt`. Posting is the
author's call.
