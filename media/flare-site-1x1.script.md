# Video script for building and previewing a MadCap Flare project (`manni site`)

**Objective:** Show that `manni site` treats a folder holding a `.flprj` as a
MadCap Flare site. `manni site build` runs `madbuild` with the project and the
target `tools.flare.target` names. `manni site preview` serves the last build
with manni's own static server, and `Default.htm` answers at `/`.
`manni site start` refuses with exit 2, because Flare has no development
server, and names the two commands to run instead.
**Format:** 1080x1080, 30 fps, silent, captions burned in (LinkedIn autoplays muted).
**Duration:** 32.7 s (spec: 20-45 s).
**Audience:** docs engineers who own a Flare project (Maya). They want one
command to build it and one to look at the result. Also the CI engineer who
runs the build in a workflow (Devin).
**Feature:** `feat(site): build and preview a Flare project`, proposal 0125,
decision 22, branch `claude/flare-site` (committed at capture time, `dist/`
built from it).

Visual spec: `docs/content-strategy/design.md`. Accent `#58a6ff` (blue). Never
red, green, yellow or cyan. None of the lines in this video carry colour, so
nothing in frame competes with the accent. Terminal `#171717`, bands
`#0d0d0d`, JetBrains Mono throughout. Title band 112 px, 2 px accent rules,
caption band 86 px.

## How it was made, and what is staged

Everything printed in the terminal is a real run of `ls`, `tail`, `curl`,
`head` or `node dist/cli.js`. The typed command reads `manni`, the name the
shim `media/bin/manni` gives the built CLI.

- **madbuild is a stand-in, not MadCap Flare, and the video says so three
  times.** This machine has no Flare and no Flare license.
  `test/fixtures/flare/madbuild-standin/` is a few lines of Node that copy each
  topic as written and write a `Default.htm` linking them. Beat 2's title band
  reads `Build, with a stand-in madbuild`. Its caption reads `Here, a stand-in,
  not MadCap Flare.` The stand-in's own output line starts
  `stand-in madbuild:`, and beat 4's page title is `Stand-in build`. The
  video makes no claim about what real Flare output looks like.
- **The stand-in is first on PATH, in its POSIX form.** Git Bash splits a
  `C:/...` entry at the colon, and the stand-in is then not found. manni finds
  `madbuild` on PATH, as it would find the real one, and passes it
  `-project Widget.flprj -target HTML5`.
- **`USERNAME=maya`.** madbuild stamps the account that runs it into the output
  path, `Output/<account>/<target>`. manni reads `USERNAME`, then the OS
  account (`src/site/core/detect.ts`). The stand-in reads the same two in the
  same order. So both say `Output/maya/HTML5`, the account the docs use, and
  `preview` serves the folder `build` wrote. Without it, the frame would carry
  this machine's account name.
- **No `manni a11y check`.** The stand-in's copies are raw topics, so a crawl
  reports a missing `lang` and `title` on each. Those findings belong to the
  stand-in, not to Flare, and would mislead.
- **A Remotion replay of real bytes, as in the earlier videos.** The
  composition `FlareSiteDemo` (`media/remotion/src/flare-site/beats.ts`, shared
  `src/Demo.tsx`) replays the bytes. Typing runs at 40 ms/char, then Enter,
  then the output after the command's measured latency. No output byte is
  edited.
- **manni's bytes come from the TTY preload.** Every manni run went through
  `media/capture/tty.cjs`. manni prints these lines without colour on a
  terminal too, so the frame has none.
- **One script builds the repository and takes every capture:**
  `media/capture-flare-site/capture.sh`. It is the record of the staging.
- **Input is a fixture, unchanged.** `media/scratch-flare-site/` holds
  `test/fixtures/flare/widget/` as committed at HEAD, taken with `git archive`
  so no untracked test cache comes along. It holds two targets, HTML5 and
  Print, and its `manni.config.yaml` sets `tools.flare.target: HTML5`. It has
  its own `git init` and one commit. Config discovery stops there and never
  reaches manni's own `manni.config.yaml`. `media/scratch-*` is gitignored.
- **The working directory is `C:\widget`,** a directory junction to the
  scratch repository, as in flare-resources. `cwd.cjs` starts the CLI there as
  spelled. The junction is removed when the script ends.
- **The second terminal is real concurrency.** The preview ran in the
  background of `capture.sh` while `curl` and `manni site start` ran in the
  foreground, against the live server. Beats 4 and 5 are that second
  terminal. Beat 5 starts on a cleared screen, at its own type size.
- **Beat 4 is trimmed with `head`, and says so on screen.** Whole, the page is
  11 lines, and its two topic links are 82 characters wide. `head -3` keeps
  the XML declaration, the `html` element and the `head` with its title.
  `curl.full.txt` keeps the whole page as the record of what `head` dropped.
- **`ls` is laid out for the frame.** Written to a file, `ls` prints one name
  per line. The script runs `ls -C -T 0 -w 72`, the layout a 72-column
  terminal gets. Here that is one row. The screen shows `ls`.
- **Ligatures are off for this video.** JetBrains Mono draws the URL's `//`
  as one glyph; a terminal prints the characters.
- **Row highlight is chrome.** A faint accent ground (`#58a6ff` at 16%) sits
  behind the rows a caption is about. The bytes in those rows are untouched.

## Derived font size

`media/capture-flare-site/cols.mjs` runs the replay's own wrap over every real
line from 30 px down. A row breaks at a space. The longest line is beat 5's
refusal, at 86 characters.

