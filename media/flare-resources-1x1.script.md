# Video script: MadCap Flare glossaries and meta tag sets (`manni term`, `manni meta`)

**Objective:** Show that manni reads a MadCap Flare project's resources. A
glossary (`.flglo`) is a termbase, and each entry is a term keyed by its
`glossTerm` id. A topic's `MadCap:glossaryTerm` markers are its `concepts`. A
marker that names a missing entry is an `undefined-term` error at the marker's
line. A meta tag set (`.flmeta`) is a schema, so a list tag only takes its
listed values.
**Format:** 1080x1080, 30 fps, silent, captions burned in (LinkedIn autoplays muted).
**Duration:** 39.0 s (spec: 20-45 s).
**Audience:** docs engineers who own a Flare project (Maya). They want the
glossary and the meta tags checked like any other metadata. Also the CI
engineer who wires the checks in (Devin).
**Feature:** proposal 0125, Part 3, branch `claude/flare-resources` (committed
at capture time, `dist/` built from it).

Visual spec: `docs/content-strategy/design.md`. Accent `#58a6ff` (blue). Never
red, green, yellow or cyan. manni prints `notice` and `/Status` cyan and the
`✗` and the failing summary red, so the accent stays blue. Terminal `#171717`,
bands `#0d0d0d`, JetBrains Mono throughout. Title band 112 px, 2 px accent
rules, caption band 86 px.

## How it was made, and what is staged

Everything printed in the terminal is a real run of `sed`, `grep` or
`node dist/cli.js`. The typed command reads `manni`, the name the shim
`media/bin/manni` gives the built CLI.

- **A Remotion replay of real bytes, as in the earlier videos.** The
  composition `FlareResourcesDemo` (`media/remotion/src/flare-resources/beats.ts`,
  shared `src/Demo.tsx`) replays the bytes. Typing runs at 40 ms/char, then
  Enter, then the output after the command's measured latency. No output byte
  is edited.
- **manni's bytes come from the TTY preload.** Every manni run went through
  `media/capture/tty.cjs`, so the colours are what a terminal receives. The
  exception is beat 3, below.
- **One script builds the repository and takes every capture:**
  `media/capture-flare-resources/capture.sh`. It is the record of the staging.
- **Input is a fixture, unchanged.** `media/scratch-flare-resources/` holds
  `test/fixtures/flare/widget/` as committed at HEAD, taken with `git archive`
  so no untracked test cache comes along. It has its own `git init` and one
  commit. Config discovery stops there and never reaches manni's own
  `manni.config.yaml`. `media/scratch-*` is gitignored.
- **The working directory is `C:\flare`,** a directory junction to the scratch
  repository, as in flare-targets. `cwd.cjs` starts the CLI there as spelled.
  The junction is removed when the script ends.
- **The two failures are real edits.** Beat 3 runs
  `sed -i 's/Term0/Term9/'` on `Install.htm`, and beat 4 runs
  `sed -i 's/Reviewed/Reviewd/'`. Both are typed on screen. The script resets
  the repository before each timing run.
- **Beat 3 is trimmed with `grep`, and says so on screen.** Whole, the
  `term check` output is 17 lines up to 146 characters wide. It holds the
  page's error and two `unused-term` notices on the glossary. Each finding
  carries two explanation rows. `grep -A1 Install.htm` keeps the page's
  `file:line` header and its error row. `echo ${PIPESTATUS[0]}` prints term
  check's own exit code, not grep's. On the left of a pipe, manni's stdout is
  not a terminal. So that run skips the TTY preload and prints without
  colour, as a reader's would. `undefined.full.ans` keeps the whole
  output as the record of what grep dropped.
- **Beat 4 names the page instead of grepping.** `manni meta validate
  Content/Topics/Install.htm` keeps the fixture's other topic,
  `Configure.htm`, out of the frame. Its missing `description` is unrelated.
  The output is shown whole, 6 lines.
- **Beat 1's "2 terms" is the target at work.** The glossary has three
  entries. The third is conditioned `Default.PrintOnly`, and the config's
  HTML5 target excludes it. With `tools.flare.target: Print` the same check
  prints `2 notices in 3 terms`. That run was checked by hand and is not in
  the video.
- **Ligatures are off for this video.** JetBrains Mono draws `//` in the
  Guide URL as one glyph; a terminal prints the characters.
- **Row highlight is chrome.** A faint accent ground (`#58a6ff` at 16%) sits
  behind the rows a caption is about. The bytes in those rows are untouched.

## Derived font size

`media/capture-flare-resources/cols.mjs` runs the replay's own wrap over every
real line from 30 px down. A row breaks at a space, or after a `/` inside a
URL. The longest line is beat 1's explanation row, at 146 characters. No size
from 30 px to 18 px keeps it whole, so it wraps at spaces under its own
41-column gutter. Beat 3's error row is 83 characters. At 21 px (82 columns)
it would orphan `entry.` onto its own row. **20 px / 86 columns** keeps it
whole. Line height is 28 px.

**Beat 1 runs at 19 px / 91 columns** through the per-beat `type`. At 20 px
the notice's `Name it in the concepts: of a page that uses it.` row is 89
characters and orphans `it.`. At 19 px it is whole. The Guide URL is wider
than the gutter leaves, so it breaks after `reference/`. The tallest beat is
1, at 14 rows, 378 px of the 838 px available. In the render the widest row's
rightmost ink, in beat 1, sits at about x=1046 of 1080.

## Beats (storyboard)

Four static full-frame shots. Every beat starts on a cleared terminal and cuts
to the next, with no transitions.

