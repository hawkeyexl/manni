# Demo beat sheet for borrowed strategy records (proposal 0112)

- **Type.** A feature demo (`feat(strategy)`, proposal 0112), as a terminal
  session. Captions carry it with no narration, because LinkedIn autoplays
  muted.
- **Audience:** Sara, who owns one strategy that several docsets serve. Phone
  sized and muted.
- **Target:** 33.7 s, three beats, one caption each.
- **Objective:** the viewer sees one set of records serve two repositories.
  A kept copy of a borrowed record is the one finding, and its fix says to
  remove the copy. Once it goes, the check is clean and counts the borrowed
  records. Coverage across both repositories is two JSON files and one join.
- **Assets:** `strategy-shared-1x1.mp4` (not committed), `.thumb.png`, `.vtt`,
  `.srt`, `.transcript.txt`, `.post.txt`, this file, and `capture/` beside it.
  In `media/remotion/`, the files are `src/strategy-shared/`,
  `scripts/{captures,vtt,transcript}-strategy-shared.*` and the
  `StrategySharedDemo` composition in `src/Root.tsx`. No GIF and no
  storyboard. The brief asked for neither, and one shot type, a terminal,
  needs no plan beyond this table.
- **Look:** `docs/content-strategy/design.md`. 1080×1080, 30 fps, title band
  112 px with an `n / 3` counter, caption band 86 px, accent `#58a6ff` blue.
  Never red, green, yellow or cyan. The terminal's colour is the CLI's own.
  That means the red `error` label, the green check mark, the bold file name
  and the dim rule and Guide lines.
- **Material.** Two checkouts side by side, built by `capture/capture.sh`
  under `media/scratch-strategy-shared/`. `manni` is a copy of this
  repository's records, docs pages, page schema and config. `manni-plugin` is
  `capture/manni-plugin/`, one page and its own journey `p1`. It also keeps a
  copy of manni's `personas/maya.md`. Each folder is its own git repository.

| # | Time | Title band | Caption band | Typed | On screen |
|---|---|---|---|---|---|
| 1 | 0:00–0:10 | A kept copy of Maya | Two Mayas. The check names the copy. | `manni strategy check`, `echo $?` | `duplicate-id` on `strategy/personas/maya.md:3` only, its fix to remove the copy (marked), `1 error in 87 records (85 borrowed)`, then `1` |
| 2 | 0:10–0:21 | Remove the copy | One Maya, read from manni. | `git rm strategy/personas/maya.md`, `manni strategy check`, `echo $?` | `rm 'strategy/personas/maya.md'`, then `✓ 86 records (85 borrowed), 92 references, no findings` (marked), then `0` |
| 3 | 0:21–0:34 | Pages per journey, per repo | Coverage across products, as data. | `cd ..`, a loop writing each repository's `strategy list -f json`, the join, pasted | one JSON row each for `d16`, `m1`, `p1` and `t1`, with pages per repository (marked) |

Exact cue times are in `strategy-shared-1x1.vtt` and `.srt`, generated from
the beats the composition renders.

## Why this story

The feature adds no key, flag or verb. A collection path that leaves the
repository is the whole switch. So the story is one consumer's day. Beat 1
starts from the drift the proposal names, a local Maya beside the shared one.
The check reports the local copy only, and its fix says to remove it. Beat 2
removes it, and the clean line counts what the run borrowed. Beat 3 shows the
payoff for Sara, which is coverage across products as data. The owner has 3,
10 and 4 pages on three shared journeys, the plugin has 1 on each, and `p1` is
the plugin's own.

## What is staged and what is real

- **The two checkouts are staged; every byte of output is real.** `manni` is
  a copy of this checkout, so its counts are this repository's own. Its
  `strategy list -f json` matches the repository's record for record.
  `manni-plugin` is written for the demo. Its config names manni's three
  record folders as directories, as the docs recommend, and its own
  `strategy/`.
