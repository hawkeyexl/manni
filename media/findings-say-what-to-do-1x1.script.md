# Demo beat sheet for findings that say what to do (proposal 0089)

- **Type:** feature demo, terminal session. No narration; captions only
  (LinkedIn autoplays muted).
- **Audience:** docs engineers and the CI engineers who read manni's findings
  when a gate goes red. Phone-sized, muted.
- **Target:** 42 s, four beats, one caption each.
- **Objective:** the viewer sees a finding change from a bare error into
  something they can act on. It names the rule that judged it, says what the
  rule is for and links a guide. The same shape holds in another domain.
- **Assets:** `media/findings-say-what-to-do-1x1.mp4` (not committed), `.gif`,
  `.thumb.png`, `.vtt`, `.transcript.txt`, `.post.txt`, this file,
  `media/capture-findings/`, `media/remotion/src/findings/` and the
  `FindingsDemo` composition in `media/remotion/src/Root.tsx`.
- **Look:** `docs/content-strategy/design.md`. 1080×1080, 30 fps, title band
  112 px with `n / 4` counter, caption band 86 px, accent `#58a6ff` blue.
  Never red, green, yellow or cyan: the frame already holds a red `✗`, red
  summaries and cyan field names.
- **Material.** Two test fixtures are copied byte for byte into
  `media/scratch-findings/` (gitignored), which is its own git repository.
  They are `test/fixtures/vocabulary/dcmi-bad-date.md`, and
  `test/fixtures/cite/pages/source-changed.md` with `src/changed.ts`.
  Everything shown is real execution.

| # | Time | Title band | Caption band | Typed | On screen |
|---|---|---|---|---|---|
| 1 | 0:00–0:13 | Before, in 4.13.0 | June 5th is not a date. 4.13.0 shows a pattern and a wrapper line. | `cat dcmi-bad-date.md`, then `npx -y @hawkeyexl/manni@4.13.0 meta validate dcmi-bad-date.md -s dcmi:elements:1.1 --no-config` | `date: June 5th`; two findings, the pattern and `/date  must match "else" schema`; `2 errors` |
| 2 | 0:13–0:25 | Now it says what to do | One finding. It names the rule, says what date is for and links a guide. | `manni meta validate dcmi-bad-date.md -s dcmi:elements:1.1 --no-config`, then `echo $?` | one finding; dim `dcmi:elements:1.1 date: A point or period of time…` and `Guide: https://hawkeyexl.github.io/manni/meta/reference/schemas/dcmi-elements/`; `1 error`; `1` |
| 3 | 0:25–0:33 | Start from a skeleton | schemas show -f markdown prints frontmatter to start from, every key explained. | `manni meta schemas show manni:core:1.0.0 -f markdown` | the frontmatter skeleton, its `# Guide:` line, `title:` and `description:` required, the rest commented out |
| 4 | 0:33–0:42 | Across the family | cite names its rule too, and the command to run once you have checked. | `manni cite check pages/source-changed.md` | `src/changed.ts:2 changed`; `Check the sentence against the source, then run manni cite update --accept --only fetch-timeout.`; the dim rule and `Guide:` lines |

## Why this story

The feature is a change in what a finding says. The clearest proof is the
same command on the same page, before and after. Beat 1 runs the published
4.13.0 release rather than a caption about it. Its wrapper line
`must match "else" schema` is the noise 0089 removes. Beat 2 is the payoff:
one finding, and under it the rule, its purpose and a guide.

Beat 3 is where an author starts before there is any finding at all. Beat 4
backs the "across the family" claim with a second domain. cite was picked
over graph because it is one command, and its remedy names the exact command
to run next. The page says the timeout is 10 seconds and the source now says
30. That is why the advice to check the sentence first is the point.

## Capture notes

- **The 4.13.0 run is real.** `capture.sh` installs `@hawkeyexl/manni@4.13.0`
  into the scratch repo with `--no-save`, behind a one-line `package.json` of
  its own. npx then runs that exact release. Without the local install, npx on
  this machine resolves a globally linked development checkout instead.
- **After is this branch's build,** `node dist/cli.js`, typed as `manni`. Its
  `--version` still prints 4.13.0, because semantic-release bumps the number
  at release time. So no version is claimed on screen for the after beats.
- **cite needs git.** The cite tests use a fake git client. A reader has a
  real repository, so the scratch directory is one, committed once.
- **Colour.** `media/capture/tty.cjs` tells the CLI it writes to a terminal.
  Under npx, `NODE_OPTIONS` reaches npm's own node too, and npm then crashes
  drawing a spinner into a file. `capture-findings/tty-manni.cjs` applies the
  shim to a `dist/cli.js` process only.
- **Latency is replayed at 1x** (`capture-findings/latency.txt`). Before took
  1403 ms, including npx's own start. After took 338 ms, show 286 ms and cite
  399 ms. Nothing is compressed.
- **Font size is derived, not chosen** (`node capture-findings/cols.mjs 22`).
  22 px gives 78 columns, the largest size that keeps every Guide URL on one
  row. The longest is the meta guide at 72 characters plus a 6-space indent.
  The DCMI date pattern is the one token that cannot fit at any legible
  size, at 110 characters with no space. It hard-breaks, as a terminal would, in both the
  before and after beats. cols.mjs names it as the one exempt token.
- **Ligatures off.** The skeleton's `---` fences would draw as one rule.

## How to rebuild it

```bash
# from the repo root
npm run build
bash media/capture-findings/capture.sh        # stages media/scratch-findings, captures every byte
cd media && node capture-findings/cols.mjs 22  # re-derive the font size

cd remotion
npm ci
node scripts/captures-findings.mjs             # captures -> src/findings/captures.json
npx remotion render FindingsDemo ../findings-say-what-to-do-1x1.mp4
npx remotion still FindingsDemo ../findings-say-what-to-do-1x1.thumb.png --frame=740

# timings for the sidecars come from the same beats the composition uses
npx tsc src/findings/beats.ts src/beats.ts --outDir scripts/out-findings \
  --module commonjs --target ES2022 --moduleResolution node \
  --resolveJsonModule --esModuleInterop --skipLibCheck
cd scripts && node vtt-findings.cjs && node transcript-findings.cjs

# GIF, for hosts that will not take an MP4
cd ../.. && ffmpeg -i findings-say-what-to-do-1x1.mp4 -vf "fps=12,scale=540:540:flags=lanczos,split[a][b];[a]palettegen=max_colors=128:stats_mode=diff[p];[b][p]paletteuse=dither=none:diff_mode=rectangle" findings-say-what-to-do-1x1.gif
```

Thumbnail (`.thumb.png`): frame 740, the end of beat 2, with the rule and
Guide lines marked and `1` below the prompt. That is the feature in one frame.

## Checks before shipping (design.md)

1. Longest line measured: 78 columns at 22 px, checked in the rendered stills.
2. No text touches the frame edge. The one split token is the date pattern,
   named above.
3. Captions on every beat, burned in and in the `.vtt`.
4. `ffprobe`: 1080×1080, 30 fps, h264 yuv420p, AAC 48 kHz, 41.98 s.
5. The finished file's audio measures as a silent track at −91 dB. There
   is no narration, so no loudness pass.
6. Accent `#58a6ff`, blue.

## Suggested LinkedIn caption

In `findings-say-what-to-do-1x1.post.txt`. Do not post; hand over.
