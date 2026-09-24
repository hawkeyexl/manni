# Video script for the graph vocabulary (`graph:` replaces `kg:`)

**Objective:** Show that a page's knowledge-graph block is now spelled
`graph:`. `manni term check` counts `graph.concepts` as a reference to a term.
Spelled `kg:`, the same block counts for nothing, and the term shows as
unused. The block is closed, so the draft schema catches a typo inside it.
**Format:** 1080x1080, 30 fps, silent, captions burned in (LinkedIn autoplays muted).
**Duration:** 42.6 s (spec: 20-45 s).
**Audience:** docs engineers who write the block on their pages (Maya) and
schema authors who compose the 0023 drafts (Sara).
**Feature:** proposal 0063, `docs/proposals/0063-the-graph-vocabulary.md`,
Decisions 1 to 3. Commit `966fa840`, `feat(term)`.

Visual spec: `docs/content-strategy/design.md`. Accent `#58a6ff` (blue). It is
never red, green, yellow or cyan, which manni's output uses. This video shows
all four of manni's colours: a green check, a cyan `notice` and field pointer,
and a red cross and summary. Terminal `#171717`, bands `#0d0d0d`, JetBrains
Mono throughout. Title band 112 px, 2 px accent rules, caption band 86 px.

## How it was made, and what is staged

Everything printed in the terminal is a real run of `cat`, `sed`, `echo` or
`node dist/cli.js`. The CLI was built by `npm run build` from the
`claude/graph-vocabulary` branch at `285bc3b0` (`capture/build-commit.txt`).
Node was v24.11.0.

- **The typed name is `manni`.** It is the name the shim `media/bin/manni`
  gives the built CLI, as in the earlier videos. The capture runs the same
  file the shim runs, `dist/cli.js` of this checkout.
- **A Remotion replay of real bytes, as in the earlier videos.** The
  composition `GraphVocabularyDemo` (`media/remotion/src/graph/beats.ts`,
  shared `src/Demo.tsx`) replays the captured bytes. Typing runs at 35 ms per
  character, then Enter, then the output after the command's measured latency.
  No output byte is edited.
- **Colour comes from the TTY preload.** manni ran under
  `media/capture/tty.cjs`, which makes stdout and stderr report as a terminal.
  So the bytes carry the colour a terminal would get.
- **One script builds the demo repository and takes every capture:**
  `media/graph/capture/capture.sh`. It is the record of the staging.
- **The demo repository is outside the manni checkout.** The script refuses a
  target inside it. It was built in the session scratchpad, and by default it
  goes to `${TMPDIR:-/tmp}/manni-graph-demo`. It has no git history, and
  neither command needs one.
- **The term page is staged from
  `test/fixtures/term/cli/clean/docs/terms/progressive-lens.md`.** It keeps
  `type`, `id` and `label`. Its `definition` is the fixture's own `abstract`
  line, so it fits one row. `alt-labels`, `hidden-labels` and `broader` are
  dropped, so the set is one term and no other finding can fire.
- **The guide is staged from
  `test/fixtures/term/cli/clean/docs/guides/fitting.md`.** Its page-level
  `concepts:` moves into a `graph:` block, the shape of
  `test/fixtures/term/vocabulary/graph-definition.md`. It names only
  progressive lens, the one term in the set. It sits at `docs/fitting.md` to
  keep the typed paths short.
- **Two files are staged and not shown.** `manni.config.yaml` is the clean
  fixture's, one collection over `docs/**/*.md`, with its comment dropped.
  `graph-1.0.0-proposal.1.json` is a byte copy of
  `docs/proposals/0023/schemas/graph/1.0.0-proposal.1.json`. It sits at the
  root of the demo repository, so the schema tag in the finding stays short.
- **The edits between beats are typed on screen.** Beat 2's `sed` renames the
  block to `kg:`. Beat 3's `sed` renames it back and drops the `s` from
  `concepts`. Each beat then prints the file with `cat`, so the state is never
  implied.
- **Beat 2's finding is a notice, and its exit code is 0.** `unused-term` is
  a notice in `manni term`, so the check passes. The caption says so rather
  than implying a failure. The finding's text still says "no page's
  concepts: names this term". Proposal 0063 changes no message, so that is
  what it prints.
- **Beat 3 prints `Using manni.config.yaml (.)`.** `manni meta validate` found
  the staged config. That line is on stderr, which the capture merges with
  stdout as a terminal would.
- **Row highlight is chrome.** A faint accent ground (`#58a6ff` at 16%) sits
  behind the rows a caption is about. The bytes in those rows are untouched.
  In beat 2 the highlight matches `kg:`, which also marks the `sed` command
  that wrote it.
- **Ligatures are off.** JetBrains Mono draws `---` as one rule, and each
  frontmatter fence is `---`. A terminal prints three characters.

## Derived font size

`media/graph/capture/cols.mjs` runs the replay's own space-only wrap over
every real line, from 32 px down. The longest real line is 96 characters, the
`/graph` finding with its schema tag. The longest typed command is 68
characters with the prompt, the `meta validate` line. Both `sed` commands
carry a quoted script, one of them with a space inside it. So every typed
command must fit one row, which rules out 26 px and up.

The line beat 2 is about decides the size. The `unused-term` notice is 76
characters. At **22 px / 78 columns** it fits one row. At 23 px (75 columns)
it breaks inside its message. The `/graph` finding wraps before its schema
tag, which keeps the line's indent. Line height is 31 px. The tallest beat (1)
is 19 rows, 589 px of the 838 px available. The read-back from the render is
that the widest row, the notice, has its rightmost ink at x=1022 of 1080.

