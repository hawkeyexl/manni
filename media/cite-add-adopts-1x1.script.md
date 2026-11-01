# Demo beat sheet for `cite add` adopting a marker (proposal 0127)

- **Type:** feature demo, terminal session. No narration; captions only
  (LinkedIn autoplays muted).
- **Audience:** Maya, the docs engineer who writes a spec page before the code
  exists (CUJ M5). Also Theo, who reads a `marker-orphan` and wants the one
  command that clears it (CUJ T2). Phone-sized, muted.
- **Target:** 42.7 s, five beats, one caption each.
- **Objective:** The viewer sees a spec page name two claims with a marker.
  `check` lists each as an orphan and fails. Then `cite add` pins each one by
  adopting the marker. The page body does not change, and the check ends clean.
- **Assets:** `media/cite-add-adopts-1x1.mp4` (not committed), `.gif`,
  `.thumb.png`, `.vtt`, `.transcript.txt`, `.post.txt`, this file,
  `media/capture-cite-adopts/`, `media/remotion/src/cite-add-adopts/`, the
  `captures-`, `vtt-` and `transcript-cite-add-adopts` scripts, and the
  `CiteAddAdoptsDemo` composition in `media/remotion/src/Root.tsx`.
- **Look:** `docs/content-strategy/design.md`. 1080x1080, 30 fps, title band
  112 px with `n / 5` counter, caption band 86 px, accent `#58a6ff` blue.
  Never red, green, yellow or cyan. The frame already holds red `✗` and
  summaries, green `✓` and git's `+` run, and cyan citation ids.
- **Material.** `media/scratch-cite-adopts/` (gitignored) is one git repository
  with a pinned author and pinned dates, so the source commit `bd41a58`
  reproduces. `docs/design/retry.md` is the page from proposal 0127. A marker
  above "Failed requests retry 3 times by default." names `retry-default` and
  `retry-default-test`, and no entry exists. `lib/limits.ts` holds
  `export const RETRIES = 3;` on line 2, and `lib/limits.test.ts` holds one test
  line. Everything shown is real execution.

| # | Time | Title band | Caption band | Typed | On screen |
|---|---|---|---|---|---|
| 1 | 0:00-0:05 | Spec before code | The spec comes first. A marker names two claims that no entry pins yet. | `cat -n docs/design/retry.md` | the page, the marker on line 6 and the sentence on line 7 |
| 2 | 0:05-0:13 | The to-do list | check lists a marker-orphan for each id. Exit 1 is the to-do list. | `manni cite check docs/design/retry.md; echo $?` | two `✗` rows, each `marker-orphan`, `1 file checked, 0 passed, 1 failed, 2 findings`, `1` |
| 3 | 0:13-0:23 | Pin the first claim | add adopts the marker. No --marker flag, and the sentence is untouched. | `manni cite add docs/design/retry.md:7 lib/limits.ts:2 --id retry-default` | `added retry-default to frontmatter; adopted the marker at line 15, claim pinned at line 16` |
| 4 | 0:23-0:32 | Pin the second claim | The sentence sits at line 16 now. The first entry grew the frontmatter. | `manni cite add docs/design/retry.md:16 lib/limits.test.ts:1 --id retry-default-test` | `adopted the marker at line 23, claim pinned at line 24` |
| 5 | 0:32-0:43 | Nothing left to fix | Both rows current, exit 0. The diff holds insertions only, no edits. | `manni cite check docs/design/retry.md; echo $?`, then `git diff --stat docs/design/retry.md` | two `✓` rows, `0 findings`, `0`; `17 insertions(+)` and no deletions |

## Why this story

The pain is the one in the proposal. On 4.27.2 the claim could not be pinned
once the code existed. Dropping `--marker` succeeded, then the next check
rejected what `add` had written. The "before" is therefore the to-do list
itself, a real failing check, and the fix is the same command the reader would
type anyway.

