# Demo beat sheet for `manni test run`

- **Type:** feature demo, terminal session. No narration; captions only
  (LinkedIn autoplays muted).
- **Audience:** docs engineers who already keep Doc Detective tests inline in
  their pages, and the CI engineers who gate on them. Phone-sized, muted.
- **Target:** 41 s, four beats, one caption each.
- **Objective:** the viewer sees that a page's own test now reports in manni's
  contract. `manni test run` names the file, the line of the failing step and
  Doc Detective's reason, and exits 1. `-f github` turns the same failure into
  an annotation. Fix the page and the same command exits 0.
- **Assets:** `media/test-run-1x1.mp4` (not committed), `.gif`, `.thumb.png`,
  `.vtt`, `.transcript.txt`, `.post.txt`, this file, `media/capture-test/`,
  and `media/remotion/src/test/`.
- **Look:** `docs/content-strategy/design.md`. 1080×1080, 30 fps, title band
  112 px with `n / 4` counter, caption band 86 px, accent `#58a6ff` blue.
  Never red / green / yellow / cyan: the report's own `FAIL` is red in the
  frame, directly under the accent title.
- **Material:** `test/test/fixtures/fail.md`, copied byte for byte into
  `media/scratch-test/` (gitignored). Its one inline step is a `runShell` of
  `exit 1` that expects exit code `0`. Beat 4 edits the copy with `sed`, on
  screen. Everything shown is real execution of the built `dist/cli.js` with
  Doc Detective 4.26 on `PATH`.

| # | Time | Title band | Caption band | Typed | On screen |
|---|---|---|---|---|---|
| 1 | 0:00–0:06 | A page that tests itself | fail.md carries an inline Doc Detective test. Its step runs exit 1 and expects 0. | `cat fail.md` | the page; the step on line 4 is marked |
| 2 | 0:06–0:18 | Run the page | manni test run names the file, line 4 and Doc Detective's reason. Exit 1. | `time manni test run fail.md --no-progress`, then `echo $?` | `fail.md`, `4  FAIL  Returned exit code 1. Expected one of [0]`, `1 test: 0 passed, 1 failed, 0 warnings, 0 skipped`, `real 0m7.765s`, `1` |
| 3 | 0:18–0:27 | Annotations for CI | With -f github, the same failure is an annotation on fail.md, line 4. | `time manni test run fail.md -f github --no-progress` | `::error file=fail.md,line=4,title=Doc Detective::Returned exit code 1. Expected one of [0]`, the summary, `real 0m8.013s` |
| 4 | 0:27–0:41 | Fix the page, rerun | Correct line 4 and rerun. One test passed, exit 0. | `sed -i 's/exit 1/exit 0/' fail.md`, `time manni test run fail.md --no-progress`, `echo $?` | `1 test: 1 passed, 0 failed, 0 warnings, 0 skipped`, `real 0m7.802s`, `0` |

## Why this story

Doc Detective already runs the test. What the feature adds is the contract
around it: the same file:line, exit codes and CI format every other `manni`
domain speaks. So beat 1 shows the test inside the page, where the line number
in beat 2 comes from. Beat 3 is the CI form of the same failure, which is what
most viewers will run. Beat 4 exists because a gate is a red line that can go
green, and the exit code is what CI reads.

The page is the fixture the test suite runs, not a staged prop. `exit 1` stands
in for "the documented command is wrong" without needing a network or an app.

## Capture notes

- **`--no-progress` is typed, not hidden.** On a terminal, `manni test run`
  streams Doc Detective's own log to stderr by default. For this one page that
  log is about 78 KB, ahead of the report. Most of it is schema strict-mode
  warnings from Doc Detective's validator. `--no-progress` is what a person
  types to get the report alone, so it is what the frame shows.
- **The wait is compressed, and the real time is on screen.** Each run takes
  7.8 to 8.0 s (`capture-test/latency.txt`), nearly all of it Doc Detective
  starting. The replay shortens all three waits by the same factor, 1/4, to
  about 2 s. Typing and output are 1×. bash's own `time` output is in frame,
  unedited, for every run, which is the disclosure design.md asks for. The
  `user 0m0.000s` lines are what Git Bash on Windows reports for a native
  child process; they are left as captured.
- **Font size is derived, not chosen** (`node capture-test/cols.mjs 27`). The
  longest line is the GitHub annotation at 90 characters, which breaks at a
  space. The line that must not break is the page's step, at 64 characters:
  `<!-- step {"runShell":{"command":"exit 1","exitCodes":[0]}} -->`. 27 px gives
  64 columns, so the step stays on one row, checked in the rendered still. 28 px
  orphans the closing `-->` onto a row of its own.
- **Ligatures off.** JetBrains Mono would draw the page's `<!--` and `-->` and
  the annotation's `::` as glyphs no terminal prints.
- `manni` is `node -r media/capture/tty.cjs dist/cli.js`, which only tells the
  CLI that stdout and stderr are a terminal, so colour is emitted. Staged
  input, real output.

## How to rebuild it

```bash
# from the repo root, with doc-detective on PATH
npm run build
bash media/capture-test/capture.sh        # stages media/scratch-test, captures every byte
cd media && node capture-test/cols.mjs 27  # re-derive the font size

cd remotion
npm ci
node scripts/captures-test.mjs             # captures -> src/test/captures.json
npx remotion render TestRunDemo ../test-run-1x1.mp4
npx remotion still TestRunDemo ../test-run-1x1.thumb.png --frame=530

# timings for the sidecars come from the same beats the composition uses
npx tsc src/test/beats.ts src/beats.ts --outDir scripts/out-test \
  --module commonjs --target ES2022 --moduleResolution node \
  --resolveJsonModule --esModuleInterop --skipLibCheck
cd scripts && node vtt-test.cjs && node transcript-test.cjs

# GIF, for hosts that will not take an MP4
cd ../.. && ffmpeg -i test-run-1x1.mp4 -vf "fps=12,scale=540:540:flags=lanczos,split[a][b];[a]palettegen=max_colors=128:stats_mode=diff[p];[b][p]paletteuse=dither=none:diff_mode=rectangle" test-run-1x1.gif
```

Thumbnail (`.thumb.png`): frame 530, the end of beat 2, with the `FAIL` row
marked and `1` below the prompt. The failure is the hook; the green run is the
payoff and belongs inside the video.

## Suggested LinkedIn caption

In `test-run-1x1.post.txt`. Do not post; hand over.
