# Demo beat sheet for manni strategy (proposal 0102)

- **Type:** feature demo, terminal session. No narration; captions only
  (LinkedIn autoplays muted).
- **Audience:** docs engineers and information architects who keep a content
  strategy (audiences, personas, journeys) and tag pages with it.
  Phone-sized, muted.
- **Target:** 38 s, four beats, one caption line each.
- **Objective:** the viewer sees that whom a page serves is now checked. A
  journey filed as a persona is caught, with the persona it meant. A journey
  no page serves is caught too. One edit clears both, and `list` shows the
  tree.
- **Assets:** `media/strategy-check-1x1.mp4` (not committed), `.thumb.png`,
  `.vtt`, `.srt`, `.transcript.txt`, `.post.txt`, this file,
  `media/capture-strategy/`, `media/remotion/src/strategy/`,
  `media/remotion/scripts/{captures,vtt,transcript}-strategy.*` and the
  `StrategyCheckDemo` composition in `media/remotion/src/Root.tsx`. No GIF
  and no storyboard: the brief did not ask for a GIF, and one shot type
  (a terminal) needs no storyboard beyond this table.
- **Look:** `docs/content-strategy/design.md`. 1080×1080, 30 fps, title band
  112 px with an `n / 4` counter, caption band 86 px, accent `#58a6ff` blue.
  Never red, green, yellow or cyan. The frame already holds a red `error`, a
  yellow `warning`, a green `✓` and git's red and green diff lines.
- **Material.** `test/fixtures/strategy/clean/`, copied byte for byte into
  `media/scratch-strategy/` (gitignored by `media/scratch-*/`), which is its own
  git repository. It holds one audience `docs-engineers`, one persona `maya`,
  two journeys `m1` and `m2`, and two pages. Its `manni.config.yaml` declares
  a `site` collection for `docs/` and a `strategy` collection for the records.
  Only `docs/guide.md` starts different: `media/capture-strategy/guide.before.md`
  lists `m1` under `personas:` and names no journeys. The fix is the fixture's
  own page copied back, so the passing set is the set the test suite runs.
  Everything shown is real execution.

| # | Time | Title band | Caption band | Typed | On screen |
|---|---|---|---|---|---|
| 1 | 0:00–0:09 | A journey filed as a persona | m1 is a journey, but the guide lists it as a persona. | `cat strategy/journeys/m1.md`, then `cat docs/guide.md` | the journey record: `type: journey`, `id: m1`, `personas: [maya]`; the page: `personas: [m1]` |
| 2 | 0:09–0:20 | manni strategy check | It suggests maya, and finds m2 with no page. Exit 1. | `manni strategy check`, then `echo $?` | `docs/guide.md:4`, red `error`, `personas: "m1" is a journey, not a persona.` and `Did you mean its persona, "maya"?`; `strategy/journeys/m2.md:3`, yellow `warning`, `no page names this journey in journeys:.`; dim rule and Guide lines; `1 error, 1 warning in 4 records`; `1` |
| 3 | 0:20–0:31 | Fix the page, and it passes | The guide now names maya, and both journeys. Exit 0. | `git diff docs/guide.md`, `manni strategy check`, `echo $?` | `-personas: [m1]`, `+personas: [maya]`, `+journeys: [m1, m2]`; `✓ 4 records, 10 references, no findings`; `0` |
| 4 | 0:31–0:38 | manni strategy list | Each record, and how many pages name it. m2 has one. | `manni strategy list` | the tree `docs-engineers` › `maya` › `m1`, `m2` with page counts 2, 2, 2, 1; `1 audience, 1 persona, 2 journeys` |

Exact cue times are in `strategy-check-1x1.vtt`, generated from the beats the
composition renders.

## Why this story

The feature is a check on whom a page serves. The clearest proof is a
mistake a reviewer would wave through: a journey id typed into `personas:`.
Beat 1 shows the record, so the viewer knows `m1` is a journey before the
tool says so. Beat 2 is the payoff. The error does not stop at "not a
persona"; it names the persona the journey belongs to. The second finding
covers the other half of the feature, a journey no page serves, which no
single page could ever reveal.

Beat 3 shows one edit clearing both, and the exit code CI reads. Beat 4 ends
on the tree, where `m2` now counts one page. That closes the loop the
warning opened.

## Capture notes

- **The CLI is this branch's build,** `node dist/cli.js`, typed as `manni`.
  Its `--version` prints 4.18.0, the published version; semantic-release
  bumps it when `strategy` ships. So no version is claimed on screen.
