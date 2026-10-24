# Demo beat sheet for a judge that reads a page as its personas (proposal 0111)

- **Type:** feature demo, terminal session. No narration; captions only
  (LinkedIn autoplays muted).
- **Audience.** Docs engineers who keep persona records and judge pages with
  `manni docevals`. Phone-sized, muted.
- **Target:** 38 s, four beats, one caption line each.
- **Objective.** The viewer sees one `ai` eval opt in with
  `readers: personas`. The judge reads the page as Theo, and pretty output
  tags that result `(read as theo)`. The eval that did not opt in stays
  untagged. The page fails, then passes once it speaks to Theo's pains.
- **Assets:** `media/persona-judge-1x1.mp4` (not committed), `.thumb.png`,
  `.vtt`, `.srt`, `.transcript.txt`, `.post.txt`, this file,
  `media/capture-personas/`, `media/remotion/src/personas/`,
  `media/remotion/scripts/{captures,vtt,transcript}-personas.*` and the
  `PersonaJudgeDemo` composition in `media/remotion/src/Root.tsx`. No GIF and
  no storyboard. The brief asked for neither, and one shot type, a terminal,
  needs no storyboard beyond this table.
- **Look:** `docs/content-strategy/design.md`. 1080×1080, 30 fps, title band
  112 px with an `n / 4` counter, caption band 86 px, accent `#58a6ff` blue.
  Never red, green, yellow or cyan. The frame already holds a red `FAIL`, a
  green `pass`, a cyan diff hunk header and git's red and green diff lines.

| # | Time | Title band | Caption band | Typed | On screen |
|---|---|---|---|---|---|
| 1 | 0:00–0:07 | One eval reads as Theo | readers: personas on one eval. The page names theo. | `cat docs/one-reader.md` | `personas: [theo]`; eval `names-schema` with `options: readers: personas`; eval `plain-judge` with no options; the body `Fix the field, then run manni meta validate.` |
| 2 | 0:07–0:21 | manni docevals run | Read as theo: FAIL. The untagged eval passes. Exit 1. | `time manni docevals run docs/one-reader.md --ai-only`, then `echo $?` | red `FAIL names-schema [auto-fail] (read as theo)`, the judge's observed and reasoning lines, `votes pass:0 fail:1 partial:0`; green `pass plain-judge [auto-pass]` with no tag; `real 0m8.172s`; `1` |
| 3 | 0:21–0:27 | Speak to Theo's pains | He can't tell which schema fired. Now the page says. | `git diff docs/one-reader.md` | one line out, three in: `Each error names its schema`, `/title is required (schema: house)` |
| 4 | 0:27–0:38 | Run it again | Passes, read as theo. Exit 0. Waits shown 3.5x faster. | `time manni docevals run docs/one-reader.md --ai-only`, then `echo $?` | `pass names-schema [auto-pass] (read as theo)`, `pass plain-judge`, `2/2 passed`; `real 0m8.095s`; `0` |

Exact cue times are in `persona-judge-1x1.vtt`, generated from the beats the
composition renders.

## Why this story

The feature has three visible parts. An eval opts in, the judge reads the page
as the personas it names, and the output says so. Beat 1 shows the opt-in on
one eval and not the other, so the viewer can watch the tag land on one row
only. Beat 2 is the payoff: `(read as theo)` on the failing result, and nothing
on the plain one. Theo's record says he does not know which schema fired.
Beat 3 edits the page to answer that. Beat 4 shows the same eval pass, still
read as Theo, with the exit code CI reads.

The brief named three beats. Beat 3's edit and its second run need 31 rows,
and no legible size fits them on one screen. So the edit and the run are two
beats, each with its own caption.

## What changed from the fixture, and why

`media/capture-personas/stage.sh` copies `test/docevals/fixtures/personas/`
into `media/scratch-persona-evals/`, byte for byte, then makes these changes:

- **The judge.** The fixture's config names no provider, because its tests
  stub the judge. The copy names the repository's own local judge,
  `provider: llama-cpp` and `model: granite-4.1-3b-q2`, at `temperature: 0`.
- **`zones.autoFail: 0.7`.** This 3B model returns its fail verdicts at 0.70
  confidence. At the default 0.8, a real fail waits for a human review. At
  0.7 it lands as `FAIL`. A pass still needs 0.8.
