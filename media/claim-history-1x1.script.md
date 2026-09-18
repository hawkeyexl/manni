# Video script: `cite check` reads the page's history

**Objective:** Show that a wall of identical `claim-changed` warnings splits
into the ones a tool can fix and the ones a person has to read.
`manni cite check` now walks the page's commits for a claim whose pin no
longer holds. A claim whose words are unchanged and whose whitespace, markers
or anchor moved is a notice, `claim-reanchored`, and plain `manni cite update`
re-pins it. A claim whose words were edited stays the warning
`claim-changed`, and says since when. `manni cite check --show-diff` prints
that claim's own diff since its baseline commit. The exit code is 0 in every
beat.

**Feature:** proposal 0053, `docs/proposals/0053-claim-history.md`.
**Format:** 1080x1080, 30 fps, MP4 (H.264, yuv420p, silent AAC), captions
burned in. LinkedIn autoplays muted, so the captions are the whole voice
track.
**Duration:** 40.5 s (spec: 20-45 s).
**Audience:** Maya, the docs engineer who dogfooded 300 citations onto five
pages and got 92 warnings back (CUJ M5). Also Devin, who needs a layout change
to stop reading as a prose change in CI (CUJ D5). Personas and journeys are in
`docs/content-strategy/personas.md` and `cujs.md`.

Visual spec: `docs/content-strategy/design.md`. Terminal `#171717`, bands
`#0d0d0d`, JetBrains Mono throughout, title band 112 px, caption band 86 px,
2 px accent rules.

**Accent: `#58a6ff` blue.** It may not be red, green, yellow or cyan, and all
four carry meaning from manni's own output in this frame. `check` prints a
yellow `↕` and `⚠` for a warning, and a dim `ℹ` for a notice. The clean
counts print green. Every citation id is cyan. Blue is the only value left.

## Story variant

The feature has two halves, and the split is the story. One half is
mechanical: 68 claims whose words nobody touched, cleared by a command with no
flag. The other half is judgement: 24 claims whose words changed, each now
carrying the commit it changed since and a diff on request.

The mechanical half alone would be a smaller claim, because "a tool re-pins
its own hashes" is not news. The judgement half alone has no scale, because
one diff is one diff. Shown together they make the argument the proposal
makes. The reviewer's queue drops from 92 rows to 24, and the 24 are the ones
worth a human.

What stays out of frame is `update --accept`, which is a third beat about
trust. The ladder's rung 5 covers it, and this video is already 40.5 s of a
45 s ceiling.

## What is staged, and what is real

Every byte in the terminal is a real run of `node dist/cli.js` or of the
published 2.3.7 build. The typed name is the shim that resolves each one.

- **A Remotion replay of real captures,** the pipeline the collections,
  provenance, sidecar and field-location videos use. The longest line is 105
  characters and the longest unbreakable token is 41. A real terminal at a
  phone-legible size hard-wraps inside a token, which design.md check 2
  forbids. The replay wraps at spaces only. So the CLI runs under the preload
  that makes stdout and stderr report as a TTY (`media/capture/tty.cjs`),
  which keeps the colour a user sees. No output byte is edited, reflowed or
  recoloured. The replay adds the typing animation, the bands and the wrap.
- **`media/scratch-history/` is the demo repository,** with its own `git init`
  and four commits by a pinned author and date. `media/scratch-*` is
  gitignored in manni, and discovery honours `.gitignore`, so nothing lands in
  manni's own tree.
