# Demo beat sheet for manni check ranking findings by reader (proposal 0109)

- **Type:** feature demo, terminal session. No narration, captions only.
  LinkedIn autoplays muted.
- **Audience:** Docs engineers who triage a red run, and CI engineers who gate
  a docs repository on `manni check`. Phone-sized, muted.
- **Target:** 36.7 s, four beats, one caption line each.
- **Objective.** The viewer sees that a red `manni check` now says which
  readers it hurts. The roll-up ranks personas and journeys worst first. The
  JSON report carries the same ranking, and a fix takes the errors back out.
- **Assets:** `media/check-impact/check-impact-1x1.mp4` (not committed),
  `.thumb.png`, `.vtt`, `.srt`, `.transcript.txt`, `.post.txt`, this file, and
  the capture sources beside it. In `media/remotion/`, the files are
  `src/check-impact/`, `scripts/{captures,vtt,transcript}-check-impact.*` and
  the `CheckImpactDemo` composition in `src/Root.tsx`. No GIF and no
  storyboard. The brief asked for neither, and one shot type, a terminal, needs
  no plan beyond this table.
- **Look:** `docs/content-strategy/design.md`. 1080×1080, 30 fps, title band
  112 px with an `n / 4` counter, caption band 86 px, accent `#58a6ff` blue.
  Never red, green, yellow or cyan. The scroll in beats 1 and 4 carries the
  product's red `✗`, green `✓`, yellow warnings and cyan ids.
- **Material.** `media/scratch-check-impact/`, gitignored by
  `media/scratch-*/`, is a clone of this repository at 9caf1313. A clone keeps
  the history, so every citation's commit resolves. `capture.sh` adds one
  commit, which rewords line 2 of the doc comment above `resolveSchemaSet` in
  `src/meta/core/resolve-schema.ts`. Six citations pin a range holding that
  line. Three of them sit on pages that serve journey m1. Nothing else
  changes, and every line on screen is real output of this branch's build.

| # | Time | Title band | Caption band | Typed | On screen |
|---|---|---|---|---|---|
| 1 | 0:00–0:06 | One red run | manni check runs every check. 2,696 lines go by. | `manni check` | the note `[42.5 s run; the wait is cut to 1.5 s]`, then 2,696 lines scroll past and settle on the roll-up's last rows and `7 checks over 345 files: 1 failed, 1 skipped` |
| 2 | 0:06–0:12 | Who the red run hurts | Readers ranked worst first. M1 tops the journeys. | nothing, the view scrolls back | `The pages with findings serve 4 personas and 48 journeys.`, four persona rows, then `m1 Stand up metadata validation for my repo` at `3 errors, 9 warnings and 3 notices on 6 pages`, marked |
| 3 | 0:12–0:22 | M1's pages, for a script | The same roll-up in JSON. jq lists M1's six pages. | `manni check -f json \| jq -r '.impact[] \| select(.id == "m1") \| .pages[]'` | the note `[26.8 s run; the wait is cut to 1.5 s]`, then six paths under `docs/src/content/docs/meta/` |
| 4 | 0:22–0:37 | Re-mint, then rerun | Re-mint the six pins. 0 failed, and M1 leaves the top. | `manni cite update --accept \| tail -n 1`, then `manni check` | `6 citations rewritten in 6 files, 0 skipped`; the rerun settles on `0 failed, 1 skipped`, then scrolls back to the same heading. The personas carry no errors, and s1 now opens the journeys |

Exact cue times are in `check-impact-1x1.vtt`, generated from the beats the
composition renders.

## Why this story

`manni check` already said what failed, domain by domain. Beat 1 is that wall,
2,696 lines for one comment edit. The summary at its foot says one check
failed and nothing about whom it fails. Beat 2 is the feature. The roll-up
sits between the per-check lines and the summary, so the view scrolls back to
it. Every persona carries errors, and the journey at the top of the journeys
is M1, with three of the six stale pins.

Beat 3 is the same ranking for a script. `jq` pulls M1's pages straight out of
`manni check -f json`, so a maintainer knows where to start. Beat 4 closes the
loop with cite's own advice, printed on every stale pin in beat 1's scroll.
The comment edit changed no claim, so re-minting the pins is the right fix.
The rerun passes, and the same window now opens on s1, with no errors left in
the roll-up.

The repository's own warnings and notices stay in both runs. The roll-up ranks
what a run reports at every severity, and the video shows that as it is.

## Capture notes

- **The CLI is this branch's build,** `node dist/cli.js`, typed as `manni`.
  Its `--version` prints 4.20.0, the published version. semantic-release
  bumps it when the feature ships, so no version is claimed on screen.
- **Colour.** `media/capture/tty.cjs` tells the CLI it writes to a terminal,
  for the two runs a terminal shows directly. The two piped runs go without
  it, as a pipe would, so their output carries no colour.
