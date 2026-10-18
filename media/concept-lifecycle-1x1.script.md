# Video script: one concept scheme, from freeform tags to checked questions (0086, 0087)

**Objective:** Show the loop proposals 0086 and 0087 close. Pages name concepts
freely, and `term check` fails on the ones nobody defined. `term fill --offline`
turns them into term pages, and `term check` names the definitions still to
write. The graph takes its concepts from that termbase. `graph fill` pins each
page's question to the lines that answer it. When those lines change,
`graph check` says the answer is no longer there.
**Format:** 1080x1080, 30 fps, silent, captions burned in (LinkedIn autoplays muted).
**Duration:** 43.4 s (spec: 20-45 s).
**Audience:** Sara, the schema author who owns the termbase (S6). Maya, who sees
the docset as a graph (M18). Devin, who gates the graph in CI (D12).
**Feature:** proposal 0086 and 0087 phases 7a-7d, with `--offline` meaning no
network egress. Built from `claude/concepts-7d-question-export` at `1dacfdb6`.

Visual spec: `docs/content-strategy/design.md`. Accent `#58a6ff` (blue). Never
red, green, yellow or cyan. manni prints `error` in red here, so the accent stays
blue. Terminal `#171717`, bands `#0d0d0d`, JetBrains Mono throughout. Title band
112 px, 2 px accent rules, caption band 86 px.

## How it was made, and what is staged

Everything printed in the terminal is a real run of `grep`, `sed`, `echo`,
bash's `time` or `node dist/cli.js`. The typed command reads `manni`.

- **A Remotion replay of real bytes, as in the earlier videos.** The
  composition `ConceptLifecycleDemo` (`media/remotion/src/concepts/beats.ts`,
  shared `src/Demo.tsx`) replays the captured bytes. Typing runs at 35 ms/char,
  then Enter, then the output after the command's **measured** latency. No
  output byte is edited.
- **manni's bytes come from the TTY preload** `media/capture/tty.cjs`, so the
  bold locations and red `error` are what a terminal receives.
- **One script builds the repository and takes every capture:**
  `media/capture-concepts/capture.sh`. It is the record of the staging.
- **Input is staged by hand, from two fixtures.** `media/capture-concepts/docset/`
  takes its shape from `test/fixtures/term/fill/basic/` (a term page, and pages
  naming concepts it lacks) and `test/graph/fixtures/sample-questions/` (each
  page asks one question, `top: 1`). Two pages name Upload, Retry and Quota.
  Only Upload has a term page. `retry.md` asks a bare question. `limits.md`
  asks one a person has pinned to body line 2, with no integrity hash yet.
  `graph.fill.questions.perPage` is 1, so `graph fill` pairs and re-pins the
  existing questions and drafts no new ones. `baseIri` is `https://acme.dev/`
  so IRIs stay phone-legible.
- **`media/scratch-concepts/` is the demo repository.** It has its own
  `git init` and one commit, so config discovery stops there and `graph build`
  has history to read. `media/scratch-*` is gitignored.
- **The CLI runs in `C:\concepts`, a junction to the scratch repo.**
  `graph build` prints the absolute path it wrote. The checkout's real path is
  a 110-character line naming the user's home. Git Bash hands a child the
  junction's resolved target, so `capture-concepts/cwd.cjs` starts the CLI in
  `C:\concepts` as spelled, as a terminal opened there would. The junction is
  removed when the script exits.
- **Two models, on purpose, disclosed here.** Beat 2 runs `term fill --offline`
  with `INFERENCE_MODELS_DIR` pointing at an empty directory, so it shows the
  stub path. In a trial run on this machine the same command found a
  local model, took 14.4 s, and still wrote stubs, because the model's confidence (0.00 and
  0.10) is under 0.7. The env var is not typed on screen. The caption states
  the rule ("With no local model, term fill writes a stub per concept"), not a
  claim about this machine. Beat 4's `graph fill --offline` uses the docset's
  configured local model, `granite-4.1-3b-q2`, already downloaded here.
- **Beat 4's wait is shortened, and disclosed.** `graph fill` took 7.33-8.30 s
  on CPU. The replay shortens only the wait between Enter and output, by 1/3.5,
  to 2.1 s. bash's own `time` line, `real 0m7.350s`, is in frame, unedited.
  `TIMEFORMAT` is set to print only the wall clock, because `user` and `sys`
  read 0 on Windows, where they do not count the node child.
