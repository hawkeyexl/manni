# Video script: A first template from a page (`manni lint templates infer`)

**Objective:** Show that `manni lint templates infer` removes the blank-page
problem from `manni lint structure`. The template format is strict by default,
so a half-written template turns every real section into an
`unexpected-section` finding. `infer` reads a page that already has the shape
you want and writes the template that describes it. Save it, and the same lint
command passes. Delete a required section, and it fails at the right line with
exit 1.
**Format:** 1080x1080, 30 fps, silent, captions burned in (LinkedIn autoplays muted).
**Duration:** 43.8 s (spec: 20-45 s).
**Audience:** docs engineers adopting structure linting on a docset that already
exists (Maya), and CI engineers who need the failure to be specific (Devin).
**Feature:** `manni lint templates infer`, on branch `tool/lint-infer-v2`,
commit `d6dfd04`.

Visual spec: `docs/content-strategy/design.md`. Accent `#58a6ff` (blue).
Terminal `#171717`, bands `#0d0d0d`, JetBrains Mono throughout. Title band
112 px, 2 px accent rules, caption band 86 px.

## The accent, and why it does not collide

`manni lint structure` colours its pretty output four ways, and three of them
are in this video. Red marks `✗` and a failing summary. Green marks `✓` and a
passing summary. **Cyan marks the rule id**, as in
`manni:lint/structure/unexpected-section`. Cyan is therefore spoken for, which
is exactly the rule design.md states, and the rule two earlier videos broke.

The accent is blue, and the frame was read back rather than assumed. Sampling
the rendered beat-2 frame, the brightest pixel in the title band is `#58a6ff`
(hue 212). The brightest pixel inside a rule id is `#39c5cf` (hue 184), the
series' ANSI 36. The failing summary samples `#f85149` (hue 3). The chrome and
the cyan are 28 degrees of hue apart and never read as the same thing.

## Where the files are

This video's own files live together under `media/`. That
includes this script, the transcript, the captions, the thumbnail, the GIF,
and the suggested post. It also includes `capture/`, which holds the capture
script and every captured byte. The earlier videos keep the same files flat in
`media/` with a sibling `media/capture-<name>/`.

The composition is the exception. `media/remotion/` is one Remotion project
serving every video in the series, sharing `src/Demo.tsx`, `src/ansi.ts` and the
fonts. This video adds `src/lint/beats.ts`, `src/lint/captures.json`, the
`LintDemo` composition in `src/Root.tsx`, and three scripts under
`scripts/`. Copying the project per video would fork the replay engine.

`media/lint-templates-infer-1x1.mp4` is not committed:
`.gitignore` covers `media/**/*.mp4`.

## How it was made, and what is staged

Everything printed in the terminal is a real run of `cat`, `sed`, or
`node dist/cli.js`. The typed command reads `manni`, the name the shim
`media/bin/manni` gives the built CLI.

- **A Remotion replay of real bytes, as in the earlier videos.** The longest
  real line is 189 characters. A real terminal at a phone-legible size
  hard-wraps that inside a token, which design.md check 2 forbids. The replay
  wraps at spaces only. The composition `LintDemo`
  (`media/remotion/src/lint/beats.ts`, shared `src/Demo.tsx`) replays the
  bytes. Typing runs at 35 ms/char, then Enter, then the output after the
  command's **measured** latency. No output byte is edited.
- **The bytes come from the TTY preload.** Each command ran under
  `media/capture/tty.cjs`, which makes stdout and stderr report as a terminal.
  The pretty reporter then colours its output as it would for a person.
- **One script builds the repository and takes every capture:**
  `media/capture-lint/capture.sh`. It is the record of the staging.
- **`media/scratch-lint/` is the demo repository.** It has its own `git init`,
  with one commit by a pinned author and date. `media/scratch-*` is gitignored
  in manni, and discovery honours `.gitignore`. Nothing was committed to manni.
- **The page is a repository fixture.** `docs/rotate-key.md` is
  `test/lint/fixtures/formats/how-to.md`, copied under the name the video
  types. Nothing in it was rewritten for the camera.
- **Beat 5 breaks the page into the other fixture.** The `sed` deletes the
  `## See also` section in place. Ignoring trailing blank lines, the result is
  byte for byte `test/lint/fixtures/formats/how-to-broken.md`, the page CI
  lints. `capture.sh` asserts that, and the assertion is in
  `capture/latency.txt`. The range delete leaves the blank line that separated
  the section, which the fixture does not carry; nothing else differs.
