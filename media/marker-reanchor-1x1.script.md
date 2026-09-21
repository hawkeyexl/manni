# Video script: `cite update` re-anchors a misplaced marker

**Objective:** Show that a citation marker line sitting inside a paragraph is a
bug the tool now finds and repairs. The marker splits the rendered paragraph in
two, mid-sentence. `manni cite check` reports `marker-misplaced` at the
marker's line, and reads the claim as `claim-moved`. `manni cite update` moves
the marker above the paragraph and re-pins the claim over the whole of it, with
no flag. Afterwards `check` is clean and the paragraph reads as one paragraph
again.

**Feature:** proposal 0054, `docs/proposals/0054-marker-reanchoring.md`.
**Format:** 1080x1080, 30 fps, MP4 (H.264, yuv420p, silent AAC), captions
burned in. LinkedIn autoplays muted, so the captions are the whole voice track.
**Duration:** 40.5 s (spec: 20-45 s).
**Audience:** Maya, the docs engineer whose pages the old `add --marker`
wrote (CUJ M5). Also Theo, the contributor who meets a citation failure on a
sentence nobody edited (CUJ T2). Personas and journeys are in
`docs/content-strategy/personas.md` and `cujs.md`.

Visual spec: `docs/content-strategy/design.md`. Terminal `#171717`, bands
`#0d0d0d`, JetBrains Mono throughout, title band 112 px, caption band 86 px,
2 px accent rules.

**Accent: `#58a6ff` blue.** It may not be red, green, yellow or cyan, and all
four are in this frame carrying meaning from manni's own output. `check` prints
a yellow `↕` and `⚠` for the warning, and a dim `ℹ` for the notice. The clean
run prints a green `✓` and a green summary. The citation id `fresh-context` is
cyan in every run. Blue is the only value left.

## Story variant

The feature has two halves. The half in frame needs no flag. Its marker still
has its pinned text on the page, so `update` moves the marker and re-pins the
claim on its own. The other half is a marker whose claim holds nowhere. That
one stays put, is reported, and moves under `update --accept`.

The no-flag half is the better demo. A page nobody edited should not report a
reworded sentence, and the repair should not be a hand-written script. That is
the argument. One run of `update`, with no flag and no reading of prose, is
that argument on screen. The `--accept` half is a second story about judgement,
and it costs a beat this video does not have inside the 45 s ceiling. It is
listed under "Out of frame" below.

## What is staged, and what is real

Every byte in the terminal is a real run of `cat`, `node` or
`node dist/cli.js`. The typed command reads `manni`, the name the shim
`media/bin/manni` gives the built CLI.

- **A Remotion replay of real captures,** the pipeline the collections,
  provenance, sidecar and field-location videos use. The longest line in the
  video is 232 characters, and the longest line of manni's own output is 118.
  A real terminal at a phone-legible size hard-wraps those inside a token,
  which design.md check 2 forbids. The replay wraps at spaces only. So the CLI
  runs under the preload that makes stdout and stderr report as a TTY
  (`media/capture/tty.cjs`), which keeps the colour a user sees. No output byte
  is edited, reflowed or recoloured. The replay adds the typing animation, the
  bands and the wrap.
- **`media/scratch-marker/` is the demo repository,** with its own `git init`
  and one commit by a pinned author and date. `media/scratch-*` is gitignored
  in manni, and discovery honours `.gitignore`, so nothing is committed to
  manni.
- **The page is `test/fixtures/cite/misplaced/mid-paragraph.mdx`, unedited,**
  copied to `docs/a11y/index.mdx`. Its source file is the fixture's
  `test/fixtures/cite/src/limits.ts`, copied to `src/limits.ts`. This branch's
  CI runs that fixture. So the line numbers on screen are the ones the tests
  assert. The marker is at 16, the paragraph at 14-18, and its place is above
  14. The path is `docs/a11y/index.mdx` because the proposal's own report lines
  use it. It is also the page that carried 27 split paragraphs in the dogfood
  that found this.
- **The render proof is the MDX parser's paragraph count, not a browser.**
  `render.mjs` parses the page with `remark-parse` plus `remark-mdx` and prints
  every paragraph node it finds. That is the reading a renderer emits `<p>`
  elements from. Filming a browser would put a second surface in a
  terminal-only frame. design.md says a claim that is not shown is not made.
  So the claim made on screen is the parser's, and the caption says
  "paragraph" rather than "renders".
