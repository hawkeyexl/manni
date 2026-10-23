# Demo beat sheet for cite findings that name their readers (proposal 0105)

- **Type:** feature demo, terminal session. No narration; captions only
  (LinkedIn autoplays muted).
- **Audience:** Docs engineers who pin sentences to source with `manni cite`,
  and CI engineers who read its annotations. Phone-sized, muted.
- **Target:** 34 s, four beats, one caption line each.
- **Objective:** the viewer sees that a stale citation now says whom it fails.
  The annotation names the page's persona and journey. The pretty report rolls
  every finding up by reader.
- **Assets:** `media/cite-impact/cite-impact-1x1.mp4` (not committed),
  `.thumb.png`, `.vtt`, `.srt`, `.transcript.txt`, `.post.txt`, this file, and
  the capture sources beside it. In `media/remotion/`, the files are
  `src/cite-impact/`, `scripts/{captures,vtt,transcript}-cite-impact.*` and the
  `CiteImpactDemo` composition in `src/Root.tsx`. No GIF and no storyboard.
  The brief asked for neither, and one shot type, a terminal, needs no plan
  beyond this table.
- **Look:** `docs/content-strategy/design.md`. 1080×1080, 30 fps, title band
  112 px with an `n / 4` counter, caption band 86 px, accent `#58a6ff` blue.
  Never red, green, yellow or cyan. The frame already holds a green `✓`, a red
  `✗`, a cyan pin id, and git's red and green diff lines.
- **Material.** `test/fixtures/cite/impact/`, staged by `capture.sh` into
  `media/scratch-cite-impact/` (gitignored by `media/scratch-*/`). The scratch
  copy is its own git repository, since cite reads the pinned commit. It holds
  a persona `maya`, journeys `m5` and `m6`, `src/value.ts`, and two pages. Both
  pages cite line 1 of `src/value.ts`. The guide's sidecar names `maya` and
  `m5`, and the config page's sidecar names `maya` and `m6`. The script lists
  the edits it makes to the fixture input. Everything shown is real execution.

| # | Time | Title band | Caption band | Typed | On screen |
|---|---|---|---|---|---|
| 1 | 0:00–0:08 | The page names its readers | The guide's sidecar names persona maya and journey m5. | `cat pages/guide.meta.yaml`, then `manni cite check` | `personas: [maya]` and `journeys: [m5]`; both pins `current`; `5 files checked, 5 passed, 0 failed, 0 findings` in green |
| 2 | 0:08–0:14 | One source line changes | Both pages pin this line, so both pins go stale. | `git diff src/value.ts` | `-export const TIMEOUT_SECONDS = 10;` red, `+… = 30;` green |
| 3 | 0:14–0:25 | manni cite check -f github | The annotation now names maya and m5. Exit 1. | `manni cite check -f github pages/guide.md`, then `echo $?` | one `::error` annotation for `source-changed`, which ends `Serves maya (Maya, Documentation Engineer) and m5 (Pin a claim and catch it going stale).` before the rule and Guide lines; `1` |
| 4 | 0:25–0:34 | Who the findings reach | Findings rolled up by persona and journey. | `manni cite check -q` | both pages red `✗`, then `The pages with findings serve 1 persona and 2 journeys.` with `maya` at 2 errors on 2 pages, `m5` and `m6` at 1 each; the red summary |

Exact cue times are in `cite-impact-1x1.vtt`, generated from the beats the
composition renders.

## Why this story

A stale citation used to say where it was stale and never for whom. Beat 1
plants the reader before anything breaks. The sidecar names `maya` and `m5`,
and the check is green. Beat 2 is the cause, one number in one source line.
Beat 3 is the payoff for CI. The annotation a pull request shows now ends by
naming the persona and journey, with their titles, and the exit code is
still 1. The run names one page, so the frame holds one annotation and the
names match beat 1. Beat 4 runs the whole set. Two pages fail, and the roll-up
shows the reach. Maya loses two pages, and each journey loses one.

## Capture notes

