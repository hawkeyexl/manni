# The video script for the manni vocabularies in the default set

**Objective:** Show that a bare `manni meta validate` now holds a page to the
manni vocabularies. A page with a title and no description fails on
`manni:core:1.0.0` with exit 1. `manni meta fill` infers the description,
plus `audiences` from `manni:audience:1.0.0` and `lifecycle` from
`manni:lifecycle:1.0.0`. The same bare validate then passes with exit 0.
**Format:** 1080x1080, 30 fps, silent, captions burned in (LinkedIn autoplays muted).
**Duration:** 40.8 s (spec: 20-45 s).
**Audience:** docs engineers who own a docset's metadata (Maya) and CI
engineers who run `manni meta validate` on every pull request (Devin).
**Feature:** `566625cc feat(meta)!: register the manni vocabularies and add
them to the default set`.

Visual spec: `docs/content-strategy/design.md`. Accent `#58a6ff` (blue). Never
red, green, yellow or cyan, which manni's output uses: red `✗` and failing
footer, green `✓` and passing footer, yellow `⚠` and `warning`, cyan field
names. Terminal `#171717`, bands `#0d0d0d`, JetBrains Mono throughout. Title
band 112 px, 2 px accent rules, caption band 86 px.

## How it was made, and what is staged

Everything printed in the terminal is a real run of `cat`, `head`, `echo`,
bash's `time`, or `node dist/cli.js`. The CLI was built by `npm run build` on
`claude/frontmatter-schemas-docs-867ba4` at `b55e8f9b`, which carries
`566625cc` (Node v24.11.0, `capture/node-version.txt`). The typed command reads
`manni`, the name the shim `media/bin/manni` gives the built CLI.

- **A Remotion replay of real bytes, as in the earlier videos.** fill's and
  validate's lines run to 176 characters. A real terminal at a phone-legible
  size hard-wraps them inside a token, which design.md check 2 forbids. The
  replay wraps at spaces only. The composition `VocabulariesDemo`
  (`media/remotion/src/vocabularies/beats.ts`, shared `src/Demo.tsx`) replays
  the bytes. No output byte is edited.
- **One script builds the demo directory and takes every capture:**
  `media/vocabularies/capture/capture.sh`. It is the record of the staging.
- **The demo directory is outside the checkout, with no config.** The brief
  was a bare validate, so the repo's own `manni.config.yaml` must not be
  discovered. `capture.sh` refuses a directory inside the checkout. There is
  no `manni.config.yaml` and no `-s` in any command, so every run uses the
  default schema set.
- **Input staged from one new fixture,
  `test/fixtures/missing-description.md`.** It has a title and no
  description. It also carries `type: guide`, because `google:okf:0.1` is
  still in the default set and requires `type`. Without it the first
  validate reports two missing keys, and this video is about the one the
  vocabularies add. That is disclosed here and not in frame.
- **manni's bytes come from the TTY preload.** Every run went through
  `media/capture/tty.cjs`, which makes stdout and stderr report as a
  terminal, so the colour in the capture is the colour a terminal receives.
- **fill ran a real model, cold.** No provider is named on the command line.
  `auto` picked the `claude` CLI on the capture machine, and fill says so on
  stderr, in frame. The proposal cache lives under the project root
  (`.manni/meta/cache`), and the demo directory is rebuilt on every run, so
  the run was cold. The footer shows no `cached` count. The wording of the
  description is what that run returned. Rerunning `capture.sh` gives
  different wording.
- **`--fields` is typed, and it is load-bearing.** Without it, fill reports
  every property of all thirteen default schemas, and the `no-proposal:`
  lines alone run to 42 rows. The three fields name one member of each of
  three vocabularies: core, audience and lifecycle.
- **The wait is compressed, and the real time is on screen.**

  The fill run took just under 23 seconds. The design spec allows compressing
  a static wait only when the real elapsed time is disclosed. It names bash's
  own `time` output as the strongest form. So `time` is typed, and its three
  lines stay in frame, unedited. The replay shortens the gap between Enter and
  the output to 2 seconds. The caption says the wait is shortened.
  Typing and output run at 1x.