- **Row highlight is chrome.** A faint accent ground (`#58a6ff` at 16 %) sits
  behind the rows a caption is about. The bytes in those rows are untouched.
- **No speed-up anywhere.** Nothing is compressed, so design.md's 1.3x ceiling
  never applies.

## Derived font size

Font size is derived, not chosen, and the derivation runs at capture time.
`media/capture-marker/cols.mjs` runs the composition's own space-only wrap over
every real line, copied from `Demo.tsx` `wrapLine`, so the derivation and the
render agree. The inputs it must satisfy:

| Input | Value |
|---|---|
| Longest real line | **232 chars**, beat 5's joined paragraph |
| Longest line of manni output | **118 chars**, beat 4's re-pin line |
| Longest unbreakable token | **20 chars**, `docs/a11y/index.mdx:` and `'.pages[].findings[]` |
| Tallest beat | **beat 1**, 18 rows at 59 columns |
| Terminal area | 878 px (1080 less two bands and two rules) |

Height decides here, not the token, because no token is long. The candidate to
render first is **28 px / 59 columns / 39 px line height**. That puts beat 1 at
702 px of the 878 px available. Confirm it against the capture rather than
assuming it. `cols.mjs` has to report 0 hard breaks, and every beat has to fit
inside 878 px, before this ships. If 28 px overflows, step down one size at a
time and re-run. Do not copy a number from another video.

## Beats

Five beats. Each starts on a cleared terminal and cuts to the next, with no
transitions. Beats 1 and 2 are the problem, beats 3 and 4 the diagnosis and the
fix, beat 5 the result.

<!-- The Title and Caption cells are burned into the rendered video, so they stay as shown. -->
<!-- vale Voices.ColonReveal = NO -->

| # | Title (band) | Terminal | Caption (band) | Time |
|---|---|---|---|---|
| 1 | A marker inside the prose | `cat -n docs/a11y/index.mdx \| tail -7`, `node render.mjs docs/a11y/index.mdx` | A marker sits on line 16, between two lines of prose. MDX reads two paragraphs, not one. | 0:00.0-0:09.0 |
| 2 | check sees it | `manni cite check docs/a11y/index.mdx`, `echo $?` | The claim column says where the marker is and where it belongs. Exit 0, so CI never blocks. | 0:09.0-0:16.0 |
| 3 | Two findings, named | `manni cite check -f json ... \| jq` | marker-misplaced warns at the marker's line. claim-moved is a notice, because the text never changed. | 0:16.0-0:24.5 |
| 4 | update moves it | `manni cite update docs/a11y/index.mdx` | update hoists the marker above line 14 and re-pins the claim over the whole paragraph. No flag. | 0:24.5-0:32.0 |
| 5 | Clean, and whole | `manni cite check docs/a11y/index.mdx`, `node render.mjs docs/a11y/index.mdx` | Same words, one marker moved. No findings, and one paragraph instead of two. | 0:32.0-0:40.5 |

<!-- vale Voices.ColonReveal = YES -->

Beat 1 highlights line 16 in the numbered source, then the `2 paragraphs` row.
Beat 2 highlights the `marker :16 -> :14 moved` column. Beat 3 highlights the
two rule names. Beat 4 highlights both report lines. Beat 5 highlights the
green summary and the `1 paragraph` row.

Thumbnail (`.thumb.png`): the end of beat 3, with both rule names and both
messages on screen.

## Real output, per beat

Every block below is what the command prints. The line numbers and messages are
the ones `test/cite/check.test.ts` and `test/cite/update.test.ts` assert for
this fixture.

**Beat 1.** The page, and what MDX reads.

```console
$ cat -n docs/a11y/index.mdx | tail -7
    12  # Crawl
    13
    14  Pages are checked one at a time, in the order the crawl found them.
    15  A page that fails to load is reported, and the crawl moves on.
    16  {/* cite fresh-context */}
    17  Each URL is loaded in a fresh browser context, so no state carries over
    18  from one page to the next.
$ node render.mjs docs/a11y/index.mdx
2 paragraphs
p1  Pages are checked one at a time, in the order the crawl found them. A page that fails to load is reported, and the crawl moves on.
p2  Each URL is loaded in a fresh browser context, so no state carries over from one page to the next.
```

(`cat -n` separates the number from the text with a tab. The replay keeps the
tab as captured.)

**Beat 2.** `check`, pretty, exit 0.

