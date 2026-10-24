# Demo beat sheet for journey steps in manni strategy (proposal 0106)

- **Type:** feature demo, terminal session. No narration; captions only
  (LinkedIn autoplays muted).
- **Audience:** docs engineers and information architects who keep journeys
  as records and want to know which pages carry each one.
  Phone-sized, muted.
- **Target:** 34 s, four beats, one caption line each.
- **Objective.** The viewer sees that a journey's `steps:` name real pages
  and that the tool holds each step to its page. `check` finds a page that
  does not name the journey and a page not written yet. One edit to the
  page serves the step, and `get` shows coverage step by step.
- **Assets:** `media/strategy-steps-1x1.mp4` (not committed), `.thumb.png`,
  `.vtt`, `.srt`, `.transcript.txt`, `.post.txt`, this file,
  `media/capture-strategy-steps/`, `media/remotion/src/strategy-steps/`,
  `media/remotion/scripts/{captures,vtt,transcript}-strategy-steps.*` and the
  `StrategyStepsDemo` composition in `media/remotion/src/Root.tsx`. No GIF
  and no storyboard. The brief asked for neither, and one shot type, a
  terminal, needs no plan beyond this table.
- **Look:** `docs/content-strategy/design.md`. 1080×1080, 30 fps, title band
  112 px with an `n / 4` counter, caption band 86 px, accent `#58a6ff` blue.
  Never red, green, yellow or cyan. The frame already holds a yellow
  `warning`, a cyan `notice` and git's green `+` lines and cyan hunk header.
- **Material.** `test/fixtures/strategy/steps/`, copied into
  `media/scratch-strategy-steps/` (gitignored by `media/scratch-*/`), which is
  its own git repository. Without one, the outer repo's `.gitignore` hides
  every file from manni. One file is trimmed. `strategy/journeys/m1.md` is
  `capture-strategy-steps/m1.before.md`, which keeps four of the fixture's
  nine steps: two served pages, `docs/reference.md`, which does not name
  `m1`, and `/site/tutorial/`, planned with `exists: false`. The other five
  steps show the remaining states (`partial`, `broken`, `unchecked`, a stale
  `exists: false`, a stage with no doc). They would double beat 2's
  findings, so they are left out. Everything shown is real execution.

| # | Time | Title band | Caption band | Typed | On screen |
|---|---|---|---|---|---|
| 1 | 0:00–0:07 | A journey lists its steps | A journey lists the pages it walks through, in order. | `cat strategy/journeys/m1.md` | `type: journey`, `id: m1`, `personas: [maya]` and four `steps:`, each a `stage` with a `doc`: `docs/guide.md`, the site route `/site/ci/`, `docs/reference.md` and `/site/tutorial/` with `exists: false` |
| 2 | 0:07–0:19 | manni strategy check | Step 3's page skips m1. Step 4 is unwritten. Exit 0. | `manni strategy check`, then `echo $?` | `strategy/journeys/m1.md:12`, yellow `warning`, `missing-journey`, `step 3: docs/reference.md does not name "m1" in journeys:.` and its fix line; `m1.md:13`, cyan `notice`, `unwritten-step`, `step 4: doc "/site/tutorial/" names a page that does not exist.`; dim rule and Guide lines; `1 warning, 1 notice in 4 records`; `0` |
| 3 | 0:19–0:26 | The page joins the journey | The reference page names m1, its persona and audience. | `git diff docs/reference.md` | `+audiences: [docs-engineers]`, `+personas: [maya]`, `+journeys: [m1]` |
| 4 | 0:26–0:34 | manni strategy get m1 | Coverage, in order: 3 of 4 served, 1 unwritten. | `manni strategy get m1` | the record, then `steps  3 of 4 served` and each step's number, state and stage over its page: `served` `docs/guide.md`, `served` `docs/ci/index.md` (the `/site/ci/` route resolved), `served` `docs/reference.md`, `unwritten` `/site/tutorial/`; `pages` lists the three pages |

Exact cue times are in `strategy-steps-1x1.vtt`, generated from the beats the
composition renders.

## Why this story

The feature ties a journey to the pages that carry it. Beat 1 shows that list
as an author writes it, a stage and a doc per step, in order. One doc is a
site route, not a file path.

Beat 2 is the check. Its two findings are the two new kinds a team meets
first. A page the journey sends readers to does not name the journey back.
A page the journey plans is not written yet. Exit 0 is the honest result.
`missing-journey` is a warning and `unwritten-step` a notice, so CI annotates
and passes. Only `broken-step`, a doc that names no page, fails the run.

Beat 3 is the fix on the page side. Naming `m1` alone is not enough. A page
that names a journey must also name the journey's persona and that persona's
audience, or the existing `missing-parent` rule warns. So the page gains the
same three lines `docs/guide.md` already carries. The caption says so rather
than hiding two of the lines.

Beat 4 ends on coverage. `3 of 4 served`, in the journey's own order, with the
route resolved to its page and the planned tutorial still `unwritten`. After
the fix, `manni strategy check` prints only that notice and exits 0
(`capture-strategy-steps/check-after.ans`, captured but not shown).