- **The page.** `docs/one-reader.md` is `one-reader.before.md`. The fixture's
  first eval asserts "A reader can fix the failing field from this page
  alone." Against every page text tried, this model answered `partial` at
  0.70, before and after the edit. So the opted-in eval became `names-schema`,
  "The page names the schema that fired.", which is Theo's second pain. The
  judge votes a real `fail` on it, with reasoning that matches the page. The
  page body became one line with no schema in it. The fixture's
  `no-todo-markers` regex eval is gone, since `--ai-only` would only print it
  as skipped.
- **The fix.** `one-reader.after.md` changes only the body, to three lines that
  name the schema in an example error.
- **Its own repository.** The scratch copy is a git repository with one
  commit. The outer checkout's `.gitignore` skips `media/scratch-*`, and manni
  honours that, so without its own repository it reads no persona records.
  The commit also gives beat 3 its `git diff`.

## Capture notes

- **The CLI is this branch's build,** `node dist/cli.js`, typed as `manni`.
  Its `--version` prints 4.20.0; semantic-release bumps it when the feature
  ships. So no version is claimed on screen.
- **Colour.** `media/capture/tty.cjs` tells the CLI it writes to a terminal.
  `git diff` gets `-c color.ui=always` for the same reason.
- **Every verdict is a real model call,** cold. `stage.sh` deletes the scratch
  copy, judge cache included, before each capture. The output says
  `Judged 2 evals (0 cached)` both times.
- **Latency** (`capture-personas/latency.txt`): run before 8.19 s, diff 57 ms,
  run after 8.11 s. Each judged run is two calls to a local 3B model. The
  replay shortens only that wait, by 1/3.5 to 2.3 s. Typing and output stay
  at 1x. bash's own `time` line, `real 0m8.172s` and `real 0m8.095s`, stays in
  frame, unedited, and beat 4's caption says the waits are shortened.
- **Font size is derived per beat, not chosen** (`node capture-personas/cols.mjs`).
  A result row, a prompt and a diff line never wrap. The judge's detail lines
  and the two dim notices wrap at spaces; the Reasoning line alone is 280
  characters.
  - Beat 1: 27 px / 64 columns. The longest line is the `plain-judge`
    assertion, 64 characters.
  - Beat 2: **21 px / 82 columns.** The largest size whose 28 rows fit the
    838 px terminal area. The result rows are 68 characters.
  - Beat 3: 27 px / 64 columns. The longest diff line is 63 characters.
  - Beat 4: 25 px / 69 columns. The result rows are 68 characters.
- **Ligatures off.** The page's `---` fences would draw as one rule.

## How to rebuild it

```bash
# from the repo root
npm run build
bash media/capture-personas/capture.sh       # stages media/scratch-persona-evals, captures every byte
cd media && node capture-personas/cols.mjs   # re-derive the font sizes, per beat

cd remotion
npm ci
node scripts/captures-personas.mjs           # captures -> src/personas/captures.json
npx remotion render PersonaJudgeDemo ../persona-judge-1x1.mp4
npx remotion still PersonaJudgeDemo ../persona-judge-1x1.thumb.png --frame=630

# timings for the sidecars come from the same beats the composition uses
npx tsc --ignoreConfig src/personas/beats.ts src/beats.ts --outDir scripts/out-personas \
  --module commonjs --target ES2022 --moduleResolution bundler \
  --resolveJsonModule --esModuleInterop --skipLibCheck
cd scripts && node vtt-personas.cjs && node transcript-personas.cjs   # .vtt, .srt, .transcript.txt
```

Thumbnail (`.thumb.png`): frame 630, the end of beat 2. The red `FAIL` row
carries `(read as theo)`, the `pass` row below it carries no tag, and `1`
sits below the prompt. That is the feature in one frame.

## Checks before shipping (design.md)

1. Longest lines measured per beat by `cols.mjs`, and checked in rendered
   stills of every beat.
2. No text touches the frame edge, and no token is split.
3. Captions on every beat, one line each, burned in and in the `.vtt` and
   `.srt`. Each cue holds for its whole beat, as the burned-in band does.
4. `ffprobe`: 1080×1080, 30 fps, h264 yuv420p, 38.47 s.
5. No narration, and Remotion writes no audio stream, so no loudness pass.
   design.md's AAC track would carry only silence.
6. Accent `#58a6ff`, blue.

## Suggested LinkedIn caption

Also in `persona-judge-1x1.post.txt`. Post it only after the release that
ships proposal 0111. Do not post; hand over.