- **One config file is staged and not shown.** `manni.config.yaml` holds
  `lint.templates: [templates.yaml]`. That is why
  `manni lint structure docs/rotate-key.md` needs no `--templates` flag, and it
  is what lets beats 2, 4 and 5 type the **same** command and get three
  different answers. Only the template underneath changes. Each command prints
  `Using manni.config.yaml (.)` itself, so the staging is disclosed on screen
  rather than hidden.
- **The stub template is the honest starting state.** `templates.yaml` at beat
  2 declares one section, `Overview`. That is what a half-finished hand-written
  template looks like, and it is why the wall appears.
- **Ligatures are off for this video.** JetBrains Mono draws `---` as one rule,
  and the page's frontmatter fences are `---`. A terminal prints three
  characters. `DemoView` takes `ligatures={false}`, as the term video does.
- **Row highlight is chrome.** A faint accent ground (`#58a6ff` at 16%) sits
  behind the rows a caption is about. The bytes in those rows are untouched.

## Derived font size

`media/capture-lint/cols.mjs` runs the replay's own space-only wrap
over every real line from 30 px down. The longest real line is 189 characters,
the first `unexpected-section` finding. The longest token plus indent is 43,
`manni:lint/structure/unexpected-section` at its four-space indent, so no size
in range splits a token.

Height decides this one. Beat 1 prints the whole 25-line page, which is 27 rows
including the command and the trailing prompt. At **22 px / 78 columns**, the
line height is 31 px, and beat 1 stands 837 px tall. That is inside the 838 px
the terminal band leaves after its 20 px insets. At 23 px it is 864 px and
clips.

The read-back from the render confirms both bounds. Beat 1 renders complete,
prompt included, and the rightmost ink in any beat sits at x=1034 of 1080. That
is beat 2, the widest wrapped finding row, leaving a 46 px margin.

## Beats (storyboard)

Five static full-frame shots. Every beat starts on a cleared terminal and cuts
to the next, with no transitions.

| # | Title (band) | Terminal | Caption (band) | Time |
|---|---|---|---|---|
| 1 | A page with no template | `cat docs/rotate-key.md` | This page is already the shape you want. Nothing in the repo describes that shape. | 0:00.0-0:05.7 |
| 2 | Writing one by hand | `cat templates.yaml`, `manni lint structure docs/rotate-key.md` | A half-written template makes every real section unexpected. Three findings, exit 1. | 0:05.7-0:15.1 |
| 3 | Infer it from the page | `manni lint templates infer docs/rotate-key.md` | manni lint templates infer reads the page and writes the template that describes it. | 0:15.1-0:22.3 |
| 4 | Save it, and it passes | `manni lint templates infer docs/rotate-key.md -o templates.yaml --force`, `manni lint structure docs/rotate-key.md` | Save it over the stub, and the same lint command passes. | 0:22.3-0:33.2 |
| 5 | Break the page | `sed -i '/^## See also/,$d' docs/rotate-key.md`, `manni lint structure docs/rotate-key.md`, `echo $?` | Delete the required See also section. One finding, anchored at line 23, exit 1. | 0:33.2-0:43.8 |

Beat 1 highlights the page's four `##` headings, which are the shape the rest of
the video is about. Beat 2 highlights the three `unexpected-section` findings,
which is the wall. Beat 3 highlights the four `- heading:` rules infer wrote and
the `codeBlocks:` rule it took from the fenced bash block. Beat 4 highlights the
write report and the passing summary, and beat 5 the one finding and the failing
summary.

Thumbnail (`.thumb.png`): frame 660, the end of beat 3, with the inferred
template on screen.

## Real output quoted

Beat 2, `manni lint structure docs/rotate-key.md` against the stub (exit 1):

```
Using manni.config.yaml (.)
✗ docs/rotate-key.md
    11:1  manni:lint/structure/unexpected-section  Before you start: Unexpected section "Before you start". Add a trailing rule with min: 0 to allow sections the template does not describe.
    15:1  manni:lint/structure/unexpected-section  Rotate the key: Unexpected section "Rotate the key". Add a trailing rule with min: 0 to allow sections the template does not describe.
    23:1  manni:lint/structure/unexpected-section  See also: Unexpected section "See also". Add a trailing rule with min: 0 to allow sections the template does not describe.

1 file checked, 0 passed, 1 failed, 0 skipped
```

