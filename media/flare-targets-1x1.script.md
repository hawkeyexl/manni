# Video script: MadCap Flare targets (`manni lint`, `manni graph`, `manni meta`)

**Objective:** Show that manni reads a MadCap Flare topic the way its target
builds it. The project comes from the nearest `.flprj` and the target from
`tools.flare.target`. Snippets expand in place. Variables resolve with the
target's override, and content the target excludes by condition is gone.
Index keyword markers become the page's `keywords`.
**Format:** 1080x1080, 30 fps, silent, captions burned in (LinkedIn autoplays muted).
**Duration:** 43.7 s (spec: 20-45 s).
**Audience:** docs engineers who own a Flare project (Maya). They want checks
and a graph that match what readers see. Also the CI engineer who wires them
in (Devin).
**Feature:** proposal 0125, Part 2, branch `claude/flare-targets` (committed
at capture time, `dist/` built from it).

Visual spec: `docs/content-strategy/design.md`. Accent `#58a6ff` (blue). Never
red, green, yellow or cyan. In beat 2 manni prints the `▸` marker cyan and the
`→` arrow green, so the accent stays blue. Terminal `#171717`, bands
`#0d0d0d`, JetBrains Mono throughout. Title band 112 px, 2 px accent rules,
caption band 86 px.

## How it was made, and what is staged

Everything printed in the terminal is a real run of `grep` or
`node dist/cli.js`. The typed command reads `manni`, the name the shim
`media/bin/manni` gives the built CLI.

- **A Remotion replay of real bytes, as in the earlier videos.** The
  composition `FlareTargetsDemo` (`media/remotion/src/flare-targets/beats.ts`,
  shared `src/Demo.tsx`) replays the bytes. Typing runs at 35 ms/char, then
  Enter, then the output after the command's measured latency. No output byte
  is edited.
- **manni's bytes come from the TTY preload.** Every manni run went through
  `media/capture/tty.cjs`, so the colours are what a terminal receives.
- **One script builds the repository and takes every capture:**
  `media/capture-flare-targets/capture.sh`. It is the record of the staging.
- **Input is a fixture, unchanged.** `media/scratch-flare-targets/` holds
  `test/fixtures/flare/widget/` as committed at HEAD, taken with `git archive`
  so no untracked test cache comes along. It has its own `git init` and one
  commit. Config discovery stops there and never reaches manni's own
  `manni.config.yaml`. `media/scratch-*` is gitignored.
- **The working directory is `C:\flare`,** a directory junction to the scratch
  repository. `graph build` and `graph export` print the absolute path they
  wrote, and the real path would be a 150-character line naming the user's
  home. `cwd.cjs` starts the CLI there as spelled. The junction is removed when
  the script ends.
- **Beat 2's lint output is shown whole,** 13 lines. No grep was needed: the
  `· flare` line and the `before-you-start ← "Before you start"` row both fit.
  The template is given with `-t tgdp:how-to:1.6` so the alignment shows the
  snippet's heading filling a section.
- **Beat 3 is two runs typed as one line.** `manni graph build && manni graph
  export chunks -o out` was captured as two runs, one after the other:
  `build.ans` lands after build's latency, then `export.ans` after export's.
  Export's two stderr notices (no docevals report, no vector sidecar) are part
  of its real output and stay on screen.
- **The passage check is `grep`, not `jq`.** `jq` is not installed on the
  capture machine. `grep -m1 -o "Version [0-9.]* needs Node 20" out/*.jsonl`
  prints the resolved sentence once; without `-m1` it prints it twice, because
  two of the eleven chunks hold it. `grep -rc "prints
  only" out` counts the PrintOnly paragraph's text in both export files: 0 and 0.
- **Ligatures are off for this video.** JetBrains Mono draws `</` and `/>`
  as single glyphs; a terminal prints the characters.
- **Row highlight is chrome.** A faint accent ground (`#58a6ff` at 16%) sits
  behind the rows a caption is about. The bytes in those rows are untouched.

## Derived font size

`media/capture-flare-targets/cols.mjs` runs the replay's own space-only wrap
over every real line from 30 px down. No token is too wide at any size from 30
px to 18 px. The deciding lines are lint's aligned rows in beat 2. The
`· flare` row is 76 characters. Wrapping it would break the alignment the beat
is about. At 22 px (78 columns) the typed lint command lands on exactly 78
and the export notice wraps. **21 px / 82 columns** keeps every lint row whole.
Line height is 29 px.

**Beat 1 runs at 20 px / 86 columns** through the existing per-beat `type`.
At 21 px the highlighted `HTML5.fltar` line (83 characters) wraps inside its
`<Variable>` tag; at 20 px it is whole. The topic's Version line is 87
characters and wraps at a space at both sizes, leaving `20.</p>` on its own
row. The `General.flvar` line (120) wraps once at a space. The tallest beat is
2, at 15 rows, 435 px of the 838 px available. In the render the widest row's
rightmost ink (the HTML5.fltar line in beat 1) sits at about x=1052 of 1080.

## Beats (storyboard)

Four static full-frame shots. Every beat starts on a cleared terminal and cuts
to the next, with no transitions.

