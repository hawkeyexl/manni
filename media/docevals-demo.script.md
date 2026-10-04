# Video script for docevals (`manni docevals run`)

**Objective:** Show that a documentation page can carry its own checks. An
eval lives in the page's frontmatter. `manni docevals run` grades the page
against it, and fails the build when the page drifts.
**Format:** 1080x1080, 30 fps, silent, captions burned in (LinkedIn autoplays muted).
**Duration:** 33.7 s (spec: 20-45 s).
**Audience:** docs engineers who own the pages (Maya) and CI engineers who own
the gate (Devin).
**Feature:** proposal 0048, `docs/proposals/0048-docevals-domain.md`.

Visual spec: `docs/content-strategy/design.md`. Accent `#58a6ff` (blue). Never
red, green, yellow or cyan, which manni's own output uses. `FAIL`, `error` and
`below target` are red, `pass` and `ok` are green, the rule id dim. Terminal
`#171717`, bands `#0d0d0d`, JetBrains Mono throughout. Title band 112 px, 2 px
accent rules, caption band 86 px.

## How it was made, and what is staged

Everything printed in the terminal is a real run of `cat`, `sed`, `tail` or
the built CLI. The typed command reads `manni`, the name the shim
`media/bin/manni` gives `dist/cli.js`.

- **VHS captures, not an ANSI replay.** The other videos in `media/` replay
  captured bytes through the shared Remotion project. This one films three
  real terminal sessions with VHS, one per beat, and composites the resulting
  videos. The tapes are `media/capture-docevals/beat1.tape` and its two
  siblings.
- **Each tape starts from the same broken page.** The hidden preamble copies
  `media/capture-docevals/install.broken.md` over `docs/install.md`, sets a
  bare prompt, and clears the screen. So every beat runs from the same state,
  and beat 3 can be filmed after beat 2.
- **The demo repository is not committed.** It carried its own `git init`, and
  it held three files: the config in
  `media/capture-docevals/cat-manni.config.yaml.txt`, the passing page in
  `cat-quickstart.md.txt`, and the failing page in `install.broken.md`. Those
  three copies are the record of it.
- **`--deterministic-only` is the point of the demo.** It holds the run to the
  graders that need no model. The regex and freshness graders return the same
  bytes every run, so the film is reproducible and nothing is billed.
- **No row highlight.** The earlier videos tint the rows a caption is about.
  This one films whole sessions, so the bytes move under the tint. The
  captions carry the pointing instead.

## Derived font size

VHS filmed at 1200x980 with `FontSize 28`, which is 69 columns. The longest
real line is the `manni docevals run` command, at 58 characters. The tallest
beat is beat 3, at 16 used rows. The composition crops each capture to the
used 1160x614 and scales it to 1032 px wide, inside an 878 px terminal area.
The typed command ends well inside the frame at phone size.

## Beats (storyboard)

| # | Title (band) | Terminal | Caption (band) | Frames | Time |
|---|---|---|---|---|---|
| 1 | A page with an eval | `cat docs/install.md` | The page's eval says it must name the CLI. | 156 | 0:00.0-0:05.2 |
| 2 | Run the evals | `manni docevals run`, `echo $?` | manni docevals run fails it. Exit code 1. | 294 | 0:05.2-0:15.0 |
| 3 | Fix and rerun | `sed`, `tail -1`, `manni docevals run`, `echo $?` | Fix the line, rerun: all pass. Exit code 0. | 470 | 0:15.0-0:30.7 |
| 4 | manni docevals | End card, no terminal | Evals over your docs pages. | 90 | 0:30.7-0:33.7 |

Each beat starts on a cleared terminal and cuts to the next, with no
transitions. Beat 4 is the end card: the install line and the bare command,
centred, on the same ground.

Thumbnail (`.thumb.png`): frame 915, the end of beat 3, with both `pass` marks
and `0` on screen.

## Real output quoted

Beat 2, `manni docevals run` (exit 1):

```
docs/install.md
  FAIL names-the-cli
       error:1 [regex/not-found] Pattern /manni/ not found in body
docs/quickstart.md
  pass fresh

Suites
  default: 1/2 passed — 50% vs target 100% below target
```

Beat 3, after `sed` rewrites the package name (exit 0):

```
docs/install.md
  pass names-the-cli
docs/quickstart.md
  pass fresh

Suites
  default: 2/2 passed — 100% vs target 100% ok
```

## Timing rules applied

- Typing 50 ms per character, from the tapes' `Set TypingSpeed`. The cursor is
  a solid block and does not blink.
- Output appears after the command's real latency, because VHS films the
  session rather than replaying it. Each tape waits for the prompt with
  `Wait+Line`, then holds.
- Beats run 5.2 s, 9.8 s and 15.7 s. Each holds 2.5 s to 5.0 s after its main
  output, so the caption can be read on it.
- No narration, so no loudness pass. The AAC 48 kHz track is silence.
- Caption cues are one per beat, burned in over one line of about 42
  characters. A cue is a static step title plus caption, not speech, so there
  is nothing to sync against.

## Exact commands, as typed in the video

```bash
cat docs/install.md
manni docevals run --collection site --deterministic-only
echo $?
sed -i 's|docmeta|@hawkeyexl/manni|' docs/install.md
tail -1 docs/install.md
manni docevals run --collection site --deterministic-only
echo $?
```

## Reproduce

The composition is standalone. It registers its own root and reads the three
captures from `public/`, so it never goes through `media/remotion/src/Root.tsx`.
Render it from a directory that holds `src/index.tsx`, the fonts in
`public/fonts/`, and this config:

```ts
import { Config } from "@remotion/cli/config";

Config.setBrowserExecutable("C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe");
Config.setChromeMode("chrome-for-testing");
Config.setVideoImageFormat("png");
Config.setCodec("h264");
Config.setPixelFormat("yuv420p");
Config.setOverwriteOutput(true);
Config.setCachingEnabled(false);
```

```bash
# 0. Build the CLI (repo root)
npm run build

# 1. Build the demo repository: git init, the config and the two pages
#    (media/capture-docevals/cat-manni.config.yaml.txt, cat-quickstart.md.txt
#     and install.broken.md), plus a bin/manni shim onto dist/cli.js

# 2. Film the three beats. Each tape writes its own beat mp4 into public/.
vhs capture-docevals/beat1.tape
vhs capture-docevals/beat2.tape
vhs capture-docevals/beat3.tape

# 3. Render, then add the silent audio track
npx remotion render src/index.tsx DocevalsDemo out/docevals-demo.silent.mp4
ffmpeg -i out/docevals-demo.silent.mp4 -f lavfi -i anullsrc=r=48000:cl=stereo -shortest -c:v copy -c:a aac -b:a 128k -movflags +faststart ../docevals-demo.mp4
```

Stills read back from the finished file are in `media/remotion/out/docevals/`,
at frames 150, 440 and 980. The thumbnail is frame 915. No GIF was made for
this demo.

## Suggested LinkedIn post

The post text is `media/docevals-demo.post.txt`. Posting is the author's call.
