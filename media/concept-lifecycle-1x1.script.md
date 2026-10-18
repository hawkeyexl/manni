# Video script: one concept scheme, from freeform tags to a checked graph (0085)

**Objective:** Show the loop proposal 0085 closes. Pages name concepts freely, and
`term check` fails on the ones nobody defined. `term fill` turns them into term
pages. `term check` then names the definitions still to write. The graph takes
its concepts from that termbase, and `graph check` flags a page its own sample
question does not find.
**Format:** 1080x1080, 30 fps, silent, captions burned in (LinkedIn autoplays muted).
**Duration target:** 20-45 s. The four-beat cut below runs 34.6 s.
**Audience:** Sara, the schema author who owns the termbase (S6), and Maya, who
sees the docset as a graph (M18).
**Feature:** proposal 0085, stack tip `19c9f6e7` (`claude/concepts-7-sample-questions`).

Visual spec: `docs/content-strategy/design.md`. Accent `#58a6ff` (blue). Never
red, green, yellow or cyan. manni prints `error` in red here, so the accent stays
blue. Terminal `#171717`, bands `#0d0d0d`, JetBrains Mono throughout. Title band
112 px, 2 px accent rules, caption band 86 px.

## Status of this script

The capture and beat sheet below were taken against `19c9f6e7`. Two changes are
landing before the video is shot, and both change what is on screen.

- `term fill --offline` is being redefined to mean "no network egress". A model
  already on disk may still draft definitions. Without one, the pages are stubs
  plus a warning. Beat 2's output, and possibly beat 3's, will change.
- Proposal 0086 (golden-set questions) adds `graph fill`. Beat 4 becomes
  `graph fill` drafting question and answer pairs, then `graph check` flagging a
  changed answer.

So `media/capture-concepts/*.ans`, `*.exit` and `latency.txt` are the bytes of
`19c9f6e7`. Rerun `capture.sh` on the final build before rendering. No MP4,
VTT, transcript, thumbnail or GIF has been made from them.

## How it is made, and what is staged

Everything printed in the terminal is a real run of `grep`, `echo` or
`node dist/cli.js`. The typed command reads `manni`.

- **A Remotion replay of real bytes, as in the earlier videos.** The
  composition `ConceptLifecycleDemo` (`media/remotion/src/concepts/beats.ts`,
  shared `src/Demo.tsx`) replays the captured bytes. Typing runs at 35 ms/char,
  then Enter, then the output after the command's **measured** latency.
- **manni's bytes come from the TTY preload** `media/capture/tty.cjs`, so the
  bold locations and red `error` are what a terminal receives.
- **One script builds the repository and takes every capture:**
  `media/capture-concepts/capture.sh`. It is the record of the staging.
- **Input is staged by hand, from two fixtures.** `media/capture-concepts/docset/`
  takes its shape from `test/fixtures/term/fill/basic/` (a term page, and pages
  naming concepts it lacks) and `test/graph/fixtures/sample-questions/` (each
  page asks one question, `top: 1`). Two pages name Upload, Retry and Quota.
  Only Upload has a term page. `limits.md` asks "What is the maximum file
  size?", which its own text does not answer. `baseIri` is `https://acme.dev/`
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
- **Ligatures are off.** JetBrains Mono draws `//` in the IRIs and `--` in
  `--offline` as single glyphs; a terminal prints the characters.
- **Row highlight is chrome.** A faint accent ground sits behind the rows a
  caption is about. The bytes are untouched.

## Derived font size

`media/capture-concepts/cols.mjs` runs the replay's own space-only wrap over
every real line. The longest is `graph check`'s warning, 196 characters, which
cannot fit on one row at any legible size. Every size from 30 px down wraps it
at spaces only, never inside a token (longest token 35 characters). **23 px / 75
columns** is the largest size at which both `undefined-term` rows, the point of
beat 1, stay on one row each. At 24 px they wrap. The tallest beat is 12 rows,
384 px of the 838 px available. Re-derive after the recapture.

## Beats (storyboard, as captured at `19c9f6e7`)

Four static full-frame shots. Every beat starts on a cleared terminal and cuts
to the next.

| # | Title (band) | Terminal | Caption (band) | Time (approx.) |
|---|---|---|---|---|
| 1 | Concepts nobody defined | `grep concepts: docs/*.md`, `manni term check; echo $?` | Pages name concepts freely. Retry and Quota have no term page, so term check fails: exit 1. | 0:00.0-0:10.0 |
| 2 | term fill --offline | `manni term fill --offline` | term fill creates a term page for each missing concept. With no model, each page is a stub. | 0:10.0-0:16.5 |
| 3 | What is left to write | `manni term check; echo $?` | No undefined terms left. check now names the two definitions a person, or a model, still writes. | 0:16.5-0:23.4 |
| 4 | One concept scheme | `manni graph build`, `manni graph check; echo $?` | 3 concepts, all from the termbase. limits.md's own question finds another page: a warning, exit 0. | 0:23.4-0:34.6 |

Beat 4 is to be replaced by `graph fill` and a `graph check` that flags a
changed answer, once 0086 lands. Beat 2's caption follows the new meaning of
`--offline`.

## Real output quoted (`19c9f6e7`, ANSI stripped)

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

Beat 4, `manni graph build` (exit 0) and `manni graph check` (exit 0):

```
Wrote C:\concepts\graph.ttl (5 docs, 100 triples, 3 concepts (3 from the termbase))
```

```
warning: https://acme.dev/doc/docs/limits.md graph:sampleQuestion — "What is the maximum file size?" does not find this page in the top 1 (it is not found; first is docs/retry.md) [docs/limits.md]

0 errors, 1 warning, 0 notices
```

## Timing rules applied

- Typing 35 ms per character (spec: 35-70 ms). The cursor is a solid block.
- Output appears after the command's measured latency, from the capture run
  plus three timing runs (`media/capture-concepts/latency.txt`): `term check`
  379-418 ms, `term fill --offline` 385-424 ms, `graph build` 713-836 ms,
  `graph check` 594-650 ms. `grep` gets 2 frames.
- Each beat holds 4.2-5.4 s after its main output, so the 90-100 character
  caption can be read on it.
- No narration, so no loudness pass. The audio track is silence.

## Reproduce

```bash
# 0. Build the CLI (repo root).
npm ci && npm run build

# 1. Demo repository and every capture (from anywhere; needs C:\concepts free)
bash media/capture-concepts/capture.sh
node media/capture-concepts/cols.mjs 23     # run from media/: the font-size table

# 2. Render (from media/remotion, after npm ci there)
node scripts/captures-concepts.mjs
npx remotion render src/index.ts ConceptLifecycleDemo out/concepts/render.mp4
```