Beat 4 is on screen because the line number changes. The sentence moved from
line 7 to line 16 when the first entry grew the frontmatter, and the command
names line 16. The report line says so, so no one has to count. Beat 5 closes
the story with the check clean and `git diff --stat` showing 17 insertions and
no deletions, so no line of the page was rewritten. The refusal messages for
lines outside the marker's text stay out of frame.

## Capture notes

- **One pass, one page.** `capture.sh` stages the repository, then runs
  `cat -n`, `check`, `add`, `add`, `check` and `git diff --stat` in order and
  keeps each run's bytes (`*.ans`), exit code (`*.exit`) and latency
  (`latency.txt`). Config discovery stops at the scratch repository's own
  `.git`, so manni's root config never reaches the demo.
- **This branch's build,** `node dist/cli.js`, typed as `manni`. Its
  `--version` (`version.txt`) is the last release, because semantic-release
  bumps the number at release time, so no version is claimed on screen.
- **Colour.** `media/capture/tty.cjs` tells the CLI it writes to a terminal.
  The diff is captured with `-c color.ui=always`, which stands in for the
  terminal git would colour for.
- **Exit codes** are each run's real status, printed by the typed `; echo $?`.
- **Long report lines** wrap at spaces in the frame, as the cite-repos video
  does. The tool's bytes are never changed.
- **Latency is replayed at 1x** (`capture-cite-adopts/latency.txt`). The runs
  took 624, 695, 744 and 568 ms, and git took 66 ms. Nothing is compressed.
- **Font size is derived** (`node capture-cite-adopts/cols.mjs 26`). The
  longest token is the Guide URL at 63 columns with its indent, so 27 px and
  below fit. 26 px (66 columns) keeps three columns of margin. Beat 5 sets its
  own 22 px (78 columns), because its check rows are 77 characters and 66
  columns would orphan `current`.
- **Ligatures off.** `--marker` and `=>` are characters in a terminal.

## How to rebuild it

```bash
# from the repo root
npm run build
bash media/capture-cite-adopts/capture.sh        # stages media/scratch-cite-adopts, captures every byte
cd media && node capture-cite-adopts/cols.mjs 26  # re-derive the font size

cd remotion
npm ci
node scripts/captures-cite-add-adopts.mjs        # captures -> src/cite-add-adopts/captures.json
npx remotion render CiteAddAdoptsDemo ../cite-add-adopts-1x1.mp4
npx remotion still CiteAddAdoptsDemo ../cite-add-adopts-1x1.thumb.png --frame=1270

# timings for the sidecars come from the same beats the composition uses
npx tsc src/cite-add-adopts/beats.ts src/beats.ts --outDir scripts/out-cite-add-adopts \
  --module commonjs --target ES2022 --moduleResolution node \
  --resolveJsonModule --esModuleInterop --skipLibCheck
cd scripts && node vtt-cite-add-adopts.cjs && node transcript-cite-add-adopts.cjs

# GIF, for hosts that will not take an MP4
cd ../.. && ffmpeg -i cite-add-adopts-1x1.mp4 -vf "fps=12,scale=540:540:flags=lanczos,split[a][b];[a]palettegen=max_colors=128:stats_mode=diff[p];[b][p]paletteuse=dither=none:diff_mode=rectangle" cite-add-adopts-1x1.gif
```

Thumbnail (`.thumb.png`): frame 1270, the end of beat 5. Both rows `current`,
`0 findings`, exit `0`, and the diff with insertions only. That is the feature
in one frame.

## Checks before shipping (design.md)

1. Longest token measured: 63 columns with its indent, checked in the rendered stills.
2. No text touches the frame edge; no token is split across a row.
3. Captions on every beat, burned in and in the `.vtt`.
4. `ffprobe`: 1080x1080, 30 fps, h264 yuv420p, 42.67 s.
5. There is no narration and no audio track to measure, so no loudness pass.
6. Accent `#58a6ff`, blue.

## Suggested LinkedIn caption

In `cite-add-adopts-1x1.post.txt`. Do not post; hand over.