- **Beat 4 types `head -n 8`, and the 8 is computed.** `capture.sh` reads the
  line number of `lifecycle:` from the filled file. The whole filled file
  runs to 23 lines. That is too tall to read at this size. Lines 9 to 18 are
  the `meta-provenance:` block, which fill's own output in beat 3 already
  showed. Beat 5's warning names it at line 9. The full file is kept as
  `capture/b4-page-full.txt`.
- **The last validate passes with one warning, and the video keeps it.**
  fill records which model wrote which field as `meta-provenance`, in the
  page. `manni:ai-context:1.0.0` prefers that key outside the page, so
  validate warns and still exits 0. Hiding it would need `manni meta
  relocate`, a separate feature, and another beat.
- **Two renderings applied to the captured bytes, no edits.**
  `media/remotion/scripts/captures-vocabularies.mjs` normalises CRLF, and it
  expands `time`'s tab to 8-column stops, as `captures-a11y.mjs` does.
- **Ligatures are off for this video.** JetBrains Mono draws `---` as one
  rule. A terminal prints the characters.
- **Row highlight is chrome.** A faint accent ground (`#58a6ff` at 16%) sits
  behind the rows a caption is about. The bytes in those rows are untouched.

## Derived font size

`media/vocabularies/capture/cols.mjs` runs the replay's own space-only wrap
over every real line, from 32 px down. The longest real line is 176
characters, beat 5's `/meta-provenance` warning. The longest token including
indent is 42, so no token decides the size. The typed fill command does, at
71 characters with the prompt. It fits one row from 24 px (72 columns) down.

The video uses **23 px / 75 columns**, one step below the largest fit. At
24 px the fill command and beat 4's `description:` row each fill all 72
columns. The description row's rightmost ink then sits 23 px from the frame
edge. At 23 px every row keeps at least 40 px. fill's 84-character footer
wraps at both sizes, at a space. Line height is 32 px. The tallest beat (3)
is 20 rows, 640 px of the 838 px available.

## Beats (storyboard)

Five static full-frame shots. Every beat starts on a cleared terminal and cuts
to the next, with no transitions.

| # | Title (band) | Terminal | Caption (band) | Time |
|---|---|---|---|---|
| 1 | A page, no description | `cat page.md` | A guide with a type and a title, and no description. No config, no schema named. | 0:00.0-0:05.6 |
| 2 | The default set checks it | `manni meta validate page.md`, `echo $?` | A bare validate now applies manni:core:1.0.0, which requires a description: exit 1. | 0:05.6-0:14.4 |
| 3 | fill proposes the fields | `time manni meta fill page.md --fields description,audiences,lifecycle` | fill infers the description, plus audiences and lifecycle. It took 23 s; the wait is shortened. | 0:14.4-0:25.2 |
| 4 | Written to the page | `head -n 8 page.md` | The three values are frontmatter now. The lines below them record which model wrote them. | 0:25.2-0:31.2 |
| 5 | Valid, exit 0 | `manni meta validate page.md`, `echo $?` | The same bare validate passes, with exit 0. The warning is ai-context asking for a sidecar. | 0:31.2-0:40.8 |

Beat 1 highlights the title. Beat 2 highlights the `description` error and
its `[manni:core:1.0.0]` tag. Beat 3 highlights the three proposals and
`real`. Beat 4 highlights the three written keys, and beat 5 the passing
footer.

Thumbnail (`.thumb.png`): frame 745, the end of beat 3, with the three
proposals and `real 0m22.919s` on screen.

## Real output quoted

Beat 2, `manni meta validate page.md` (exit 1):

```
✗ page.md
    (root)  must have required property 'description'  (line 1)  [manni:core:1.0.0]

1 file checked, 0 passed, 1 failed, 1 error
```

Beat 3, `time manni meta fill page.md --fields description,audiences,lifecycle` (exit 0):