Beat 3, `manni lint templates infer docs/rotate-key.md` (exit 0):

```
Using manni.config.yaml (.)
templates:
  how-to:
    heading: Rotate an API key
    sections:
      - heading: Overview
        contains:
          paragraphs:
            min: 1
      - heading: Before you start
        contains:
          paragraphs:
            min: 1
      - heading: Rotate the key
        contains:
          paragraphs:
            min: 1
          codeBlocks:
            min: 1
            language: bash
      - heading: See also
        contains:
          paragraphs:
            min: 1
```

Beat 4, the write and the pass (exit 0 and exit 0):

```
Using manni.config.yaml (.)
Wrote template "how-to" to templates.yaml
```

```
Using manni.config.yaml (.)
✓ docs/rotate-key.md

1 file checked, 1 passed, 0 failed, 0 skipped
```

Beat 5, after the `sed` (exit 1):

```
Using manni.config.yaml (.)
✗ docs/rotate-key.md
    23:1  manni:lint/structure/missing-section  Rotate an API key: Missing section "See also"

1 file checked, 0 passed, 1 failed, 0 skipped
```

## Timing rules applied

- Typing 35 ms per character (spec: 35-70 ms). The cursor is a solid block and
  does not blink.
- Output appears after the command's real measured latency, from the capture
  run plus three timing runs (`media/capture-lint/latency.txt`).
  `lint structure` took 742-815 ms, `templates infer` to stdout 702-787 ms, and
  `templates infer -o` 714-804 ms. The replay uses 0.78, 0.75 and 0.76 s, and
  1-2 frames for `cat`, `sed` and `echo`. Nothing is sped up, so the 1.3x
  ceiling does not apply.
- Beats run 5.7-10.8 s. Each holds 1.1-4.0 s after its main output, so the
  55-84 character caption can be read on it.
- No narration, so no loudness pass. The AAC 48 kHz track is digital silence,
  measured on the finished file rather than assumed from the filter. It
  measures integrated `-inf` LUFS, true peak `-inf` dBTP, LRA 0.0 LU.
- Caption cues are one per beat, 5.7-10.8 s each, burned in over two lines of
  about 45 characters. That is longer per cue than broadcast caption guidance
  (6-7 s), and it matches the band the earlier videos use. Each cue is a static
  step title plus caption, not speech, so there is nothing to sync against.

## Exact commands, as typed in the video

```bash
cd media/scratch-lint          # its own git repo
cat docs/rotate-key.md
cat templates.yaml
manni lint structure docs/rotate-key.md
manni lint templates infer docs/rotate-key.md
manni lint templates infer docs/rotate-key.md -o templates.yaml --force
manni lint structure docs/rotate-key.md
sed -i '/^## See also/,$d' docs/rotate-key.md
manni lint structure docs/rotate-key.md
echo $?
```

## Reproduce

```bash
# 0. Build the CLI (repo root)
npm ci && npm run build

# 1. Demo repository and every capture (from anywhere)
bash media/capture-lint/capture.sh
node media/capture-lint/cols.mjs 22      # the font-size table

# 2. Render and package (from media/remotion, after npm ci there)
node scripts/captures-lint.mjs
npx tsc src/lint/beats.ts --outDir scripts/out-lint --module commonjs --target es2020 \
  --resolveJsonModule --esModuleInterop --skipLibCheck
cp src/lint/captures.json scripts/out-lint/lint/
npx remotion render src/index.ts LintDemo out/lint/render.mp4
npx remotion still src/index.ts LintDemo \
  ../lint-templates-infer-1x1.thumb.png --frame=660
node scripts/vtt-lint.cjs && node scripts/transcript-lint.cjs
cd .. && ffmpeg -i remotion/out/lint/render.mp4 -f lavfi -i anullsrc=r=48000:cl=stereo \
  -shortest -c:v copy -c:a aac -b:a 128k -movflags +faststart \
  lint-templates-infer-1x1.mp4
ffmpeg -i lint-templates-infer-1x1.mp4 \
  -vf "fps=12,scale=540:540:flags=lanczos,split[a][b];[a]palettegen=max_colors=128:stats_mode=diff[p];[b][p]paletteuse=dither=none:diff_mode=rectangle" \
  lint-templates-infer-1x1.gif
```

The suggested LinkedIn post is
`media/lint-templates-infer-1x1.post.txt`. Posting is the
author's call.