- **The Maya copy is byte for byte manni's `maya.md`.** It stands for a copy
  kept from an earlier time. Its content makes no difference to the finding,
  which is about the id.
- **The join is `node -e`, not the docs' `jq`.** jq is not installed on the
  capture machine, and the brief ruled out installing it. The one-liner is
  `capture/join.txt`, run as typed. It keeps the four journeys the plugin
  page names and prints the same rows the docs' jq prints for them. At 254
  characters it lands whole, as a paste, because typing it would take 9 s.
- **Beat 3 runs from the folder holding both checkouts,** as the docs'
  recipe does, so it starts with `cd ..`.
- `manni` is `node -r media/capture/tty.cjs dist/cli.js`, which only tells
  the CLI that stdout is a terminal, so colour is emitted. Its `--version`
  prints 4.21.0, the published version. semantic-release bumps it when the
  feature ships, so no version is claimed on screen. The build commit is in
  `capture/build-commit.txt`.
- Not shown, and kept for the record, is the clean check as JSON
  (`capture/check-borrowed.json`). Its summary carries `"borrowed": 85`.

## Capture notes

- **Font size is derived per beat** (`node strategy-shared/capture/cols.mjs`,
  run from `media/`). The wrap is the composition's own. A beat takes the
  largest size, capped at 32 px, at which nothing hard-breaks and no
  wrapped line ends on a lone word. A line breaks after a "/" at most once.
  Beat 1 is 20 px, under the check's 46-column gutter. The borrowed path and
  the Guide URL each break once, after a "/". At 21 px a lone `id.` ends the
  fix line. Beats 2 and 3 are 32 px, the series cap. Beat 2's check line and
  beat 3's JSON rows hold one row each. The composition sets `breakAfter="/"`
  and turns ligatures off.
- **Latency is replayed at 1x.** The replay uses each command's fastest
  measured run, rounded up to a whole frame (`capture/latency.txt`). Each ran
  four times, except `git rm`, which ran once. That gives 694 ms for the first
  check, 72 ms for `git rm` and 577 ms for the second check. Both lists
  together take 2,247 ms and the join 123 ms. Nothing is compressed. Trial
  runs earlier the same day, with a VirtualBox VM holding the CPU at 100%, ran
  slower. The check took up to 4.1 s and the lists up to 29.6 s.
- Typing is 35 ms per character, the fast end of design.md's 35 to 70 ms.
- The audio track is silent AAC, as in the earlier videos. There is nothing
  to normalise for loudness.

## How to rebuild it

```bash
# from the repo root
npm run build
bash media/strategy-shared/capture/capture.sh   # builds both checkouts, captures every byte
(cd media && node strategy-shared/capture/cols.mjs)   # re-derive the sizes

cd media/remotion
npm ci
node scripts/captures-strategy-shared.mjs      # captures -> src/strategy-shared/captures.json
npx remotion render StrategySharedDemo ../strategy-shared/raw.mp4
ffmpeg -i ../strategy-shared/raw.mp4 -f lavfi -i anullsrc=r=48000:cl=stereo -shortest -c:v copy -c:a aac -b:a 64k \
  ../strategy-shared/strategy-shared-1x1.mp4 && rm ../strategy-shared/raw.mp4
npx remotion still StrategySharedDemo ../strategy-shared/strategy-shared-1x1.thumb.png --frame=610

# timings for the sidecars come from the same beats the composition uses
npx tsc --ignoreConfig src/strategy-shared/beats.ts src/beats.ts --outDir scripts/out-strategy-shared \
  --module node16 --moduleResolution node16 --target ES2022 \
  --resolveJsonModule --esModuleInterop --skipLibCheck
cd scripts && node vtt-strategy-shared.cjs && node transcript-strategy-shared.cjs
```

Thumbnail (`.thumb.png`): frame 610, the end of beat 2. The clean check line,
`✓ 86 records (85 borrowed)`, sits marked above exit `0`.

## Suggested LinkedIn caption (do not post; hand over)

See `strategy-shared-1x1.post.txt`.