- **The CLI is this branch's build,** `node dist/cli.js`, typed as `manni`.
  Its `--version` prints 4.20.0, the published version. semantic-release
  bumps it when the feature ships, so no version is claimed on screen.
- **Colour.** `media/capture/tty.cjs` tells the CLI it writes to a terminal.
  `git diff` gets `-c color.ui=always` for the same reason.
- **The edit is uncommitted,** so cite reports `changed since <sha>, 0 commits`.
  The sha is the scratch repository's one commit. It changes on every capture.
- **Latency is replayed at 1x** (`latency.txt`): check before 503 ms, diff
  82 ms, github 657 ms, pretty 700 ms. Nothing is compressed.
- **Font size is derived per beat, not chosen** (`node cite-impact/cols.mjs`
  from `media/`). Beats 1 and 2 take the series' 32 px, with no wrap. Beat 3's
  annotation is one line of 448 characters. 22 px / 78 columns is the largest
  size that wraps it at spaces, splits no token, and leaves no one-word last
  row. Beat 4 takes 22 px too. Its two guidance lines wrap at a space under
  their own indent, and no row holds one word alone.
- **Ligatures off.** git's `---` header would draw as one rule.
- **The highlight in beat 3 covers the whole annotation.** It is one logical
  line, and the replay marks lines, not spans.

## How to rebuild it

```bash
# from the repo root
npm run build
bash media/cite-impact/capture.sh            # stages media/scratch-cite-impact, captures every byte
cd media && node cite-impact/cols.mjs        # re-derive the font sizes, per beat

cd remotion
npm ci
node scripts/captures-cite-impact.mjs        # captures -> src/cite-impact/captures.json
npx remotion render CiteImpactDemo ../cite-impact/raw.mp4
# the render has no audio stream; design.md's container carries AAC 48 kHz, so add a silent one
ffmpeg -i ../cite-impact/raw.mp4 -f lavfi -i anullsrc=r=48000:cl=stereo -c:v copy -c:a aac \
  -shortest -movflags +faststart ../cite-impact/cite-impact-1x1.mp4 && rm ../cite-impact/raw.mp4
npx remotion still CiteImpactDemo ../cite-impact/cite-impact-1x1.thumb.png --frame=1005

# timings for the sidecars come from the same beats the composition uses
npx tsc --ignoreConfig src/cite-impact/beats.ts src/beats.ts --outDir scripts/out-cite-impact \
  --module commonjs --target ES2022 --resolveJsonModule --esModuleInterop --skipLibCheck
cd scripts && node vtt-cite-impact.cjs && node transcript-cite-impact.cjs
```

Thumbnail (`.thumb.png`): frame 1005, the end of beat 4. Both failing pages
and the marked roll-up are in view. That is the feature in one frame.

## Checks before shipping (design.md)

1. Longest lines measured per beat by `cols.mjs`, and checked in rendered
   stills of every beat.
2. No text touches the frame edge, and no token is split.
3. Captions on every beat, one line each, burned in and in the `.vtt` and
   `.srt`.
4. `ffprobe`: 1080×1080, 30 fps, h264 yuv420p, AAC 48 kHz, 33.63 s.
5. The audio track is silent by construction (`anullsrc`). There is no
   narration, so no loudness pass.
6. Accent `#58a6ff`, blue.

## Suggested LinkedIn caption

Also in `cite-impact-1x1.post.txt`. Post it only after the release that ships
the feature, since the install line needs it. Do not post; hand it over.

```text
A source change stales a sentence in the docs. CI says which file. It never said who reads it.

New in manni, a citation finding names the readers of its page.

Your pages already list their personas and journeys. When manni cite check finds a stale pin on such a page, each annotation ends by naming them, with their titles.

Here one line of code changes, and two pinned sentences go stale. The CI annotation says the guide serves maya and journey m5. Exit 1, as before.

The plain report then rolls every finding up by persona and journey, worst first. One edit, two pages, one persona, two journeys.

No flag and no config. A page that names no record prints what it always did.

Real output from a real test fixture. Only the input is staged.

npm i -g @hawkeyexl/manni · manni cite check
```