```
inference: provider "auto" — auto-selected "claude-cli". Pass an explicit `provider` to pin it.
manni: wrote meta-provenance to 1 page; the schema prefers external metadata. Run manni meta relocate to give it a manifest.
✓ page.md
    /description  A guide to fitting progressive lenses, covering measurement requirements and typical adaptation periods.  0.85
    /audiences  ["opticians","eye-care-professionals"]  0.75
    /lifecycle  draft  0.70
    meta-provenance  claude-sonnet-4-5: /description, /audiences, /lifecycle

claude-cli/claude-sonnet-4-5 · Threshold 0.7 · 1 file · 3 fields written · 0 skipped

real	0m22.919s
user	0m0.015s
sys	0m0.015s
```

Beat 5, `manni meta validate page.md` (exit 0):

```
⚠ page.md
    /meta-provenance  warning "meta-provenance" is stored in the page; manni:ai-context:1.0.0 prefers external metadata. Run manni meta relocate.  (line 9)  [location:external]

1 file checked, 1 passed, 0 failed, 0 errors, 1 warning
```

## Timing rules applied

- Typing 40 ms per character (spec: 35-70 ms). The cursor is a solid block
  and does not blink.
- validate's output appears after its real latency. The capture run plus
  three timing runs measured 584-656 ms before fill and 589-604 ms after
  (`capture/latency.txt`). The replay uses 0.60 s for both. `cat`, `head`
  and `echo` take 1-2 frames.
- fill's wait is compressed, as disclosed above.
- Beats run 5.6-10.8 s. Each holds 3.2-5.2 s after its main output, so its
  80-96 character caption can be read on it.
- No narration, so no loudness pass. The AAC 48 kHz track is silence
  (`anullsrc`), measured on the finished file. The meter reads integrated
  -70.0 LUFS (its floor) and true peak -inf dBFS.
- Caption cues are one per beat, 5.6-10.8 s each, burned in over two lines
  of about 55 characters. That is longer per cue and per line than broadcast
  caption guidance (6-7 s, about 42 characters). It matches the band the
  earlier videos use. Each cue is a static step title plus caption, not
  speech, so there is nothing to sync against.

## Exact commands, as typed in the video

```bash
cat page.md
manni meta validate page.md
echo $?
time manni meta fill page.md --fields description,audiences,lifecycle
head -n 8 page.md
manni meta validate page.md
echo $?
```

## Reproduce

```bash
# 0. Build the CLI (repo root). The claude CLI on PATH, signed in, for fill.
npm ci && npm run build

# 1. Demo directory and every capture (from anywhere; the directory must be
#    outside the checkout)
bash media/vocabularies/capture/capture.sh /tmp/manni-vocabularies-demo
node media/vocabularies/capture/cols.mjs 23      # the font-size table

# 2. Render and package (from media/remotion, after npm ci there)
node scripts/captures-vocabularies.mjs
npx tsc src/vocabularies/beats.ts --outDir scripts/out-vocabularies --module commonjs --target es2020 --resolveJsonModule --esModuleInterop --skipLibCheck
cp src/vocabularies/captures.json scripts/out-vocabularies/vocabularies/
npx remotion render src/index.ts VocabulariesDemo out/vocabularies/render.mp4
npx remotion still src/index.ts VocabulariesDemo ../vocabularies/manni-vocabularies-1x1.thumb.png --frame=745
node scripts/vtt-vocabularies.cjs && node scripts/transcript-vocabularies.cjs
cd .. && ffmpeg -i remotion/out/vocabularies/render.mp4 -f lavfi -i anullsrc=r=48000:cl=stereo -shortest -c:v copy -c:a aac -b:a 128k -movflags +faststart vocabularies/manni-vocabularies-1x1.mp4
ffmpeg -i vocabularies/manni-vocabularies-1x1.mp4 -vf "fps=12,scale=540:540:flags=lanczos,split[a][b];[a]palettegen=max_colors=128:stats_mode=diff[p];[b][p]paletteuse=dither=none:diff_mode=rectangle" vocabularies/manni-vocabularies-1x1.gif
```

The suggested LinkedIn post is `media/vocabularies/manni-vocabularies-1x1.post.txt`.
Posting is the author's call.
