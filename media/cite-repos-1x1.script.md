# Demo beat sheet for citations from more than one checkout (proposal 0100)

- **Type:** feature demo, terminal session. No narration; captions only
  (LinkedIn autoplays muted).
- **Audience:** Maya, the docs engineer whose page rests on code in two
  repositories (CUJ M5), and Devin, whose gate stays red until someone deletes
  a pin that holds (CUJ D5). Phone-sized, muted.
- **Target:** 43.5 s, five beats, one caption each.
- **Objective:** the viewer sees one page that cites `api` and `sdk` fail
  under either `--root`, then pass in one run once `cite.repos` names both
  checkouts. A later commit in `sdk` reports on the one sentence it made
  stale, printed as `sdk:src/client.ts:2`.
- **Assets:** `media/cite-repos-1x1.mp4` (not committed), `.gif`,
  `.thumb.png`, `.vtt`, `.transcript.txt`, `.post.txt`, this file,
  `media/capture-repos/`, `media/remotion/src/cite-repos/`, the
  `captures-`, `vtt-` and `transcript-cite-repos` scripts, and the
  `CiteReposDemo` composition in `media/remotion/src/Root.tsx`.
- **Look:** `docs/content-strategy/design.md`. 1080×1080, 30 fps, title band
  112 px with `n / 5` counter, caption band 86 px, accent `#58a6ff` blue.
  Never red, green, yellow or cyan: the frame already holds red `✗` and
  summaries, green `✓`, cyan citation ids, and git's yellow SHA and red/green
  diff lines.
- **Material.** `media/scratch-cite-repos/` (gitignored) holds three git
  checkouts side by side, `docs`, `api` and `sdk`, with a pinned author and
  pinned dates, so every SHA on screen reproduces. `api/lib/limits.ts` and
  `sdk/src/client.ts` are byte copies of `test/fixtures/cite-repos/`. The page
  `docs/pages/limits.md` says "A request times out after 30 seconds." and
  "The SDK retries a failed request three times." Everything shown is real
  execution.

| # | Time | Title band | Caption band | Typed | On screen |
|---|---|---|---|---|---|
| 1 | 0:00–0:15 | One root per run | The page cites api and sdk. Either --root fails the other pin, exit 1. | `manni cite check pages/limits.md --root ../api; echo $?`, then the same with `--root ../sdk` | under `../api`, `retries … src/client.ts:2 missing`; under `../sdk`, `timeout … lib/limits.ts:2 missing`; each with the advice to remove the pin; `1` twice |
| 2 | 0:15–0:20 | Name each checkout | One key in manni.config.yaml. cite.repos names each checkout. | `cat manni.config.yaml` | `cite:` / `repos:` / `api: ../api` / `sdk: ../sdk` |
| 3 | 0:20–0:28 | One run, both pins | Each pin resolves in its own checkout, printed as api: and sdk:. Exit 0. | `manni cite check pages/limits.md; echo $?` | `✓ timeout … api:lib/limits.ts:2 current`, `✓ retries … sdk:src/client.ts:2 current`; green summary; `0` |
| 4 | 0:28–0:34 | The SDK changes | A commit in sdk moves the pinned line from 3 attempts to 5. | `git -C ../sdk log -1 -p --oneline -U0` | `d5b21f0 feat: retry five times`; `-  … { attempts: 3 });` / `+  … { attempts: 5 });` |
| 5 | 0:34–0:43 | The stale sentence | Only retries reports, in sdk, with the commit it changed since. Exit 1. | `manni cite check pages/limits.md; echo $?` | `✓ timeout … api:lib/limits.ts:2 current`; `✗ retries … sdk:src/client.ts:2 changed since ce9ce76, 1 commit`; the `--accept --only retries` advice; `1` |

## Why this story

The feature closes a gap that no flag could, so the "before" has to be real
and has to fail both ways. Beat 1 runs this build on a page pinned the only way
it could be before 0100: one `cite add --root` per checkout. Each root turns
the other pin into `missing`, and the advice on that line deletes a citation
that holds. That is the proposal's Problem section, reproduced.