- **Colour.** `media/capture/tty.cjs` tells the CLI it writes to a terminal.
  `git diff` gets `-c color.ui=always` for the same reason: the capture is a
  file, and that flag gives the colour git prints to a terminal.
- **Latency is replayed at 1x** (`capture-strategy/latency.txt`): check
  before 340 ms, diff 83 ms, check after 336 ms, list 336 ms. Nothing is
  compressed.
- **The check's layout sets beat 2's size.** `strategy check` prints each
  message under a 46-column gutter, and its dim rule and Guide lines run to
  194 and 133 characters. No legible size holds those on one row.
- **Font size is derived per beat, not chosen** (`node capture-strategy/cols.mjs 19`).
  - Beat 2: **19 px / 91 columns.** The largest size at which neither finding's
    first row wraps. At 20 px the error row breaks before `persona.`, an
    orphan. The dim lines wrap at spaces under their own gutter. The
    `unserved-journey` rule line, which now ends "and a draft or archived
    journey is exempt.", wraps to a last row of one word, `exempt.`. That
    is a space wrap of a dim line, not a finding row or a broken token, so
    the size stays at 19 px. `cols.mjs` counts that row as an orphan, and
    17 px / 101 columns is its orphan-free size. The two
    Guide URLs (80 and 77 characters, no space) break after a `/`. That is
    the new opt-in `breakAfter="/"` in `Demo.tsx`; nothing else splits a
    token.
  - Beats 1, 3 and 4 are not held to beat 2's 19 px. Each takes the largest
    size at which none of its lines wraps and its rows fit, capped at the
    series' 32 px. That is 32 px / 54 columns, 31 px / 55 and 24 px / 72. The
    `list` table is the 72-column line. This uses the new opt-in per-beat
    `type` field in `src/beats.ts`; earlier videos leave it unset and render
    as before.
- **Ligatures off.** The records' `---` fences would draw as one rule.

## How to rebuild it

```bash
# from the repo root
npm run build
bash media/capture-strategy/capture.sh        # stages media/scratch-strategy, captures every byte
cd media && node capture-strategy/cols.mjs 19  # re-derive the font sizes, per beat

cd remotion
npm ci
node scripts/captures-strategy.mjs             # captures -> src/strategy/captures.json
npx remotion render StrategyCheckDemo ../strategy-check-1x1.mp4
npx remotion still StrategyCheckDemo ../strategy-check-1x1.thumb.png --frame=592

# timings for the sidecars come from the same beats the composition uses
npx tsc src/strategy/beats.ts src/beats.ts --outDir scripts/out-strategy \
  --module commonjs --target ES2022 --moduleResolution node \
  --resolveJsonModule --esModuleInterop --skipLibCheck
cd scripts && node vtt-strategy.cjs && node transcript-strategy.cjs   # .vtt, .srt, .transcript.txt
```

Thumbnail (`.thumb.png`): frame 592, the end of beat 2. Both findings are
marked, `Did you mean its persona, "maya"?` is in view, and `1` sits below the
prompt. That is the feature in one frame.

## Checks before shipping (design.md)

1. Longest lines measured per beat by `cols.mjs`, and checked in rendered
   stills of every beat.
2. No text touches the frame edge. The only split tokens are the two Guide
   URLs, broken after a `/`, named above.
3. Captions on every beat, one line each, burned in and in the `.vtt` and
   `.srt`.
4. `ffprobe`: 1080×1080, 30 fps, h264 yuv420p, AAC 48 kHz, 37.59 s.
5. The finished file's audio measures as a silent track at −91 dB. There is
   no narration, so no loudness pass.
6. Accent `#58a6ff`, blue.

## Suggested LinkedIn caption

Also in `strategy-check-1x1.post.txt`. Post it only after the release that
ships `manni strategy`, since the install line needs it. Do not post; hand
over.

```text
Docs teams write down whom their pages serve. Then the tags drift from it.

New in manni, in beta: manni strategy. Your audiences, personas and journeys are records, one file each. A persona names its audience, and a journey names its personas.

`manni strategy check` holds every page's audiences:, personas: and journeys: to those records.

Here a guide lists journey m1 as a persona. check says so, and names the persona m1 belongs to, maya. It also finds journey m2, which no page serves. Exit 1.

Fix the two tags and it passes, exit 0. `manni strategy list` prints the tree, with how many pages name each record.

Real output from a real test fixture. Only the input is staged.

npm i -g @hawkeyexl/manni · manni strategy check
```