- **jq is jq 1.6 in WSL** (Ubuntu-22.04). Git Bash on this machine has none.
  Beat 3 runs as one real pipe inside WSL, `node.exe … check -f json | jq …`,
  so jq reads exactly what manni writes to a pipe. Its pipe status is `1 0`,
  the red run's exit code and then jq's.
- **The waits are cut, and only the waits** (`latency.txt`). `manni check`
  prints its whole report once every check is done, so each run is a static
  wait and then one dump. design.md caps a speed-up at 1.3x and says to cut
  dead air above it. Each cut wait carries a chrome note under the command,
  in the accent and in italics, with the real time:

  | Run | Real | Shown |
  |---|---|---|
  | `manni check`, red | 42.5 s | 1.5 s |
  | `manni check -f json \| jq …` | 26.8 s | 1.5 s |
  | `manni cite update --accept \| tail -n 1` | 7.0 s | 1 s |
  | `manni check`, after the fix | 21.2 s | 1.5 s |

- **The dump lands over 0.8 s.** A terminal scrolls 2,700 lines past in a
  moment. The replay spreads them over 0.8 s so the scroll reads as a scroll.
  Every line is drawn, in order.
- **The scroll-back is a view of the same bytes.** Beats 2 and 4 move the
  window up until the family roll-up's heading is the top row. Nothing is
  reprinted. The run's output is ~2,700 lines and the roll-up sits above its
  last rows, so a reader would scroll there too.
- **Font size is derived, not chosen** (`node check-impact/cols.mjs` from
  `media/`). The roll-up pads its rows to its widest title. Each is
  over 100 characters, and no legible size holds one on a row. The script
  checks the window each beat settles on. 28 px / 61 columns is the largest
  size where every row in those windows wraps at a space. No token splits and
  no last row holds one word. A record then reads as its title over its
  counts. The jq line wraps once, at a space. Rows that only pass by in the
  0.8 s scroll can break a long path mid-token, as a terminal does.
- **Ligatures off.** The JSON filter's `==` would draw as one glyph.
- **No `time` in frame.** bash's `time` on Git Bash reports `user 0m0.000s`
  for a native child, which reads as a fault. The chrome note states the
  measured wall time instead.

## How to rebuild it

```bash
# from the repo root
npm run build
bash media/check-impact/capture.sh           # clones media/scratch-check-impact, captures every byte
cd media && node check-impact/cols.mjs       # re-derive the font size

cd remotion
npm ci
node scripts/captures-check-impact.mjs       # captures -> src/check-impact/captures.json
npx remotion render CheckImpactDemo ../check-impact/raw.mp4
# the render has no audio stream; design.md's container carries AAC 48 kHz, so add a silent one
ffmpeg -i ../check-impact/raw.mp4 -f lavfi -i anullsrc=r=48000:cl=stereo -c:v copy -c:a aac \
  -shortest -movflags +faststart ../check-impact/check-impact-1x1.mp4 && rm ../check-impact/raw.mp4
npx remotion still CheckImpactDemo ../check-impact/check-impact-1x1.thumb.png --frame=340

# timings for the sidecars come from the same beats the composition uses
npx tsc --ignoreConfig src/check-impact/beats.ts src/beats.ts --outDir scripts/out-check-impact \
  --module commonjs --target ES2022 --resolveJsonModule --esModuleInterop --skipLibCheck
cd scripts && node vtt-check-impact.cjs && node transcript-check-impact.cjs
```

Thumbnail (`.thumb.png`): frame 340, the end of beat 2. The heading, the four
personas and the marked M1 row are in view. That is the feature in one frame.

## Checks before shipping (design.md)

1. Longest lines measured per window by `cols.mjs`, and checked in rendered
   stills of every beat.
2. No text touches the frame edge, and no token is split.
3. Captions on every beat, one line each, burned in and in the `.vtt` and
   `.srt`.
4. `ffprobe`: 1080×1080, 30 fps, h264 yuv420p, AAC 48 kHz, 36.67 s.
5. The audio track is silent by construction (`anullsrc`). There is no
   narration, so no loudness pass.
6. Accent `#58a6ff`, blue.

## Suggested LinkedIn caption

Also in `check-impact-1x1.post.txt`. Post it only after the release that ships
the feature, since the install line needs it. Do not post; hand it over.

```text
A red docs build says which checks failed. It never said which readers that hurts.

New in manni, manni check ranks every finding by the readers it reaches.

Your pages already name their personas and journeys. After the per-check report, manni check rolls every check's findings up by those records, worst first.

Here one comment in the source changes. Six pinned sentences go stale. The roll-up puts the journey "Stand up metadata validation for my repo" at the top, with 3 errors on 6 pages.

The JSON report carries the same ranking, so jq lists that journey's pages for a script or a dashboard.

Re-mint the pins and run it again. The errors leave the roll-up, and the journey drops off the top.

No flag and no config. A repository with no persona or journey records prints what it always did.

Real output over a clone of the manni repository. The long waits are cut, and the video states each one.

npm i -g @hawkeyexl/manni · manni check
```
