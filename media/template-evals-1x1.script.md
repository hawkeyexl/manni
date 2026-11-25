# Video script for evals on lint templates (`manni docevals`)

**Objective:** Show that a lint template can carry `evals:`, and that
`manni docevals` grades them on every page lint routes to that template by
its `type:`. The built-in TGDP how-to ships TGDP's guidance as six `tgdp-*`
evals. A house template extends it, skips one, and adds its own. That eval
fails on a page that never shows its command.
**Format:** 1080x1080, 30 fps, silent, captions burned in (LinkedIn autoplays muted).
**Duration:** 32.1 s (spec: 20-45 s).
**Audience:** docs engineers who own a template set (Maya), and schema authors
who decide what a page type promises (Sara).
**Feature:** `feat`: evals on lint templates, branch
`claude/doc-evals-templates-a41e26` (`dist/` built from the working tree,
`manni --version` 4.28.0 at capture time).

Visual spec: `docs/content-strategy/design.md`. Accent `#58a6ff` (blue). Never
red, green, yellow or cyan. manni prints `FAIL`, `error` and `below target` in
red, `pass` in green, `skip` in yellow and the grader name in cyan, so the
accent stays blue. Terminal `#171717`, bands `#0d0d0d`, JetBrains Mono
throughout. Title band 112 px, 2 px accent rules, caption band 86 px.

## How it was made, and what is staged

Everything printed in the terminal is a real run of `cat` or
`node dist/cli.js`. The typed command reads `manni`, the name the shim
`media/bin/manni` gives the built CLI.

- **A Remotion replay of real bytes, as in the earlier videos.** The
  composition `TemplateEvalsDemo` (`media/remotion/src/template-evals/beats.ts`,
  shared `src/Demo.tsx`) replays the bytes. Typing runs at 40 ms/char, then
  Enter, then the output after the command's measured latency. No output byte
  is edited.
- **manni's bytes come from the TTY preload.** Both docevals runs went through
  `media/capture/tty.cjs`, so the colours are what a terminal receives.
- **One script builds the repository and takes every capture:**
  `media/capture-template-evals/capture.sh`. It's the record of the staging.
- **Input is a fixture, unchanged.** `media/scratch-template-evals/` holds
  `test/docevals/fixtures/template-evals/` copied from the working tree. The
  fixture ships with the feature, so it isn't at HEAD yet and `git archive`
  can't take it. The scratch repository has its own `git init` and one commit,
  and its own `manni.config.yaml`, so discovery never reaches manni's.
  `media/scratch-*` is gitignored.
- **The runs write nothing.** `after-status.txt` is the scratch repository's
  `git status --short` after every run, and it is empty.
- **One page throughout.** The brief listed `docs/typed.md` in beat 3. The
  video lists `docs/typed-fails.md` instead, the page beats 1 and 4 show. Both
  pages declare `type: how-to`, so the resolved plan is the same nine evals.
  The viewer follows one page from its frontmatter to its failure.
- **The judge beat is not shown.** The six `tgdp-*` evals are `ai` evals. That
  needs a model, so beat 4 runs `--deterministic-only`, and the run itself
  prints them as `judge skipped`. The video makes no claim about a verdict.
- **The optional `manni lint templates show tgdp:how-to:1.6` beat is cut.**
  Its output is 30 lines up to 130 characters wide, about 40 rows at 20 px.
  It would need scrollback, and beat 3 already names the six evals.
- **Ligatures are off for this video.** JetBrains Mono draws `---`, `--`, `//`
  and `$?` as joined glyphs, and a terminal prints the characters.
- **Row highlight is chrome.** A faint accent ground (`#58a6ff` at 16%) sits
  behind the rows a caption is about. The bytes in those rows are untouched.

## Derived font size

`media/capture-template-evals/cols.mjs` runs the replay's own wrap over every
real line from 30 px down. A row breaks at a space. The longest line is the
`tgdp-steps-start-with-a-verb` description in beat 3, at 130 characters. It
wraps at every size, under its own 6-column indent.

**Beats 1 and 2 run at 26 px / 66 columns.** Beat 2 is 19 rows, 684 px of the
838 px terminal. The template's first comment line is 78 characters and wraps
once, after `plus a`, at a space. Holding it to one row needs 22 px, and the
rest of beat 2 reads better large.

**Beats 3 and 4 run at 20 px / 86 columns** through the per-beat `type`. Beat
3's 29 rows at 26 px would be 1044 px. At 21 px they're 841 px, 3 px over. At
20 px they're 812 px. Beat 4 is 27 rows, 756 px. No token splits: every
description wraps at a space under its indent.

## Beats (storyboard)

Four static full-frame shots. Every beat starts on a cleared terminal and cuts
to the next, with no transitions.