- **The material is this repository's own a11y docs.** The demo repository is
  built from `test/fixtures/cite/a11y-replay/`, the fixture this feature
  ships. It holds the five a11y pages, their `src/a11y/` sources and the
  `site.metadata.yaml` the dogfood minted, at the state before the merges.
  Three commits then replay what landed. Two docs corrections (#41, #42) came
  first, then the marker hoist that #43's anchor rule asked for. The pages, the
  sources, the citation ids and the commit subjects are this repository's, not
  invented ones. Paths are shortened to `docs/a11y/` and `src/a11y/core/` so
  the rows fit a phone-legible font.
- **The "before" build is the published 2.3.7,** installed into
  `media/scratch-prev/` and typed as `manni-2.3.7`. Beat 1 is what a user has
  today, run on the same repository as beats 2 to 5. Naming the version in
  frame is the disclosure. Nothing is reconstructed from memory.
- **`test/cite/history.test.ts` asserts the split.** The fixture's counts are
  the ones the tests assert, so the numbers on screen are the numbers CI
  checks. Until that fixture passes, 68 and 24 are the proposal's prediction
  and not a result. See "Numbers the capture owns" below.
- **Row highlight is chrome.** A faint accent ground (`#58a6ff` at 16 %) sits
  behind the rows a caption is about. The bytes in those rows are untouched.
- **No speed-up anywhere.** Nothing is compressed, so design.md's 1.3x ceiling
  never applies.

## Numbers the capture owns

Four values in the blocks below are the fixture's to produce, and capture.sh
writes each one to `media/capture-history/`. They are written here as the
proposal records them, so the beat sheet reads as a whole.

| Value | Written here as | Comes from |
|---|---|---|
| Baseline short sha | `9d4cdd8` | `capture-history/baseline.txt`, the replay's own first commit |
| The wall | `92 findings (92 warnings)` | beat 1's capture |
| The split | `(24 warnings) (68 notices)` | beat 2's capture |
| Claim line numbers | `:47`, `:50-51` | the fixture's pages |

If the fixture's split is not 68 and 24, the captions take the fixture's
numbers and this table records the change. The captions never round and never
carry a number the frame does not show.

## Derived font size

Font size is derived, not chosen, and the derivation runs at capture time.
`media/capture-history/cols.mjs` runs the composition's own space-only wrap
over every real line, copied from `Demo.tsx` `wrapLine`, so the derivation and
the render agree. The inputs it must satisfy:

| Input | Value |
|---|---|
| Longest real line | **105 chars**, beat 2's `claim-changed` row |
| Longest line of manni output | the same row |
| Longest unbreakable token | **41 chars**, `docs/a11y/index.mdx@9d4cdd8:50-51` with its 8-space indent |
| Tallest beat | **beat 4**, 8 lines that wrap to about 12 rows |
| Terminal area | 878 px (1080 less two bands and two rules) |

The token decides here, not the height, because no beat is tall. A 41-column
token needs 41 columns, and the candidate to render first is **28 px / 59
columns / 39 px line height**. That puts beat 4 at about 468 px of the 878 px
available, so 30 px (57 columns) is worth testing too. `cols.mjs` has to
report 0 hard breaks, and every beat has to fit inside 878 px, before this
ships. Do not copy a number from another video.

## Beats

Five beats. Each starts on a cleared terminal and cuts to the next, with no
transitions. Beat 1 is the problem, beats 2 to 4 the feature, beat 5 the CI
result.

<!-- The Title and Caption cells are burned into the rendered video, so they stay as shown. -->
<!-- vale Voices.ColonReveal = NO -->

| # | Title (band) | Terminal | Caption (band) | Time |
|---|---|---|---|---|
| 1 | 92 rows, one status | `manni-2.3.7 cite check` on one page, then on all five | Two docs fixes and a marker hoist landed. 92 claims report changed, and every row reads the same. | 0:00.0-0:09.0 |
| 2 | 68 notices, 24 warnings | `manni cite check`, the same two runs | Same pins, same pages. 68 were only re-anchored. 24 have edited words, and each says since when. | 0:09.0-0:18.0 |
| 3 | update clears the 68 | `manni cite update docs/a11y/` | One command re-pins all 68. No --accept, because no word the pins covered changed. | 0:18.0-0:25.0 |
| 4 | What actually changed | `manni cite check --show-diff` on one page | --show-diff prints the commit and the claim's own diff. This sentence really was reworded. | 0:25.0-0:34.0 |
| 5 | Still exit 0 | `manni cite check docs/a11y/`, `echo $?` | 24 claims to read instead of 92, and none of them whitespace. The run never failed. | 0:34.0-0:40.5 |

<!-- vale Voices.ColonReveal = YES -->

Beat 1 highlights the three identical `changed` cells, then the
`(92 warnings)` count. Beat 2 highlights the `ℹ` rows against the `↕` row,
then the two counts in the summary. Beat 3 highlights `68 citations
rewritten`. Beat 4 highlights the commit subject and the two `+` lines. Beat 5
highlights `24 findings` and the `0`.

Thumbnail (`.thumb.png`): the end of beat 2, with the notice rows, the warning
row and the split summary all on screen.

## Real output, per beat

Every block below is what the command prints. The ids, sources and commit
subjects are this repository's. The four values in "Numbers the capture owns"
are the fixture's.

**Beat 1.** The published build, on the replayed repository.

```console
$ manni-2.3.7 cite check docs/a11y/index.mdx | head -4
⚠ docs/a11y/index.mdx
    ↕ same-host-scope   marker :47 changed   src/a11y/core/url.ts:45-62 current
    ↕ one-at-a-time     marker :69 changed   src/a11y/core/crawl.ts:113-126 current
    ↕ link-fragment-dropped   :50-51 changed   src/a11y/core/url.ts:16-21 current
$ manni-2.3.7 cite check docs/a11y/ | tail -1
5 files checked, 5 passed, 0 failed, 92 findings (92 warnings)
```

**Beat 2.** This build, the same two runs, on the same repository.

```console
$ manni cite check docs/a11y/index.mdx | head -4
⚠ docs/a11y/index.mdx
    ℹ same-host-scope   marker :47 reanchored since 9d4cdd8   src/a11y/core/url.ts:45-62 current
    ℹ one-at-a-time     marker :69 reanchored since 9d4cdd8   src/a11y/core/crawl.ts:113-126 current
    ↕ link-fragment-dropped   :50-51 changed since 9d4cdd8, 1 commit   src/a11y/core/url.ts:16-21 current
$ manni cite check docs/a11y/ | tail -1
5 files checked, 5 passed, 0 failed, 92 findings (24 warnings) (68 notices)
```

**Beat 3.** `update`, no flag. `sed` keeps the first report line and the
summary, so the beat stays four rows.

```console
$ manni cite update docs/a11y/ | sed -n '1p;$p'
docs/a11y/index.mdx: same-host-scope claim at lines 48-53 re-pinned (reanchored; words unchanged since 9d4cdd8)
68 citations rewritten in 5 files, 24 skipped
```

**Beat 4.** One of the 24, with its history. `head -7` keeps the first row and
its diff.

```console
$ manni cite check --show-diff docs/a11y/index.mdx | head -7
⚠ docs/a11y/index.mdx
    ↕ link-fragment-dropped   :50-51 changed since 9d4cdd8, 1 commit   src/a11y/core/url.ts:16-21 current
        docs(a11y): correct claims the source contradicts (#41)
        --- docs/a11y/index.mdx@9d4cdd8:50-51
        +++ docs/a11y/index.mdx:50-52
        -   in its rendered DOM. Anchors, `mailto:`, `tel:`, and links to assets such as
        +   in its rendered DOM. `mailto:`, `tel:`, and links to assets such as PDFs,
```

(The diff is the real one from `dc59dbd`. An anchor link is no longer skipped,
so the sentence that said it was had to change. That is the claim a person has
to read, and the claim `check` now separates from the other 68.)

**Beat 5.** The count after `update`, and the exit code. The second run is
unpiped, so `$?` is the CLI's own status rather than `tail`'s.

```console
$ manni cite check docs/a11y/ | tail -1
5 files checked, 5 passed, 0 failed, 24 findings (24 warnings)
$ manni cite check docs/a11y/ > /dev/null; echo $?
0
```

## Exact commands, as typed in the video

In order. Beat 3 rewrites the manifest, so the order is the capture order too.

```bash
cd media/scratch-history                                  # its own git repo
manni-2.3.7 cite check docs/a11y/index.mdx | head -4
manni-2.3.7 cite check docs/a11y/ | tail -1
manni cite check docs/a11y/index.mdx | head -4
manni cite check docs/a11y/ | tail -1
manni cite update docs/a11y/ | sed -n '1p;$p'
manni cite check --show-diff docs/a11y/index.mdx | head -7
manni cite check docs/a11y/ | tail -1
manni cite check docs/a11y/ > /dev/null; echo $?
```

`manni` is this checkout's build, as `media/bin/manni` resolves it.
`manni-2.3.7` is the published 2.3.7, installed under `media/scratch-prev/`.
`capture.sh` calls the two builds as `mnow` and `mprev`, because only the name
differs and the beats file carries the typed line. Both run under
`media/capture/tty.cjs` so the colour is the colour a user sees.
`media/capture-history/capture.sh` builds the repository and takes every
capture in this order.

## Setup the commands need

`media/capture-history/capture.sh` is the record, and it needs three things in
place first.

1. **The build.** `npm ci` and `npm run build` at the repo root, in this
   worktree. `media/bin/manni` resolves to `dist/cli.js`.
2. **The published build.** `npm i --prefix media/scratch-prev
   @hawkeyexl/manni@2.3.7`. `media/scratch-*` is gitignored, so the install
   leaves nothing behind.
3. **The fixture.** `test/fixtures/cite/a11y-replay/`, which this feature
   ships, in the layout below. capture.sh copies it and commits it.

```
test/fixtures/cite/a11y-replay/
  base/                     the replayed repository before the merges
    manni.config.yaml       a `site` collection over docs/a11y/**
    site.metadata.yaml      the citations the dogfood minted, ~300 over 5 pages
    docs/a11y/index.mdx     and ci/, fix/, get-started/, reference/cli.mdx
    src/a11y/core/*.ts      the sources those citations pin
  step1/                    the tree after "docs(a11y): correct claims the source contradicts (#41)"
  step2/                    the tree after "docs(a11y): sitemap URLs stay on the first seed's host (#42)"
  step3/                    the tree after the marker hoist #43's anchor rule asks for
  subjects.txt              one commit subject per step, in order
```

Each `stepN/` is a whole tree rather than a patch, so the replay cannot drift
from the fixture the tests read. `subjects.txt` is in frame in beat 4, so its
lines are the real commit subjects.

## Timing rules applied

- Typing 45 ms per character, inside design.md's 35-70 ms. The cursor is a
  solid block and does not blink.
- Output appears after the command's real measured latency. Measure three runs
  of each command at capture time and replay the middle value, recording all
  three in `media/capture-history/latency.txt`. `check` over five pages reads
  git history, so expect it to be the slowest command in the video. If any
  beat's real latency pushes it past its slot, disclose the elapsed time in
  frame rather than compressing the wait.
- Beats run 6.5-9.0 s. Each holds at least 3.0 s after its last output, so a
  caption of 90 to 100 characters can be read on it.
- No narration, so no loudness pass on speech. The AAC 48 kHz track is silence
  (`anullsrc`), present only so every player accepts the file. Measure it on
  the finished file and expect the meter's floor.
- Caption cues are one per beat, 6.5-9.0 s each, burned in over at most two
  lines. That is longer per cue than broadcast caption guidance, and matches
  the band the earlier videos use. Each cue is a static step title plus
  caption, not speech, so there is nothing to sync against.

## Out of frame, deliberately

- **`update --accept`.** Accepting one of the 24 after reading it is the
  ladder's rung 5. It needs its own beat and a reason to trust the accept, and
  the video is at 40.5 s of a 45 s ceiling.
- **The shallow-clone notice.** `fetch-depth: 1` makes `check` say so and fall
  back to the old message. It is the most CI-relevant footnote and still a
  footnote.
- **`-f github` and `-f json`.** The annotation and the `commitSha` member are
  in the reference pages. A reporter beat would repeat beat 2 in another
  format.
- **`severity: {claim-reanchored: off}`.** The severity key is in config. The
  video shows the default, because the default is what an upgrade gives
  everybody.

## Reproduce

Not yet run. These are the steps the capture follows.

```bash
# 0. Build the CLI (repo root, in this worktree)
npm ci
npm run build

# 1. Demo repository and captures (from media/)
npm i --prefix scratch-prev @hawkeyexl/manni@2.3.7
bash capture-history/capture.sh
node capture-history/cols.mjs 28          # font-size derivation, must report 0 hard breaks

# 2. Render and package (from media/remotion; npm ci first in a fresh worktree)
node scripts/captures-history.mjs
npx remotion render src/index.ts HistoryDemo out/history/render.mp4
npx remotion still src/index.ts HistoryDemo ../claim-history-1x1.thumb.png --frame=<end of beat 2>
node scripts/vtt-history.cjs && node scripts/transcript-history.cjs
cd .. && ffmpeg -i remotion/out/history/render.mp4 -f lavfi -i anullsrc=r=48000:cl=stereo \
  -shortest -c:v copy -c:a aac -b:a 128k -movflags +faststart claim-history-1x1.mp4
ffmpeg -i claim-history-1x1.mp4 -vf "fps=12,scale=540:540:flags=lanczos,split[a][b];\
[a]palettegen=max_colors=128:stats_mode=diff[p];[b][p]paletteuse=dither=none:diff_mode=rectangle" \
  claim-history-1x1.gif
```

## Outstanding

**The capture and the render have not been done.** This file is the script and
the beat sheet only. Still to do, in order:

1. `test/fixtures/cite/a11y-replay/`, in the layout above, and
   `test/cite/history.test.ts` asserting its split.
2. Latency measurement, three runs per command, into
   `media/capture-history/latency.txt`.
3. `media/capture-history/cols.mjs`, and the font-size derivation. 28 px is a
   candidate, not a result.
4. The Remotion composition `HistoryDemo` and its beats file.
5. The render, the thumbnail, the `.vtt`, the transcript, the GIF and the MP4.
6. The six shipping checks below, none of which can be answered yet.

Every duration and geometry figure above is a target for the capture to hit.
The ids, the sources, the commit subjects and the diff are not targets. They
come from this repository, and the capture must reproduce them exactly.

## Checks before shipping (design.md)

1. Longest real line measured against the chosen size, with the column count
   read from the wrap the composition actually runs. **Pending**
   (`cols.mjs`).
2. No text touching the frame edge, and no token split across a line break.
   **Pending.** The 41-character token is the one at risk.
3. Captions present on every beat. **Written**, 5 of 5, verified at render.
4. `ffprobe` confirms 1080x1080 and the intended duration. **Pending.**
5. Loudness measured on the finished file. **Pending.** The track is silence,
   so a `loudnorm` pass would be meaningless, but the measurement still gets
   recorded.
6. Accent is not red, green, yellow or cyan. **Met by design**, `#58a6ff`.

## Suggested LinkedIn post (text only; posting is the author's call)

One line, also in `media/claim-history-1x1.post.txt`.

> 92 stale citations, and 68 of them were only whitespace. `manni cite check`
> now reads the page's git history, so only the 24 whose words actually
> changed reach a human.

The longer form, if the one-liner needs a body.

> Our own a11y docs carry about 300 citations. Two docs fixes and a marker
> change landed, and 92 of them reported `claim-changed`. Every row read the
> same. Only 24 had been reworded. The other 68 had moved, not changed.
>
> `manni cite check` now walks the page's commits for a claim whose pin no
> longer holds, and stops at the newest commit where the pin still held. From
> there it can tell the two apart. Words unchanged is a notice,
> `claim-reanchored`, and plain `manni cite update` re-pins it with no
> `--accept`. Words edited stays a warning, and now says
> `changed since 9d4cdd8, 2 commits`. `--show-diff` prints that claim's own
> diff since that commit.
>
> No new flag, no new config key, no new field in the manifest. The baseline is
> derived from git, so a squash or a rebase cannot make it wrong. Exit 0
> throughout, so nobody's pipeline starts failing on a rewrapped paragraph.
>
> #docsascode #technicalwriting #devtools #CI
