# Video script for docevals over every format (`manni docevals`)

**Objective:** Show that `manni docevals` grades every format manni's
metadata tool reads, not only Markdown and MDX. Four pages in DITA,
AsciiDoc, reStructuredText and HTML each carry a TODO line. One run grades all
four, and each finding names the line in the page's own file.
**Format:** 1080x1080, 30 fps, silent, captions burned in (LinkedIn autoplays muted).
**Duration:** 25.6 s (spec: 20-45 s).
**Audience:** docs engineers whose pages are not Markdown (Maya). They want
evals on their DITA, AsciiDoc, RST or Flare topics. Also the CI engineer who
wires the run in (Devin).
**Feature:** `feat(docevals): read every format meta reads`, branch
`claude/docevals-formats` (committed at capture time, `dist/` built from it).

Visual spec: `docs/content-strategy/design.md`. Accent `#58a6ff` (blue). Never
red, green, yellow or cyan. manni prints `FAIL`, `error` and `below target` in
red, so the accent stays blue. Terminal `#171717`, bands `#0d0d0d`, JetBrains
Mono throughout. Title band 112 px, 2 px accent rules, caption band 86 px.

## How it was made, and what is staged

Everything printed in the terminal is a real run of `ls`, `grep`, `cat` or
`node dist/cli.js`. The typed command reads `manni`, the name the shim
`media/bin/manni` gives the built CLI.

- **A Remotion replay of real bytes, as in the earlier videos.** The
  composition `DocevalsFormatsDemo` (`media/remotion/src/docevals-formats/beats.ts`,
  shared `src/Demo.tsx`) replays the bytes. Typing runs at 40 ms/char, then
  Enter, then the output after the command's measured latency. No output byte
  is edited.
- **manni's bytes come from the TTY preload.** The docevals run went through
  `media/capture/tty.cjs`, so the colours are what a terminal receives.
- **One script builds the repository and takes every capture:**
  `media/capture-docevals-formats/capture.sh`. It's the record of the staging.
- **Input is a fixture, unchanged.** `media/scratch-docevals-formats/` holds
  `test/docevals/fixtures/formats/` as committed at HEAD, taken with
  `git archive` so no untracked test cache comes along. It has its own
  `git init` and one commit. Config discovery stops there and never reaches
  manni's own `manni.config.yaml`. `media/scratch-*` is gitignored.
- **Nothing is edited.** The TODO lines are in the fixture as committed. So is
  each page's `{page}.meta.yaml` manifest, which declares one `tool:regex`
  `not-contains` eval.
- **The working directory is `C:\formats`,** a directory junction to the
  scratch repository, as in flare-resources. `cwd.cjs` starts the CLI there as
  spelled. The junction is removed when the script ends.
- **`ls` is laid out for the frame.** On a terminal, `ls` sets its names in
  columns to the terminal's width. Written to a file, it prints one per line.
  The script runs `ls -C -T 0 -w 72`, the layout a 72-column terminal gets,
  with spaces where a terminal draws tabs. The screen shows `ls Content`.
- **Beat 3 is shown whole.** The run prints 23 lines, up to 112 characters
  wide. Nothing is trimmed, so the red `FAIL` rows, the dimmed guidance and the
  suite summary all stay. Beat 3 drops to a smaller type size to fit, below.
- **The judge beat is not shown.** The LLM judge also reads these formats. It
  reads an HTML page as text and a Flare topic as its target builds it. That
  needs a model, so the video runs `--deterministic-only` and makes no claim
  about the judge.
- **Ligatures are off for this video.** JetBrains Mono draws `//` in the Guide
  URL as one glyph, and a terminal prints the characters.
- **Row highlight is chrome.** A faint accent ground (`#58a6ff` at 16%) sits
  behind the rows a caption is about. The bytes in those rows are untouched.

## Derived font size

`media/capture-docevals-formats/cols.mjs` runs the replay's own wrap over every
real line from 30 px down. A row breaks at a space. The longest line is beat
3's `error:10` row, at 112 characters. No size from 30 px to 18 px keeps it
whole, so it wraps at a space under its own 7-column indent.

**Beats 1 and 2 run at 24 px / 72 columns.** Their longest line is the second
`ls` row, at 68 characters, so 72 columns keeps it whole. Line height is 34 px.

**Beat 3 runs at 19 px / 91 columns** through the per-beat `type`. Its 30 rows
at 24 px would be 1020 px tall, and the terminal has 838 px. At 20 px they're
840 px, 2 px over. At 19 px they're 810 px. Each `error` row wraps once, after
`Remove or`. In the render the widest row's rightmost ink sits at about x=990
of 1080.

## Beats (storyboard)

Three static full-frame shots. Every beat starts on a cleared terminal and cuts
to the next, with no transitions. The brief's suggested order put the run
second. The manifest comes second here, so the video ends on the run and its
exit code.