**Beats 1 to 4 run at 24 px / 72 columns.** Their longest line is beat 2's
announce, `manni: Flare in ./. Running madbuild -project Widget.flprj -target
HTML5`, at exactly 72 characters, so it stays whole. Line height is 34 px.

**Beat 5 runs at 20 px / 86 columns** through the per-beat `type`. From 24 px
down to 21 px the refusal wraps after `then manni` or `then manni site`. Both
split the command `manni site preview` across rows. At 20 px it is whole. The tallest beat is 1, at 7 rows, 238 px of the 838 px available. In
the render the widest row's rightmost ink, in beat 2, sits at about x=1056 of
1080.

## Beats (storyboard)

Five static full-frame shots. Every beat starts on a cleared terminal and cuts
to the next, with no transitions. Beat 3 ends with the server still running,
so no prompt returns.

| # | Title (band) | Terminal | Caption (band) | Time |
|---|---|---|---|---|
| 1 | A MadCap Flare project | `ls`, `tail -3 manni.config.yaml` | A .flprj marks it. The config names the HTML5 target. | 0:00.0-0:07.4 |
| 2 | Build, with a stand-in madbuild | `manni site build; echo $?` | It runs madbuild. Here, a stand-in, not MadCap Flare. | 0:07.4-0:14.2 |
| 3 | manni site preview | `manni site preview` | It serves the last build. It does not build first. | 0:14.2-0:19.5 |
| 4 | Default.htm answers at / | `curl -s http://127.0.0.1:4321/ \| head -3` | In a second terminal, / is the stand-in's Default.htm. | 0:19.5-0:26.0 |
| 5 | No development server | `manni site start; echo $?` | site start names the two commands to run. Exit 2. | 0:26.0-0:32.7 |

Beat 1 highlights `Widget.flprj` and `target: HTML5`. Beat 2 highlights
manni's announce and the stand-in's line. Beat 3 highlights the URL. Beat 4
highlights the `Stand-in build` title. Beat 5 highlights the refusal.

Thumbnail (`.thumb.png`): frame 420, the end of beat 2, with the stand-in
named in the title band, the caption and its own output line.

## Real output quoted

Beat 1:

```
Content  Project  Widget.flprj  manni.config.yaml  schemas
tools:
  flare:
    target: HTML5
```

Beat 2 (exit 0):

```
manni: Flare in ./. Running madbuild -project Widget.flprj -target HTML5
stand-in madbuild: built HTML5 into Output/maya/HTML5
0
```

Beat 3 (still running):

```
http://127.0.0.1:4321/
```

Beat 4:

```
<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml">
  <head><title>Stand-in build</title></head>
```

Beat 5 (exit 2):

```
manni: Flare has no development server. Run manni site build, then manni site preview.
2
```

## Timing rules applied

- Typing 40 ms per character (spec: 35-70 ms). The cursor is a solid block
  and does not blink. No speed-up anywhere, and no wait is compressed.
- Output appears after the command's measured latency. That comes from the
  capture run plus three timing runs (`media/capture-flare-site/latency.txt`),
  each line stamped with its millisecond after Enter. manni's build announce
  landed at 445-482 ms, and the stand-in's line 57-106 ms after it. The
  preview URL landed at 470-513 ms, `curl` took 60-102 ms, and the refusal
  landed at 444-488 ms. The replay uses the first whole frame inside each
  range: 14, 2, 15, 2 and 14 frames. `ls` and `tail` get 2 frames.
- Beats run 5.3-7.4 s. Each holds 3.2-4.4 s after its main output, and the
  49-54 character caption is on screen for the whole beat.
- No narration, so no loudness pass. The AAC 48 kHz track is silence
  (`anullsrc`). Measured on the finished file with `ebur128=peak=true`, it is
  -70.0 LUFS integrated (the meter's floor) and -inf dBFS true peak.
- Caption cues are one per beat, 5.3-7.4 s each, burned in on one line of at
  most 54 characters. That is at or under broadcast caption guidance
  (6-7 s) for all but beat 1. It matches the band the earlier videos use. Each
  cue is a static step title plus caption, not speech, so there is nothing to
  sync against.

## Reproduce

```bash
# 0. Build the CLI (repo root).
npm ci && npm run build

# 1. Demo repository and every capture (from anywhere; needs C:\widget and port 4321 free)
bash media/capture-flare-site/capture.sh
node capture-flare-site/cols.mjs 24   # run from media/: the font-size table

# 2. Render and package (from media/remotion, after npm ci there)
node scripts/captures-flare-site.mjs
npx tsc --ignoreConfig src/flare-site/beats.ts --outDir scripts/out-flare-site --module commonjs --target es2020 --resolveJsonModule --esModuleInterop --skipLibCheck
cp src/flare-site/captures.json scripts/out-flare-site/flare-site/
npx remotion render src/index.ts FlareSiteDemo out/flare-site/render.mp4
npx remotion still src/index.ts FlareSiteDemo ../flare-site-1x1.thumb.png --frame=420
node scripts/vtt-flare-site.cjs && node scripts/transcript-flare-site.cjs
cd .. && ffmpeg -i remotion/out/flare-site/render.mp4 -f lavfi -i anullsrc=r=48000:cl=stereo -shortest -c:v copy -c:a aac -b:a 128k -movflags +faststart flare-site-1x1.mp4
ffmpeg -i flare-site-1x1.mp4 -vf "fps=12,scale=540:540:flags=lanczos,split[a][b];[a]palettegen=max_colors=128:stats_mode=diff[p];[b][p]paletteuse=dither=none:diff_mode=rectangle" flare-site-1x1.gif
```

The suggested LinkedIn post is `media/flare-site-1x1.post.txt`. Posting is
the author's call.