## Beats (storyboard)

Three static full-frame shots. Every beat starts on a cleared terminal and
cuts to the next, with no transitions.

| # | Title (band) | Terminal | Caption (band) | Time |
|---|---|---|---|---|
| 1 | graph: names the term | `cat docs/terms/progressive-lens.md`, `cat docs/fitting.md`, `manni term check`, `echo $?` | The guide's graph: block names progressive lens in concepts. manni term check resolves it: exit 0. | 0:00.0-0:13.3 |
| 2 | kg: no longer counts | `sed -i 's/^graph:/kg:/' docs/fitting.md`, `cat docs/fitting.md`, `manni term check`, `echo $?` | manni term no longer reads kg.concepts. The term is now unused: a notice, so still exit 0. | 0:13.3-0:26.5 |
| 3 | The block is closed | `sed -i 's/^kg:/graph:/; s/concepts:/concept:/' docs/fitting.md`, `cat docs/fitting.md`, `manni meta validate -s graph-1.0.0-proposal.1.json docs/fitting.md`, `echo $?` | The draft manni:graph:1.0.0-proposal.1 closes the block, so a typo inside it fails: exit 1. | 0:26.5-0:42.6 |

Beat 1 highlights the term's `label`, the guide's `concepts:` row and the
check's summary. Beat 2 highlights `kg:` and the notice. Beat 3 highlights the
misspelled `concept:` row and the finding.

Thumbnail (`.thumb.png`): frame 790, the end of beat 2. The `kg:` page, the
`unused-term` notice and `0` are on screen.

## Real output quoted

Beat 1, `manni term check` (exit 0):

```text
✓ 1 term, 1 reference, no findings
```

Beat 2, `manni term check` (exit 0):

```text
docs/terms/progressive-lens.md:1
  notice manni:term/unused-term          no page's concepts: names this term

1 notice in 1 term
```

Beat 3, `manni meta validate -s graph-1.0.0-proposal.1.json docs/fitting.md`
(exit 1):

```text
Using manni.config.yaml (.)
✗ docs/fitting.md
    /graph  must NOT have additional property 'concept'  (line 3)  [graph-1.0.0-proposal.1.json]

1 file checked, 0 passed, 1 failed, 1 error
```

## Timing rules applied

- Typing 35 ms per character (spec: 35-70 ms). The cursor is a solid block
  and does not blink.
- Output appears after the command's measured latency. It comes from the
  capture run plus three timing runs (`capture/latency.txt`). `term check`
  on the `graph:` page took 604-941 ms, and on the `kg:` page 588-781 ms.
  `meta validate` took 607-834 ms. The replay uses the median of the four
  runs: 0.77, 0.68 and 0.81 s. `cat`, `sed` and `echo` get 1-2 frames.
- Beats run 13.2-16.1 s. Each holds 3.0 s on the exit code after its main
  output, so the 89-98 character caption can be read on it.
- No narration, so no loudness pass. The AAC 48 kHz track is silence
  (`anullsrc`). Measured on the finished file, it is integrated -70.0 LUFS
  (the meter's floor) and true peak -inf dBFS.
- Caption cues are one per beat, 13.2-16.1 s each, burned in over two lines
  of about 55 characters. That is longer per cue than broadcast guidance. It
  matches the band the earlier videos use. Each cue is a static step title
  plus caption, not speech, so there is nothing to sync against.

## Exact commands, as typed in the video

```bash
cd "$GRAPH_DEMO_DIR"   # built by capture.sh, outside the checkout
cat docs/terms/progressive-lens.md
cat docs/fitting.md
manni term check
echo $?
sed -i 's/^graph:/kg:/' docs/fitting.md
cat docs/fitting.md
manni term check
echo $?
sed -i 's/^kg:/graph:/; s/concepts:/concept:/' docs/fitting.md
cat docs/fitting.md
manni meta validate -s graph-1.0.0-proposal.1.json docs/fitting.md
echo $?
```

## Reproduce

```bash
# 0. Build the CLI (repo root).
npm ci && npm run build

# 1. Demo repository and every capture. The argument is optional.
bash media/graph/capture/capture.sh /path/outside/the/checkout
node media/graph/capture/cols.mjs 22     # the font-size table

# 2. Render and package (from media/remotion, after npm ci there)
node scripts/captures-graph.mjs
npx tsc src/graph/beats.ts --outDir scripts/out-graph --module commonjs --target es2020 --resolveJsonModule --esModuleInterop --skipLibCheck
cp src/graph/captures.json scripts/out-graph/graph/
npx remotion render src/index.ts GraphVocabularyDemo out/graph/render.mp4
npx remotion still src/index.ts GraphVocabularyDemo ../graph/graph-vocabulary-1x1.thumb.png --frame=790
node scripts/vtt-graph.cjs && node scripts/transcript-graph.cjs
cd ../graph
ffmpeg -i ../remotion/out/graph/render.mp4 -f lavfi -i anullsrc=r=48000:cl=stereo -shortest -c:v copy -c:a aac -b:a 128k -movflags +faststart graph-vocabulary-1x1.mp4
ffmpeg -i graph-vocabulary-1x1.mp4 -vf "fps=12,scale=540:540:flags=lanczos,split[a][b];[a]palettegen=max_colors=128:stats_mode=diff[p];[b][p]paletteuse=dither=none:diff_mode=rectangle" graph-vocabulary-1x1.gif
```

The suggested LinkedIn post is `media/graph/graph-vocabulary-1x1.post.txt`.
Posting is the author's call.