## Capture notes

- **The CLI is this branch's build,** `node dist/cli.js`, typed as `manni`,
  rebuilt with `npm run build` before capture. Its `--version` prints 4.20.0,
  the published version; semantic-release bumps it when steps ship. So no
  version is claimed on screen.
- **Colour.** `media/capture/tty.cjs` tells the CLI it writes to a terminal.
  `git diff` gets `-c color.ui=always` for the same reason.
- **Latency is replayed at 1x** (`capture-strategy-steps/latency.txt`):
  check 611 ms, diff 98 ms, get 597 ms. Nothing is compressed.
- **The check's layout sets beat 2's size.** `strategy check` prints each
  finding under a 46-column gutter and wraps its own continuation lines there.
  Both finding rows run 104 and 106 columns, so they wrap at any legible
  size.
- **Wrapped rows hang under the gutter.** At the shared wrap, a finding row
  would continue at column 2, under the severity, and read as a new finding.
  `src/beats.ts` gains an opt-in per-beat `hang` column, and `Demo.tsx`
  continues a wrapped row there when it is deeper than the line's own indent.
  Beat 2 sets `hang: 46`, so `in journeys:.` lands where the CLI puts its own
  continuation lines. Bytes are untouched; earlier videos leave it unset and
  render as before.
- **Font size is derived per beat, not chosen** (`node capture-strategy-steps/cols.mjs 19`).
  - Beat 2: **19 px / 91 columns.** The largest size at which beat 2's rows
    fit and no wrapped line leaves a one-word last row. At 20 to 22 px the
    fix line ends on `does.` alone. The two Guide URLs break after a `/`,
    and each `Guide:` label sits on its own row above its URL. That is a
    space wrap, not a split token.
  - Beats 1, 3 and 4 take the largest size at which none of their lines
    wraps, capped at the series' 32 px. They are 32 px / 54 columns,
    32 px / 54 and 24 px / 72. The `get` header, with its path, is the 72-column line.
- **Ligatures off.** The record's `---` fences would draw as one rule.
- **Audio.** Rendered with `--enforce-audio-track`, so the file carries the
  silent AAC 48 kHz track design.md's container calls for.

## How to rebuild it

```bash
# from the repo root
npm run build
bash media/capture-strategy-steps/capture.sh        # stages media/scratch-strategy-steps, captures every byte
cd media && node capture-strategy-steps/cols.mjs 19  # re-derive the font sizes, per beat

cd remotion
npm ci
node scripts/captures-strategy-steps.mjs             # captures -> src/strategy-steps/captures.json
npx remotion render StrategyStepsDemo ../strategy-steps-1x1.mp4 --enforce-audio-track
npx remotion still StrategyStepsDemo ../strategy-steps-1x1.thumb.png --frame=570

# timings for the sidecars come from the same beats the composition uses.
# TypeScript 7 needs --ignoreConfig beside a tsconfig, and has dropped
# --moduleResolution node.
npx tsc src/strategy-steps/beats.ts src/beats.ts --ignoreConfig \
  --outDir scripts/out-strategy-steps --module commonjs --target ES2022 \
  --resolveJsonModule --esModuleInterop --skipLibCheck
cd scripts && node vtt-strategy-steps.cjs && node transcript-strategy-steps.cjs   # .vtt, .srt, .transcript.txt
```

Thumbnail (`.thumb.png`): frame 570, the end of beat 2. Both findings are
marked, the summary line and `0` are in view, and the caption names both
problems. That is the check in one frame.

## Checks before shipping (design.md)

1. Longest lines measured per beat by `cols.mjs`, and checked in rendered
   stills of every beat (frames 210, 570, 760, 1025).
2. No text touches the frame edge. The only split tokens are the two Guide
   URLs, broken after a `/`, named above.
3. Captions on every beat, one line each, burned in and in the `.vtt` and
   `.srt`. Beat 2's first draft wrapped its caption and left `0.` on its
   own row; it was shortened to fit one line.
4. `ffprobe`: 1080×1080, 30 fps, h264 yuv420p, AAC 48 kHz, 34.37 s.
5. The audio track measures −91 dB, silent. There is no narration, so no
   loudness pass.
6. Accent `#58a6ff`, blue.

## Suggested LinkedIn caption

Also in `strategy-steps-1x1.post.txt`. Post it only after the release that
ships journey steps. Do not post; hand over.

```text
A journey says who reads what, in order. Then the pages it points at change, and nobody tells the journey.

New in manni strategy, a journey record can list its steps. Each step is a stage and the page that carries it, as a repo path or a site route.

`manni strategy check` holds each step to its page. Here step 3's page never names the journey back, a warning. Step 4's page is planned and not written yet, a notice. Neither fails CI: exit 0.

Add the journey to the page, and `manni strategy get m1` shows coverage in the journey's order: 3 of 4 served, 1 unwritten.

Real output from a real test fixture. Only the input is staged.

npm i -g @hawkeyexl/manni · manni strategy get <journey>
```