| # | Title (band) | Terminal | Caption (band) | Time |
|---|---|---|---|---|
| 1 | A page that says how-to | `cat docs/typed-fails.md` | type: how-to, and no manni command on the page. | 0:00.0-0:05.3 |
| 2 | The template carries evals | `cat templates/how-to.yaml` | It extends TGDP's how-to, skips one eval and adds one. | 0:05.3-0:12.4 |
| 3 | The type routes the evals | `manni docevals list docs/typed-fails.md` | TGDP's guidance arrives as evals. One is skipped. | 0:12.4-0:21.9 |
| 4 | The house eval fails | `manni docevals run --deterministic-only docs/typed-fails.md; echo $?` | FAIL at the page's type: line. Exit 1. | 0:21.9-0:32.1 |

Beat 1 highlights `type: how-to` and the body line that names no command.
Beat 2 highlights `extends:`, the skipped `tgdp-one-method` and
`id: shows-the-command`. Beat 3 highlights the `(template: ...)` header, the
`skip`-tagged `tgdp-one-method` and `shows-the-command`. Beat 4 highlights the
`FAIL` row and its `error:1` finding.

Thumbnail (`.thumb.png`): frame 955, the end of beat 4, with the `FAIL` row,
the suite summary and the exit code on screen.

## Real output quoted

Beat 3 (exit 0, ANSI stripped, first four entries of nine):

```
docs/typed-fails.md (suite: site) (template: templates/how-to.yaml#how-to)
  - has-a-heading [tool:regex, regression, config]
      The page has a level-one heading.
  - tgdp-overview-names-the-task [ai, regression, template]
      The overview says which task the guide covers and when or why a reader would want to do it.
...
  - tgdp-one-method [ai, regression, template, skip]
...
  - shows-the-command [tool:regex, regression, template]
      The page shows the manni command it is about.
...
1 pages, 9 evals resolved
```

Beat 4 (exit 1, ANSI stripped, the failing block and the summary):

```
  FAIL shows-the-command  docs/typed-fails.md:3
       error:1 [regex/not-found] Pattern /manni [a-z]+/ not found in body. Add the text the eval asks for.
       docs/typed-fails.md shows-the-command: The page shows the manni command it is about.
       Guide: https://hawkeyexl.github.io/manni/docevals/fix/
  pass no-todo-markers  docs/typed-fails.md:3

Suites
  site: 2/3 passed — 67% vs target 100% below target (6 skipped)
1
```

Line 3 of `docs/typed-fails.md` is `type: how-to`, the line that routed the
page to the template. The full output is in `media/capture-template-evals/`
and the transcript.

## Timing rules applied

- Typing 40 ms per character (spec: 35-70 ms). The cursor is a solid block
  and doesn't blink. No speed-up anywhere, and no wait is compressed.
- Output appears after the command's measured latency. That comes from the
  capture run plus three timing runs (`media/capture-template-evals/latency.txt`).
  `list` took 614-1493 ms and the replay uses 0.62 s. `run` took 1014-1560 ms
  and the replay uses 1.02 s. Both sit at the low end of the measured range.
  `cat` gets 2 frames.
- Beats run 5.3-10.2 s. Beats 3 and 4 hold 6.4 s and 5.6 s after their output,
  because they're the densest frames.
- No narration, so no loudness pass. The AAC 48 kHz track is silence
  (`anullsrc`). Measured on the finished file with `ebur128=peak=true`, it's
  -70.0 LUFS integrated (the meter's floor) and -inf dBFS true peak.
- Caption cues are one per beat, 5.3-10.2 s each, burned in on one line. That
  is longer per cue than broadcast caption guidance (6-7 s). It matches the
  band the earlier videos use. Each cue is a static step title plus caption,
  not speech, so there is nothing to sync against.

## Reproduce

```bash
# 0. Build the CLI (repo root).
npm ci && npm run build

# 1. Demo repository and every capture (from anywhere)
bash media/capture-template-evals/capture.sh
node media/capture-template-evals/cols.mjs 20   # run from media/: the font-size table

# 2. Render and package (from media/remotion, after npm ci there)
node scripts/captures-template-evals.mjs
npx tsc --ignoreConfig src/template-evals/beats.ts --outDir scripts/out-template-evals --module commonjs --target es2020 --resolveJsonModule --esModuleInterop --skipLibCheck
cp src/template-evals/captures.json scripts/out-template-evals/template-evals/
npx remotion render src/index.ts TemplateEvalsDemo out/template-evals/render.mp4
npx remotion still src/index.ts TemplateEvalsDemo ../template-evals-1x1.thumb.png --frame=955
node scripts/vtt-template-evals.cjs && node scripts/transcript-template-evals.cjs
cd .. && ffmpeg -i remotion/out/template-evals/render.mp4 -f lavfi -i anullsrc=r=48000:cl=stereo -shortest -c:v copy -c:a aac -b:a 128k -movflags +faststart template-evals-1x1.mp4
ffmpeg -i template-evals-1x1.mp4 -vf "fps=12,scale=540:540:flags=lanczos,split[a][b];[a]palettegen=max_colors=128:stats_mode=diff[p];[b][p]paletteuse=dither=none:diff_mode=rectangle" template-evals-1x1.gif
```

The suggested LinkedIn post is `media/template-evals-1x1.post.txt`. Posting
is the author's call.