- **Beat 5's edit is typed on screen.** `sed` changes "one gigabyte" to "two
  gigabytes" in the pinned line. `graph check` reads questions from the page
  source, so no rebuild runs between them.
- **The pins `graph fill` wrote** are in `media/capture-concepts/pins.diff`.
  `retry.md`'s question gains `lines: 2`, an integrity hash and
  `reviewed: false`. `limits.md`'s person-written pin gains its hash and stays
  reviewed. That is why beat 5 reports at warning, not at notice.
- **Ligatures are off.** JetBrains Mono draws `//` in the IRIs and `--` in the
  flags as single glyphs; a terminal prints the characters.
- **Row highlight is chrome.** A faint accent ground (`#58a6ff` at 16%) sits
  behind the rows a caption is about. The bytes are untouched.

## Derived font size

`media/capture-concepts/cols.mjs` runs the replay's own space-only wrap over
every real line. The longest is `graph check`'s warning, 239 characters. It
cannot fit one row at any legible size, so design.md's "column count exceeds
the longest line" cannot be met. Every size from 30 px down wraps it at spaces
only, never inside a token (longest token 35 characters). **23 px / 75
columns** is the largest size at which both `undefined-term` rows, the point
of beat 1, stay on one row each, and the typed `time manni graph fill ...`
line (68 characters) fits. The tallest beat (5) is 15 rows, 480 px of the
838 px available.

## Beats (storyboard)

Five static full-frame shots. Every beat starts on a cleared terminal and cuts
to the next, with no transitions.

| # | Title (band) | Terminal | Caption (band) | Time |
|---|---|---|---|---|
| 1 | Concepts nobody defined | `grep concepts: docs/*.md`, `manni term check; echo $?` | Pages name concepts freely. Retry and Quota have no term page, so term check fails: exit 1. | 0:00.0-0:08.5 |
| 2 | term fill --offline | `manni term fill --offline` | --offline sends nothing off the machine. With no local model, term fill writes a stub per concept. | 0:08.5-0:15.5 |
| 3 | What is left to write | `manni term check; echo $?` | No undefined terms left. check now names the two definitions a person, or a model, still writes. | 0:15.5-0:21.1 |
| 4 | Questions pinned to answers | `manni graph build`, `time manni graph fill docs/*.md --fields sample-questions --offline` | 3 concepts, all from the termbase. A local model pins each page's question to its answer's lines. | 0:21.1-0:33.2 |
| 5 | The answer changed | `sed -i 's/one gigabyte/two gigabytes/' docs/limits.md`, `manni graph check; echo $?` | Edit the pinned line, and graph check flags the question: its answer is no longer there. | 0:33.2-0:43.4 |

Thumbnail (`.thumb.png`): frame 1290, the end of beat 5, with the changed-answer
warning and the question summary on screen.

## Real output quoted (ANSI stripped)

Beat 1, `manni term check` (exit 1):

```
docs/limits.md:4
  error  manni:term/undefined-term       concepts: "Quota" names no entry.
docs/retry.md:4
  error  manni:term/undefined-term       concepts: "Retry" names no entry.

2 errors in 1 term
```

Beat 2, `manni term fill --offline` (exit 0):

```
manni: no model is available offline, so new terms have no definition; download one first with --local, or drop --offline.
created docs/glossary/quota.md   Quota   stub, no definition
created docs/glossary/retry.md   Retry   stub, no definition
2 terms created, 0 filled, 2 left without a definition
```

Beat 3, `manni term check` (exit 1):

```
docs/glossary/quota.md:1
  error  manni:term/missing-definition   definition: missing, so write one or run manni term fill.
docs/glossary/retry.md:1
  error  manni:term/missing-definition   definition: missing, so write one or run manni term fill.

2 errors in 3 terms
```

Beat 4, `manni graph build` (exit 0) and `time manni graph fill ...` (exit 0):

```
Wrote C:\concepts\graph.ttl (5 docs, 100 triples, 3 concepts (3 from the termbase))
```

