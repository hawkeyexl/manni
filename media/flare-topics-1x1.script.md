# Video script: MadCap Flare topics (`manni meta`, `manni graph`)

**Objective:** Show that manni reads and writes a MadCap Flare project safely.
An empty `<title>`, which Flare writes as standard, reads as the first heading.
A write closes its tags, so the topic stays well-formed XML. A `MadCap:xref` is
a link, so `graph stats --check` finds a broken one and exits 1.
**Format:** 1080x1080, 30 fps, silent, captions burned in (LinkedIn autoplays muted).
**Duration:** 43.4 s (spec: 20-45 s).
**Audience:** docs engineers who own a Flare project and want CI checks on it
(Maya), and the CI engineer who wires the gate (Devin).
**Feature:** proposal 0125, Part 1, branch `claude/flare-topics` (uncommitted
at capture time, built from the working tree).

Visual spec: `docs/content-strategy/design.md`. Accent `#58a6ff` (blue). Never
red, green, yellow or cyan. In beat 2 manni prints `✓` green, `✗` red and
`(root)` cyan. In beat 3 git prints the hunk header cyan and the added line
green. So the accent stays blue. Terminal `#171717`, bands `#0d0d0d`,
JetBrains Mono throughout. Title band 112 px, 2 px accent rules, caption band
86 px.

## How it was made, and what is staged

Everything printed in the terminal is a real run of `grep`, `git`, `echo` or
`node dist/cli.js`. The typed command reads `manni`, the name the shim
`media/bin/manni` gives the built CLI.

- **A Remotion replay of real bytes, as in the earlier videos.** The
  composition `FlareTopicsDemo` (`media/remotion/src/flare/beats.ts`, shared
  `src/Demo.tsx`) replays the bytes. Typing runs at 35 ms/char, then Enter,
  then the output after the command's measured latency. No output byte is
  edited.
- **manni's bytes come from the TTY preload.** Every manni run went through
  `media/capture/tty.cjs`, so the colours are what a terminal receives. `git
  diff` ran with `-c color.ui=always`, which is what git prints to a terminal.
- **One script builds the repository and takes every capture:**
  `media/capture-flare/capture.sh`. It is the record of the staging.
- **Input is a fixture, unchanged.** `media/scratch-flare-topics/` is a copy of
  `test/fixtures/flare/widget/` with its own `git init` and one commit. Config
  discovery stops there and never reaches manni's own `manni.config.yaml`.
  `media/scratch-*` is gitignored.
- **The working directory is `C:\flare`,** a directory junction to the scratch
  repository. `graph build` prints the absolute path it wrote, and the real
  path would be a 150-character line naming the user's home. `cwd.cjs` starts
  the CLI there as spelled. The junction is removed when the script ends.
- **Beat 3 uses `meta query`, not `meta fill`.** fill needs a model; query is a
  deterministic write of the same field through the same writer.
- **"Still well-formed XML" is verified off screen.** After the write, the
  capture parses `Configure.htm` with xmldom (BOM stripped) and records
  `well-formed` in `capture-flare/wellformed.txt`. The caption states it; the
  diff shows the self-closing `<meta ... />` it rests on.
- **Beat 4 sends the stats report to a file.** `graph stats --check` prints
  about 45 lines, mostly coverage tables. `> stats.txt; echo $?` puts the exit
  code on screen, and `grep -A1 "internal links"` shows the one finding. The
  full report is `capture-flare/stats.ans`, byte for byte what `stats.txt`
  held.
- **Not shown:** the refusal of a write that would break the XML (exit 2). It
  is in the post text only, backed by `test/html-write.test.ts` ("refuses a
  write whose result would not be well-formed XML").
- **Ligatures are off for this video.** JetBrains Mono draws `</` and `/>`
  as single glyphs; a terminal prints the characters.
- **Row highlight is chrome.** A faint accent ground (`#58a6ff` at 16%) sits
  behind the rows a caption is about. The bytes in those rows are untouched.

## Derived font size

`media/capture-flare/cols.mjs` runs the replay's own space-only wrap over
every real line from 30 px down. Below 23 px no token is too wide; at 24 px
the validate guide URL (74 columns with its indent) cannot wrap. The deciding
line is the diff's added `<meta ... />` row, 81 characters. At 22 px (78
columns) its `/>` orphans onto a row of its own, which is the one thing the
beat is about. **21 px / 82 columns** keeps it whole. Line height is 29 px.
The tallest beat (2) is 17 rows, 493 px of the 838 px available. The query
report's `options.` wraps to its own row at a space. In the render the widest
row's rightmost ink (the guide URL) sits at about x=1040 of 1080.

## Beats (storyboard)

Four static full-frame shots. Every beat starts on a cleared terminal and cuts
to the next, with no transitions.