```console
$ manni cite check docs/a11y/index.mdx
⚠ docs/a11y/index.mdx
    ↕ fresh-context   marker :16 -> :14 moved   src/limits.ts:3 current

1 file checked, 1 passed, 0 failed, 2 findings (1 warning) (1 notice)
$ echo $?
0
```

**Beat 3.** The same run, with the rule names and the full messages.

```console
$ manni cite check -f json docs/a11y/index.mdx | jq -r '.pages[].findings[] | .rule + "  " + .message'
marker-misplaced  fresh-context: the marker at line 16 splits the paragraph at lines 14-18. Its place is above line 14.
claim-moved  fresh-context: the claim moved from lines 17-18 to lines 15-18.
```

**Beat 4.** `update`, no flag.

```console
$ manni cite update docs/a11y/index.mdx
docs/a11y/index.mdx: fresh-context marker line 16 -> 14 (misplaced)
docs/a11y/index.mdx: fresh-context claim re-pinned over lines 15-18 (moved; was lines 17-18, lines 15-16 newly pinned)
1 citation rewritten in 1 file, 0 skipped
```

**Beat 5.** `check` again, and the page.

```console
$ manni cite check docs/a11y/index.mdx
✓ docs/a11y/index.mdx
    ✓ fresh-context   marker :14 current   src/limits.ts:3 current

1 file checked, 1 passed, 0 failed, 0 findings
$ node render.mjs docs/a11y/index.mdx
1 paragraph
p1  Pages are checked one at a time, in the order the crawl found them. A page that fails to load is reported, and the crawl moves on. Each URL is loaded in a fresh browser context, so no state carries over from one page to the next.
```

## Exact commands, as typed in the video

```bash
cd media/scratch-marker              # its own git repo
cat -n docs/a11y/index.mdx | tail -7
node render.mjs docs/a11y/index.mdx
manni cite check docs/a11y/index.mdx
echo $?
manni cite check -f json docs/a11y/index.mdx | jq -r '.pages[].findings[] | .rule + "  " + .message'
manni cite update docs/a11y/index.mdx
manni cite check docs/a11y/index.mdx
node render.mjs docs/a11y/index.mdx
```

## Timing rules applied

- Typing 45 ms per character, inside design.md's 35-70 ms. The cursor is a
  solid block and does not blink.
- Output appears after the command's real measured latency. Measure three runs
  of each command at capture time and replay the middle value, recording all
  three in `media/capture-marker/latency.txt`. `cat` and `node render.mjs` are
  fast enough to replay in 2 frames, as `git diff` and `cat` were in the
  field-location video.
- Beats run 7.0-9.0 s. Each holds at least 3.0 s after its last output, so a
  caption of 75 to 100 characters can be read on it.
- No narration, so no loudness pass on speech. The AAC 48 kHz track is silence
  (`anullsrc`), present only so every player accepts the file. Measure it on
  the finished file and expect the meter's floor.
- Caption cues are one per beat, 7.0-9.0 s each, burned in over at most two
  lines. That is longer per cue than broadcast caption guidance, and matches
  the band the earlier videos use. Each cue is a static step title plus
  caption, not speech, so there is nothing to sync against.

## Material

```
media/scratch-marker/
  docs/a11y/index.mdx    test/fixtures/cite/misplaced/mid-paragraph.mdx, unedited
  src/limits.ts          test/fixtures/cite/src/limits.ts, unedited
  render.mjs             prints the MDX parser's paragraph nodes
  package.json           deps for render.mjs only
  .git/                  one commit, pinned author and date
```

`render.mjs`, in full, so the proof in frame is auditable:

```js
import { readFileSync } from "node:fs";
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkFrontmatter from "remark-frontmatter";
import remarkMdx from "remark-mdx";
import { toString } from "mdast-util-to-string";

const file = process.argv[2];
const tree = unified()
  .use(remarkParse)
  .use(remarkFrontmatter, ["yaml"])
  .use(remarkMdx)
  .parse(readFileSync(file, "utf8"));
const paras = tree.children.filter((n) => n.type === "paragraph");
console.log(`${paras.length} paragraph${paras.length === 1 ? "" : "s"}`);
paras.forEach((p, i) => console.log(`p${i + 1}  ${toString(p).replace(/\n/g, " ")}`));
```

Its dependencies are `unified`, `remark-parse`, `remark-frontmatter`,
`remark-mdx` and `mdast-util-to-string`, installed in the scratch repo only.
Nothing is added to manni's own `package.json` or lockfile.