| # | Title (band) | Terminal | Caption (band) | Time |
|---|---|---|---|---|
| 1 | A Flare topic as written | `grep -E 'variable\|snippet\|PrintOnly' Content/Topics/Install.htm`, `grep -r ProductVersion Project` | Install.htm uses a variable, a snippet and a PrintOnly paragraph. HTML5 sets ProductVersion to 4.3. | 0:00.0-0:08.9 |
| 2 | Project and target, found | `manni lint structure Content/Topics/Install.htm -t tgdp:how-to:1.6 --explain` | lint finds Widget.flprj and the HTML5 target from config. The snippet's h2 fills before-you-start. | 0:08.9-0:17.5 |
| 3 | Passages as HTML5 builds them | `manni graph build && manni graph export chunks -o out`, `grep -m1 -o "Version [0-9.]* needs Node 20" out/*.jsonl`, `grep -rc "prints only" out` | Graph passages carry the text HTML5 builds: version 4.3, and the PrintOnly paragraph is gone. | 0:17.5-0:34.3 |
| 4 | Index keywords, read | `grep keyword Content/Topics/Install.htm`, `manni meta get keywords Content/Topics/Install.htm` | Index keyword markers become the keywords field. | 0:34.3-0:43.7 |

Beat 1 highlights the PrintOnly paragraph and the HTML5.fltar override. Beat 2
highlights the `· flare` row and the `before-you-start` row. Beat 3 highlights
the resolved sentence and the two zero counts, and beat 4 the keyword marker and
the `keywords=` row.

Thumbnail (`.thumb.png`): frame 1026, the end of beat 3, with the resolved
sentence and the zero counts on screen.

## Real output quoted

Beat 2, `manni lint structure ... --explain` (exit 0, ANSI stripped):

```
Using manni.config.yaml (.)
▸ Content/Topics/Install.htm
    · flare                Widget.flprj, target HTML5 (tools.flare.target)
    → cli                  tgdp:how-to:1.6  --template
    alignment
      (page)                 ← "Installing the widget"
        overview               ← (missing)
        before-you-start       ← "Before you start"
        task                   ← "Steps"
          sub-task               ← (none)
        see-also               ← (missing)

1 file, 1 routed, 0 unrouted
```

Beat 3 (build and export exit 0):

```
Wrote C:\flare\graph\graph.ttl (4 docs, 133 triples, 2 concepts)
manni: no docevals report is configured, so records carry no eval verdicts.
manni: no vector sidecar, so chunks carry no vectors and retrieval is lexical only; configure graph.embed to add them.
Wrote 11 chunks to C:\flare\out\chunks.json
Version 4.3 needs Node 20
out/chunks.en-US.jsonl:0
out/chunks.json:0
```

Beat 4 (exit 0):

```
Using manni.config.yaml (.)
Content/Topics/Install.htm: keywords=["install","setup"] (asserted)
```

## Timing rules applied

- Typing 35 ms per character (spec: 35-70 ms). The cursor is a solid block
  and does not blink. No speed-up anywhere, and no wait is compressed.
- Output appears after the command's measured latency. That comes from the
  capture run plus three timing runs (`media/capture-flare-targets/latency.txt`).
  The ranges are lint 1251-1338 ms, build 2168-3024 ms, export 3223-4894 ms and
  get 763-869 ms. The
  replay uses 1.26, 2.2, 3.25 and 0.78 s, the low end of each range, and 2
  frames for `grep`. Beat 3 shows the cursor waiting through export's 3.25 s.
- Beats run 8.6-16.8 s. Each holds 3.3-3.8 s after its main output, and the
  48-101 character caption is on screen for the whole beat.
- No narration, so no loudness pass. The AAC 48 kHz track is silence
  (`anullsrc`). Measured on the finished file with `ebur128=peak=true`, it is
  -70.0 LUFS integrated (the meter's floor) and -inf dBFS true peak.
- Caption cues are one per beat, 8.6-16.8 s each, burned in over at most two
  lines of about 52 characters. That is longer per cue and per line than
  broadcast caption guidance (6-7 s, about 42 characters). It matches the band
  the earlier videos use. Each cue is a static step title plus caption, not
  speech, so there is nothing to sync against.

## Reproduce

```bash
# 0. Build the CLI (repo root).
npm ci && npm run build

# 1. Demo repository and every capture (from anywhere; needs C:\flare free)
bash media/capture-flare-targets/capture.sh
node media/capture-flare-targets/cols.mjs 21   # run from media/: the font-size table

# 2. Render and package (from media/remotion, after npm ci there)
node scripts/captures-flare-targets.mjs
npx tsc --ignoreConfig src/flare-targets/beats.ts --outDir scripts/out-flare-targets --module commonjs --target es2020 --resolveJsonModule --esModuleInterop --skipLibCheck
cp src/flare-targets/captures.json scripts/out-flare-targets/flare-targets/
npx remotion render src/index.ts FlareTargetsDemo out/flare-targets/render.mp4
npx remotion still src/index.ts FlareTargetsDemo ../flare-targets-1x1.thumb.png --frame=1026
node scripts/vtt-flare-targets.cjs && node scripts/transcript-flare-targets.cjs
cd .. && ffmpeg -i remotion/out/flare-targets/render.mp4 -f lavfi -i anullsrc=r=48000:cl=stereo -shortest -c:v copy -c:a aac -b:a 128k -movflags +faststart flare-targets-1x1.mp4
ffmpeg -i flare-targets-1x1.mp4 -vf "fps=12,scale=540:540:flags=lanczos,split[a][b];[a]palettegen=max_colors=128:stats_mode=diff[p];[b][p]paletteuse=dither=none:diff_mode=rectangle" flare-targets-1x1.gif
```

The suggested LinkedIn post is `media/flare-targets-1x1.post.txt`. Posting is
the author's call.