| # | Title (band) | Terminal | Caption (band) | Time |
|---|---|---|---|---|
| 1 | A MadCap Flare topic | `grep -E '<title>\|<h1>' Content/Topics/Configure.htm`, `grep xref Content/Topics/Install.htm` | Flare writes an empty <title> as standard. Install.htm links to Configure.htm, misspelled Configur.htm. | 0:00.0-0:09.1 |
| 2 | The title is the h1 | `manni meta get title Content/Topics/Configure.htm`, `manni meta validate; echo $?` | The empty title reads as the h1, as Flare shows it. Only description fails: exit 1. | 0:09.1-0:19.4 |
| 3 | A write that closes its tags | `manni meta query "UPDATE docs SET description = 'How to set the widget''s options.' WHERE _path = 'Content/Topics/Configure.htm'"`, `git diff -U1` | query writes the description. The new <meta> closes itself, so the topic is still well-formed XML. | 0:19.4-0:31.2 |
| 4 | The broken xref, found | `manni graph build`, `manni graph stats --check > stats.txt; echo $?`, `grep -A1 "internal links" stats.txt` | graph reads MadCap:xref as a link. stats --check reports Configur.htm as broken and exits 1. | 0:31.2-0:43.4 |

Beat 1 highlights `<title></title>` and the xref row. Beat 2 highlights the
`title=` row and the missing-`description` finding. Beat 3 highlights the
added `<meta>` row, and beat 4 the broken link.

Thumbnail (`.thumb.png`): frame 930, the end of beat 3, with the diff on screen.

## Real output quoted

Beat 2, `manni meta validate` (exit 1, ANSI stripped):

```
Using manni.config.yaml (.)
✓ Content/Resources/Snippets/BeforeYouStart.flsnp
✗ Content/Topics/Configure.htm
    (root)  must have required property 'description'  (line 1)  [manni:core:1.0.0]
      manni:core:1.0.0 description: One full non-empty sentence saying what the page is for.
      Guide: https://hawkeyexl.github.io/manni/meta/reference/schemas/manni-core/
✓ Content/Topics/Install.htm

3 files checked, 2 passed, 1 failed, 1 error
```

Beat 3, `git diff -U1` after the query (exit 0 for the query):

```
@@ -3,2 +3,3 @@
     <head>
+        <meta name="description" content="How to set the widget's options." />
         <title></title>
```

Beat 4 (stats exit 1):

```
Wrote C:\flare\graph\graph.ttl (3 docs, 88 triples, 0 concepts)
Broken internal links (1):
  Content/Topics/Install.htm -> Configur.htm
```

## Timing rules applied

- Typing 35 ms per character (spec: 35-70 ms). The cursor is a solid block
  and does not blink. No speed-up anywhere.
- Output appears after the command's measured latency, from the capture run
  plus three timing runs (`media/capture-flare/latency.txt`): get 307-368 ms,
  validate 379-427 ms, query 382-464 ms, build 747-913 ms, stats 617-651 ms.
  The replay uses 0.35, 0.45, 0.42, 0.78 and 0.64 s, and 2 frames for `grep`,
  `git` and `echo`.
- Beats run 9.1-12.1 s. Each holds 3.6-4.4 s after its main output, and the
  83-103 character caption is on screen for the whole beat.
- No narration, so no loudness pass. The AAC 48 kHz track is silence
  (`anullsrc`), measured on the finished file: integrated -inf LUFS and true
  peak -inf dBTP.
- Caption cues are one per beat, 9-12 s each, burned in over two lines of
  about 52 characters. That is longer per cue and per line than broadcast
  caption guidance (6-7 s, about 42 characters), and matches the band the
  earlier videos use. Each cue is a static step title plus caption, not
  speech, so there is nothing to sync against. The VTT escapes `<title>` and
  `<meta>` as `&lt;...&gt;`, or a player would drop them as cue tags.

## Reproduce

```bash
# 0. Build the CLI (repo root).
npm ci && npm run build

# 1. Demo repository and every capture (from anywhere; needs C:\flare free)
bash media/capture-flare/capture.sh
node media/capture-flare/cols.mjs 21        # run from media/: the font-size table

# 2. Render and package (from media/remotion, after npm ci there)
node scripts/captures-flare.mjs
npx tsc --ignoreConfig src/flare/beats.ts --outDir scripts/out-flare --module commonjs --target es2020 --resolveJsonModule --esModuleInterop --skipLibCheck
cp src/flare/captures.json scripts/out-flare/flare/
npx remotion render src/index.ts FlareTopicsDemo out/flare/render.mp4
npx remotion still src/index.ts FlareTopicsDemo ../flare-topics-1x1.thumb.png --frame=930
node scripts/vtt-flare.cjs && node scripts/transcript-flare.cjs
cd .. && ffmpeg -i remotion/out/flare/render.mp4 -f lavfi -i anullsrc=r=48000:cl=stereo -shortest -c:v copy -c:a aac -b:a 128k -movflags +faststart flare-topics-1x1.mp4
ffmpeg -i flare-topics-1x1.mp4 -vf "fps=12,scale=540:540:flags=lanczos,split[a][b];[a]palettegen=max_colors=128:stats_mode=diff[p];[b][p]paletteuse=dither=none:diff_mode=rectangle" flare-topics-1x1.gif
```

The suggested LinkedIn post is `media/flare-topics-1x1.post.txt`. Posting is
the author's call.