| # | Title (band) | Terminal | Caption (band) | Time |
|---|---|---|---|---|
| 1 | The glossary is a termbase | `manni term check; echo $?` | Each entry is a term. HTML5 drops the print-only one. | 0:00.0-0:06.5 |
| 2 | Glossary markers are concepts | `grep -no '<MadCap:glossaryTerm[^>]*>' Content/Topics/Install.htm`, `manni meta get concepts Content/Topics/Install.htm` | The topic's glossaryTerm marker is its concepts. | 0:06.5-0:17.3 |
| 3 | A missing entry fails | `sed -i 's/Term0/Term9/' Content/Topics/Install.htm`, `manni term check \| grep -A1 Install.htm; echo ${PIPESTATUS[0]}` | Term9 names no entry. Line 10 fails, exit 1. | 0:17.3-0:27.8 |
| 4 | A meta tag set is a schema | `sed -i 's/Reviewed/Reviewd/' Content/Topics/Install.htm`, `manni meta validate Content/Topics/Install.htm; echo $?` | Status takes only Draft, Reviewed or Published. | 0:27.8-0:39.0 |

Beat 1 highlights the notice's `Glossary.flglo:15` header and the summary.
Beat 2 highlights the marker and the `concepts=` row. Beat 3 highlights the
`Install.htm:10` header and the error row. Beat 4 highlights the `/Status`
finding and its guidance row.

Thumbnail (`.thumb.png`): frame 1160, the end of beat 4, with the `/Status`
finding and its guidance row on screen.

## Real output quoted

Beat 1, `manni term check` (exit 0, ANSI stripped):

```
Project/Glossaries/Glossary.flglo:15
  notice manni:term/unused-term          no page's concepts: names this term.
                                         Name it in the concepts: of a page that uses it.
                                         manni:term unused-term: No page's concepts: names the entry, or an entry in another language with its id.
                                         Guide: https://hawkeyexl.github.io/manni/term/reference/rules/#unused-term

1 notice in 2 terms
```

Beat 2 (exit 0):

```
10:<MadCap:glossaryTerm glossTerm="Glossary.Term0">
Using manni.config.yaml (.)
Content/Topics/Install.htm: concepts=["Glossary.Term0"] (asserted)
```

Beat 3, after the edit (term check exits 1):

```
Content/Topics/Install.htm:10
  error  manni:term/undefined-term       concepts: "Glossary.Term9" names no entry.
1
```

Beat 4, after the edit (exit 1, ANSI stripped):

```
Using manni.config.yaml (.)
✗ Content/Topics/Install.htm
    /Status  must match pattern "^(Draft|Reviewed|Published)(,(Draft|Reviewed|Published))*$"  (line 6)  [./Project/Advanced/Topics.flmeta]
      ./Project/Advanced/Topics.flmeta Status: Where the topic is in review.

1 file checked, 0 passed, 1 failed, 1 error
1
```

## Timing rules applied

- Typing 40 ms per character (spec: 35-70 ms). The cursor is a solid block
  and does not blink. No speed-up anywhere, and no wait is compressed.
- Output appears after the command's measured latency. That comes from the
  capture run plus three timing runs (`media/capture-flare-resources/latency.txt`).
  The ranges are term check 408-449 ms and meta get 292-314 ms. After the
  edits they are term check 405-449 ms and meta validate 325-382 ms. The replay uses 0.41,
  0.3, 0.41 and 0.33 s, the low end of each range. `sed` and `grep` get 2
  frames. An earlier capture ran while a build and test job loaded the
  machine and measured about three times slower. The final capture ran on an
  idle machine, and the replay follows it.
- Beats run 6.5-11.2 s. Each holds 3.4-4.4 s after its main output, and the
  44-53 character caption is on screen for the whole beat.
- No narration, so no loudness pass. The AAC 48 kHz track is silence
  (`anullsrc`). Measured on the finished file with `ebur128=peak=true`, it is
  -70.0 LUFS integrated (the meter's floor) and -inf dBFS true peak.
- Caption cues are one per beat, 6.5-11.2 s each, burned in on one line of at
  most 53 characters. That is longer per cue than broadcast caption guidance
  (6-7 s). It matches the band the earlier videos use. Each cue is a static
  step title plus caption, not speech, so there is nothing to sync against.

## Reproduce

```bash
# 0. Build the CLI (repo root).
npm ci && npm run build

# 1. Demo repository and every capture (from anywhere; needs C:\flare free)
bash media/capture-flare-resources/capture.sh
node media/capture-flare-resources/cols.mjs 20   # run from media/: the font-size table

# 2. Render and package (from media/remotion, after npm ci there)
node scripts/captures-flare-resources.mjs
npx tsc --ignoreConfig src/flare-resources/beats.ts --outDir scripts/out-flare-resources --module commonjs --target es2020 --resolveJsonModule --esModuleInterop --skipLibCheck
cp src/flare-resources/captures.json scripts/out-flare-resources/flare-resources/
npx remotion render src/index.ts FlareResourcesDemo out/flare-resources/render.mp4
npx remotion still src/index.ts FlareResourcesDemo ../flare-resources-1x1.thumb.png --frame=1160
node scripts/vtt-flare-resources.cjs && node scripts/transcript-flare-resources.cjs
cd .. && ffmpeg -i remotion/out/flare-resources/render.mp4 -f lavfi -i anullsrc=r=48000:cl=stereo -shortest -c:v copy -c:a aac -b:a 128k -movflags +faststart flare-resources-1x1.mp4
ffmpeg -i flare-resources-1x1.mp4 -vf "fps=12,scale=540:540:flags=lanczos,split[a][b];[a]palettegen=max_colors=128:stats_mode=diff[p];[b][p]paletteuse=dither=none:diff_mode=rectangle" flare-resources-1x1.gif
```

The suggested LinkedIn post is `media/flare-resources-1x1.post.txt`. Posting is
the author's call.