| # | Title (band) | Terminal | Caption (band) | Time |
|---|---|---|---|---|
| 1 | Four formats, four TODOs | `ls Content`, `grep -n TODO Content/*.{dita,adoc,rst,htm}` | DITA, AsciiDoc, RST and HTML, each with a TODO. | 0:00.0-0:08.8 |
| 2 | The eval sits beside the page | `cat Content/topic.meta.yaml` | Markup takes no YAML block. A manifest holds it. | 0:08.8-0:15.2 |
| 3 | docevals grades every format | `manni docevals run --deterministic-only; echo $?` | Each finding names the page's own line. Exit 1. | 0:15.2-0:25.6 |

Beat 1 highlights the four `grep` rows. Beat 2 highlights the manifest's page
key and the `not-contains` options row. Beat 3 highlights the four `error`
rows and the suite summary.

Thumbnail (`.thumb.png`): frame 760, the end of beat 3, with the four findings
and the exit code on screen.

## Real output quoted

Beat 1:

```
concept.dita       guide.adoc       notes.meta.yaml  topic.htm
concept.meta.yaml  guide.meta.yaml  notes.rst        topic.meta.yaml
Content/concept.dita:8:    <p>TODO: name the flags.</p>
Content/guide.adoc:6:TODO: name the flags.
Content/notes.rst:8:TODO: name the flags.
Content/topic.htm:10:    <p>TODO: name the flags.</p>
```

Beat 2:

```
Content/topic.htm:
  evals:
    - id: no-todo
      assertion: The page carries no TODO marker.
      grader: tool:regex
      options: { pattern: "TODO", match: not-contains }
      severity: error
```

Beat 3 (exit 1, ANSI stripped, one page of four):

```
Content/topic.htm
  FAIL no-todo  Content/topic.meta.yaml:3
       error:10 [regex/found] Pattern /TODO/ found in body, expected absent. Remove or reword the matching text.
       Content/topic.meta.yaml no-todo: The page carries no TODO marker.
       Guide: https://hawkeyexl.github.io/manni/docevals/fix/

Suites
  default: 0/4 passed — 0% vs target 100% below target
1
```

The other three pages print the same block, at `concept.dita` line 8,
`guide.adoc` line 6 and `notes.rst` line 8. The full output is in
`media/capture-docevals-formats/run.ans` and the transcript.

## Timing rules applied

- Typing 40 ms per character (spec: 35-70 ms). The cursor is a solid block
  and doesn't blink. No speed-up anywhere, and no wait is compressed.
- Output appears after the command's measured latency. That comes from the
  capture run plus three timing runs
  (`media/capture-docevals-formats/latency.txt`). The docevals run took
  591-808 ms across them, and the replay uses 0.6 s, the low end. `ls`, `grep`
  and `cat` get 2 frames.
- Beats run 6.4-10.4 s. Beat 3 holds 7 s after its output, because it's the
  densest frame. Each 47-48 character caption is on screen for the whole beat.
- No narration, so no loudness pass. The AAC 48 kHz track is silence
  (`anullsrc`). Measured on the finished file with `ebur128=peak=true`, it's
  -70.0 LUFS integrated (the meter's floor) and -inf dBFS true peak.
- Caption cues are one per beat, 6.4-10.4 s each, burned in on one line of at
  most 48 characters. That's longer per cue than broadcast caption guidance
  (6-7 s). It matches the band the earlier videos use. Each cue is a static
  step title plus caption, not speech, so there is nothing to sync against.

## Reproduce

```bash
# 0. Build the CLI (repo root).
npm ci && npm run build

# 1. Demo repository and every capture (from anywhere; needs C:\formats free)
bash media/capture-docevals-formats/capture.sh
node media/capture-docevals-formats/cols.mjs 19   # run from media/: the font-size table

# 2. Render and package (from media/remotion, after npm ci there)
node scripts/captures-docevals-formats.mjs
npx tsc --ignoreConfig src/docevals-formats/beats.ts --outDir scripts/out-docevals-formats --module commonjs --target es2020 --resolveJsonModule --esModuleInterop --skipLibCheck
cp src/docevals-formats/captures.json scripts/out-docevals-formats/docevals-formats/
npx remotion render src/index.ts DocevalsFormatsDemo out/docevals-formats/render.mp4
npx remotion still src/index.ts DocevalsFormatsDemo ../docevals-formats-1x1.thumb.png --frame=760
node scripts/vtt-docevals-formats.cjs && node scripts/transcript-docevals-formats.cjs
cd .. && ffmpeg -i remotion/out/docevals-formats/render.mp4 -f lavfi -i anullsrc=r=48000:cl=stereo -shortest -c:v copy -c:a aac -b:a 128k -movflags +faststart docevals-formats-1x1.mp4
ffmpeg -i docevals-formats-1x1.mp4 -vf "fps=12,scale=540:540:flags=lanczos,split[a][b];[a]palettegen=max_colors=128:stats_mode=diff[p];[b][p]paletteuse=dither=none:diff_mode=rectangle" docevals-formats-1x1.gif
```

The suggested LinkedIn post is `media/docevals-formats-1x1.post.txt`. Posting
is the author's call.