Beats 2 and 3 are the fix and its proof: one config key, one run, both pins
`current`, and the repo name in the source column. Beats 4 and 5 show that the
pin still does its job across the checkout boundary. A commit in `sdk` lands
on exactly one sentence, and the finding names `sdk` and the baseline commit.
`cite update --accept` and the `-f github` annotation from the worked example
stay out of frame; 43.5 s of a 45 s ceiling is spent.

## Capture notes

- **Two passes, one page.** `capture.sh` first mints both pins with no
  `manni.config.yaml`, each under its own `--root` (`mint-before-*.ans`), and
  captures beat 1. It then restores the unpinned page, declares `cite.repos`,
  and mints with `api:lib/limits.ts:2` and `sdk:src/client.ts:2`
  (`mint-*.ans`, `page-pinned.md`). Config discovery stops at the `docs`
  checkout's own `.git`, so manni's root config never reaches the demo.
- **This branch's build,** `node dist/cli.js`, typed as `manni`. Its
  `--version` (`version.txt`) is the last release, because semantic-release
  bumps the number at release time, so no version is claimed on screen.
- **Colour.** `media/capture/tty.cjs` tells the CLI it writes to a terminal.
  Beat 4 is typed as `git -C ../sdk log -1 -p --oneline -U0` and captured with
  `-c color.ui=always`, which stands in for the terminal git would colour for.
- **`Using manni.config.yaml (.)`** in beats 3 and 5 is manni's own stderr
  line, captured with `2>&1` in the order a terminal shows it.
- **Exit codes** are each run's real status (`*.exit`), printed by the typed
  `; echo $?`.
- **Latency is replayed at 1x** (`capture-repos/latency.txt`): 518 ms and
  546 ms for beat 1, 517 ms for beat 3, 53 ms for git, 768 ms for beat 5.
  Nothing is compressed.
- **Font size is derived, not chosen** (`node capture-repos/cols.mjs 21`).
  23 px (75 columns) fits every beat but orphans `commit` from beat 5's
  81-character `retries` row, the payoff of the video. 21 px gives 82
  columns, keeps that row whole and fits beat 1's 25 rows. The longest token
  is the Guide URL at 64 columns with its indent.
- **Ligatures off.** `--root`, `../api` and git's `@@` are characters in a
  terminal.

## How to rebuild it

```bash
# from the repo root
npm run build
bash media/capture-repos/capture.sh          # stages media/scratch-cite-repos, captures every byte
cd media && node capture-repos/cols.mjs 21    # re-derive the font size

cd remotion
npm ci
node scripts/captures-cite-repos.mjs          # captures -> src/cite-repos/captures.json
npx remotion render CiteReposDemo ../cite-repos-1x1.mp4
npx remotion still CiteReposDemo ../cite-repos-1x1.thumb.png --frame=1295

# timings for the sidecars come from the same beats the composition uses
npx tsc src/cite-repos/beats.ts src/beats.ts --outDir scripts/out-cite-repos \
  --module commonjs --target ES2022 --moduleResolution node \
  --resolveJsonModule --esModuleInterop --skipLibCheck
cd scripts && node vtt-cite-repos.cjs && node transcript-cite-repos.cjs

# GIF, for hosts that will not take an MP4
cd ../.. && ffmpeg -i cite-repos-1x1.mp4 -vf "fps=12,scale=540:540:flags=lanczos,split[a][b];[a]palettegen=max_colors=128:stats_mode=diff[p];[b][p]paletteuse=dither=none:diff_mode=rectangle" cite-repos-1x1.gif
```

Thumbnail (`.thumb.png`): frame 1295, the end of beat 5. `api:` current,
`sdk:` changed since `ce9ce76` with its advice marked, and `1` below the
prompt. That is the feature in one frame.

## Checks before shipping (design.md)

1. Longest line measured: 82 columns at 21 px, checked in the rendered stills.
2. No text touches the frame edge; no token is split across a row.
3. Captions on every beat, burned in and in the `.vtt`.
4. `ffprobe`: 1080×1080, 30 fps, h264 yuv420p, AAC 48 kHz, 43.52 s.
5. The audio track measures silent at −91 dB. There is no narration, so no loudness pass.
6. Accent `#58a6ff`, blue.

## Suggested LinkedIn caption

In `cite-repos-1x1.post.txt`. Do not post; hand over.