```
filled    docs/limits.md (sample-questions)
            re-pinned  "How large can an upload be?"  lines 2
filled    docs/retry.md (sample-questions)
            paired     "How do I retry a failed upload?"  lines 2 (0.90)

real	0m7.350s
```

Beat 5, `manni graph check` (exit 0):

```
warning: https://acme.dev/doc/docs/limits.md graph:sampleQuestion — lines 2 no longer hold the answer to "How large can an upload be?" as pinned, so re-pair it with manni graph fill --fields sample-questions and review it. [docs/limits.md]

questions  2: 2 reviewed, 0 drafted, on 2 pages
  found    1 of 2 reviewed in the top 1 (50%), 1 first (50%)
  answers  2 pinned, 1 not reviewed: 1 current, 0 moved, 1 changed; 0 not pinned

0 errors, 1 warning, 0 notices
```

## Timing rules applied

- Typing 35 ms per character (spec: 35-70 ms). The cursor is a solid block.
- Output appears after the command's measured latency, from the capture run
  plus three timing runs (`media/capture-concepts/latency.txt`): `term check`
  375-416 ms, `term fill --offline` 1864-1902 ms, `graph build` 708-722 ms,
  `graph check` 604-637 ms. `grep` and `sed` get 2 frames. `graph fill`
  (7.33-8.30 s) is the one shortened wait, above.
- Each beat holds 3.4-4.8 s after its main output, so the 88-99 character
  caption can be read on it, and the caption is on screen for the whole beat.
- No narration, so no loudness pass. The AAC 48 kHz track is silence
  (`anullsrc`), measured on the finished file: -70.0 LUFS integrated (the
  meter's floor) and a true peak of -inf.
- Caption cues are one per beat, 5.6-12.1 s each, burned in over two lines of
  about 50 characters. That is longer per cue and per line than broadcast
  caption guidance (6-7 s, about 42 characters). It matches the band the
  earlier videos use. Each cue is a static step title plus caption, not
  speech, so there is nothing to sync against.

## Exact commands, as typed in the video

```bash
cd C:\concepts                # junction to media/scratch-concepts, its own git repo
grep concepts: docs/*.md
manni term check; echo $?
manni term fill --offline     # captured with INFERENCE_MODELS_DIR at an empty directory
manni term check; echo $?
manni graph build
time manni graph fill docs/*.md --fields sample-questions --offline
sed -i 's/one gigabyte/two gigabytes/' docs/limits.md
manni graph check; echo $?
```

## Reproduce

```bash
# 0. Build the CLI (repo root).
npm ci && npm run build

# 1. Demo repository and every capture (from anywhere; needs C:\concepts free,
#    and granite-4.1-3b-q2 downloaded for graph fill)
bash media/capture-concepts/capture.sh
node media/capture-concepts/cols.mjs 23     # run from media/: the font-size table

# 2. Render and package (from media/remotion, after npm ci there;
#    if esbuild's postinstall was skipped: node node_modules/esbuild/install.js)
node scripts/captures-concepts.mjs
npx tsc src/concepts/beats.ts --outDir scripts/out-concepts --module commonjs --target es2020 --resolveJsonModule --esModuleInterop --skipLibCheck
cp src/concepts/captures.json scripts/out-concepts/concepts/
npx remotion render src/index.ts ConceptLifecycleDemo out/concepts/render.mp4
npx remotion still src/index.ts ConceptLifecycleDemo ../concept-lifecycle-1x1.thumb.png --frame=1290
node scripts/vtt-concepts.cjs && node scripts/transcript-concepts.cjs
cd .. && ffmpeg -i remotion/out/concepts/render.mp4 -f lavfi -i anullsrc=r=48000:cl=stereo -map 0:v -map 1:a -shortest -c:v copy -c:a aac -b:a 128k -movflags +faststart concept-lifecycle-1x1.mp4
ffmpeg -i concept-lifecycle-1x1.mp4 -vf "fps=12,scale=540:540:flags=lanczos,split[a][b];[a]palettegen=max_colors=128:stats_mode=diff[p];[b][p]paletteuse=dither=none:diff_mode=rectangle" concept-lifecycle-1x1.gif
```

The suggested LinkedIn post is `media/concept-lifecycle-1x1.post.txt`. Posting
is the author's call.