## Out of frame, deliberately

- **`update --accept`.** A marker whose claim holds nowhere stays put and is
  reported, and `--accept` moves it and re-pins it. It is the second half of
  the feature and it needs its own beat plus a reason to trust the accept. The
  video is already 40.5 s of a 45 s ceiling.
- **A stacked run.** `test/fixtures/cite/misplaced/stacked-run.mdx` shows one
  marker of a run moving while its sibling stays. It is the sharpest case in
  the proposal and the hardest to read in nine seconds.
- **`add`'s two refusals.** Decision 5 of the proposal. A refusal beat is a
  different video.
- **`marker-misplaced: error`.** The severity key is in the reference page. The
  video shows the default, because the default is what an upgrade gives
  everybody.

## Reproduce

Not yet run. These are the steps the capture follows.

```bash
# 0. Build the CLI (repo root, in this worktree)
npm ci
npm run build

# 1. Demo repository and captures (from media/)
bash capture-marker/capture.sh
node capture-marker/cols.mjs 28          # font-size derivation, must report 0 hard breaks

# 2. Render and package (from media/remotion; npm ci first in a fresh worktree)
node scripts/captures-marker.mjs
npx remotion render src/index.ts MarkerDemo out/marker/render.mp4
npx remotion still src/index.ts MarkerDemo ../marker-reanchor-1x1.thumb.png --frame=<end of beat 3>
node scripts/vtt-marker.cjs && node scripts/transcript-marker.cjs
cd .. && ffmpeg -i remotion/out/marker/render.mp4 -f lavfi -i anullsrc=r=48000:cl=stereo \
  -shortest -c:v copy -c:a aac -b:a 128k -movflags +faststart marker-reanchor-1x1.mp4
ffmpeg -i marker-reanchor-1x1.mp4 -vf "fps=12,scale=540:540:flags=lanczos,split[a][b];\
[a]palettegen=max_colors=128:stats_mode=diff[p];[b][p]paletteuse=dither=none:diff_mode=rectangle" \
  marker-reanchor-1x1.gif
```

## Outstanding

**The capture and the render have not been done.** This file is the script and
the beat sheet only. Still to do, in order:

1. `media/capture-marker/capture.sh`, which builds `media/scratch-marker/` and
   takes the five captures under `media/capture/tty.cjs`.
2. Latency measurement, three runs per command, into
   `media/capture-marker/latency.txt`.
3. `media/capture-marker/cols.mjs`, and the font-size derivation. 28 px is a
   candidate, not a result.
4. The Remotion composition `MarkerDemo` and its beats file.
5. The render, the thumbnail, the `.vtt`, the transcript, the GIF and the MP4.
6. The six shipping checks below, none of which can be answered yet.

Every duration and geometry figure above is a target for the capture to hit.
The line numbers, messages and report lines are not targets. They come from the
fixture and from the tests, and the capture must reproduce them exactly.

## Checks before shipping (design.md)

1. Longest real line measured against the chosen size, with the column count
   read from the wrap the composition actually runs. **Pending** (`cols.mjs`).
2. No text touching the frame edge, and no token split across a line break.
   **Pending.**
3. Captions present on every beat. **Written**, 5 of 5, verified at render.
4. `ffprobe` confirms 1080x1080 and the intended duration. **Pending.**
5. Loudness measured on the finished file. **Pending.** The track is silence,
   so a `loudnorm` pass would be meaningless, but the measurement still gets
   recorded.
6. Accent is not red, green, yellow or cyan. **Met by design**, `#58a6ff`.

## Suggested LinkedIn post (text only; posting is the author's call)

> One line of your docs page was quietly breaking the page.
>
> A citation marker on its own line ends a paragraph, for MDX and for
> CommonMark alike. Put one in the middle of a hard-wrapped paragraph and the
> page renders as two paragraphs, the first stopping mid-sentence. The build
> passes. Nothing leaks. On our own a11y overview, 27 paragraphs were split
> that way.
>
> `manni cite check` now reports it as `marker-misplaced`, at the marker's
> line, with the paragraph it splits and where the marker belongs. It reads the
> pinned sentence as `claim-moved` rather than changed, because the text never
> changed. `manni cite update` hoists the marker above the paragraph, re-pins
> the claim over the whole of it, and shifts the citations the move pushed
> along. No flag, and the warning never fails a run.
>
> #docsascode #technicalwriting #devtools #AI
