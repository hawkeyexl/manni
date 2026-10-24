# Demo beat sheet for `manni test tasks`

- **Type:** feature demo, terminal session. No narration; captions only
  (LinkedIn autoplays muted).
- **Audience:** docs engineers who own a fix or how-to page, and want to know
  whether a reader can finish the task from it. Phone-sized, muted.
- **Target:** 43.8 s, five beats, one caption each.
- **Objective:** the viewer sees a synthetic user, Claude Code playing a persona
  record, attempt a task written in plain text from one docs page. Its own
  account then finds a real bug in the page. After the page fix, the same
  write-in task is judged on completion and adherence and passes. Kept as a
  journey, the task is a golden test that exits 0.
- **Assets:** `media/test-tasks-1x1.mp4` (not committed), `.gif`, `.thumb.png`,
  `.vtt`, `.transcript.txt`, `.post.txt`, this file, `media/capture-tasks/`,
  and `media/remotion/src/tasks/`.
- **Look:** `docs/content-strategy/design.md`. 1080×1080, 30 fps, title band
  112 px with `n / 5` counter, caption band 86 px, accent `#58a6ff` blue.
  Never red, green, yellow or cyan. Beat 1 has the red `✗` and the cyan
  `(root)` field path in frame, and beat 5 has seven green `PASS` tags.
- **Material.** The dogfood runs of this repository, 2026-10-23. Theo is
  `docs/content-strategy/personas/theo.md`. His repository is
  `test/test/fixtures/tasks/red-pr`. The page is
  `docs/src/content/docs/meta/fix/index.mdx`. The journey is
  `docs/content-strategy/journeys/t1.md`.

| # | Time | Title band | Caption band | Typed | On screen |
|---|---|---|---|---|---|
| 1 | 0:00–0:08 | A red docs check | Theo's pull request is red: install.md has no description. Will the fix page get him through? | `time manni meta validate`, `echo $?` | `✗ docs/install.md`, `(root) must have required property 'description' (line 1) [manni:core:1.0.0]`, `real 0m0.909s`, `1` |
| 2 | 0:08–0:14 | Hand Theo the task | Claude Code plays Theo in a fresh copy of his repo. Real run: 28 s, then 12 min of judging. | `manni test tasks docs/src/content/docs/meta/fix/index.mdx --persona theo --workspace test/test/fixtures/tasks/red-pr --task "…"` (pasted) | `task as theo: starting in a fresh copy…`, six `theo › Read/Bash/Edit …` lines, the judge notice, a cursor while it judges |
| 3 | 0:14–0:21 | Where Theo got stuck | His account flags a docs bug. The error said (line 1), but the page said missing fields have no line number. | (same run; the report prints) | the report's `Account`, scrolling to **What confused me:** and `My error said (line 1), but the docs say a missing required field has no line number`, marked |
| 4 | 0:21–0:30 | Same task, fixed page | A write-in task is judged on completion and adherence: Theo did it, by the docs, within his constraints. | the same command (pasted) | six `theo ›` actions, `7 turns · 0m 37s`, `PASS completed`, `PASS followed-the-docs`, two `PASS constraint` |
| 5 | 0:30–0:44 | Kept as golden journey T1 | After the docs fix, the task runs as journey t1: seven evals pass, exit 0. | `time manni test tasks --journey t1 --provider claude-cli`, `echo $?` | five `theo ›` actions, seven green `PASS`, `1 run: 1 passed`, `real 5m9.767s`, `0` |

## Why this story

The feature's claim is that a page can be tested by a reader, not only by its
commands. A demo of that has to show a reader. So beat 1 is Theo's actual
problem, and the task in beat 2 is that error, pasted into one line of plain
text. Beat 3 is the payoff nobody wrote an eval for. The synthetic user's own
account found a real contradiction in the fix page, and the page was fixed
after this run. Beat 4 is the contract for a write-in task. It is judged on
completion and adherence only: `completed`, `followed-the-docs`, and one
`constraint` per line of Theo's persona, each at a file and line. Beat 5 closes
the loop. The task becomes a journey with `evals:`, so it runs again on every
change, and the exit code is what CI reads.

## Capture notes

- **Three sources, said plainly.** Beats 1 and 5 are re-shot by
  `media/capture-tasks/capture.sh`, colour on, under bash's `time`. Beats 2
  and 3 replay `media/capture-tasks/raw/df1.out.txt` and `df1.err.txt` byte
  for byte. That is the dogfood run that found the bug. It cannot be re-shot.
  After it, the fix page and Theo's persona record were both corrected. A
  re-run reads the fixed page and has nothing to flag. Beat 4 replays
  `raw/theo-fix.out.txt` and `.err.txt`, the same task rerun after the page
  fix with the current build. Both were captured to files, stdout and stderr
  apart, so they have no colour, and neither was under `time`.
- **No eval rows from df1 are on screen.** df1 ran on a build that derived
  evals for a write-in task. The current build does not: a write-in task is
  judged on `completed`, `followed-the-docs` and its persona's constraints.
  So beat 2 ends on the judging wait, before df1's report prints. Beat 3 opens
  on the report's `Account` row and scrolls down through the account only. The
  report's eval rows and its summary stay out of every frame. The bytes are
  unchanged. Beat 4's rows come from the current build.
- **The waits are compressed, and the real times are disclosed.** df1 took
  about 12.6 min (`capture-tasks/df1-timing.txt`, from its run directory's
  mtimes). Of that, 28 s was Claude Code and about 12 min was judging, which
  beat 2's caption states. The replay lands its six actions 0.5 s apart and
  the report 1.5 s after the judge notice. theo-fix's 37 s of Claude Code is in
  its report (`7 turns · 0m 37s`). Its judging time was not recorded: its run
  directory has no file written at the end. The replay lands its actions
  0.33 s apart and its report 1.5 s after the judge notice. Beat 5 took
  `real 5m9.767s` (`capture-tasks/latency.txt`), in frame, unedited. Its
  actions land 0.4 s apart and its report 1.5 s after the last one. Typing and
  output are 1×.
- **The stream order is the terminal's.** On a terminal, the progress lines
  and the judge notice are stderr, printed while the run works. The report is
  stdout, printed once at the end. The df1 and theo-fix files are replayed
  in that order. t1 was captured with both streams in one file, in the order
  they arrived.
- **The long command is pasted.** The beat 2 and 4 command is 279 characters.
  Typed at 38 ms a character it would take 10.6 s, a quarter of the video. It
  lands whole, as a paste does (`paste: true` in `src/tasks/beats.ts`). The
  short commands are typed.
- **The reports scroll.** They print more rows than the frame holds. Beats 3
  and 5 scroll the same bytes to the rows the caption is about (`scroll:` in
  `src/tasks/beats.ts`). A row cut by the terminal's edge is not drawn.
  Beat 4 holds on its first rows. Nothing is cut from the output.
- **`--provider claude-cli` is typed in beat 5,** because beat 5 was run with
  it, which pins the judge. The df1 and theo-fix runs had no `--provider`, so
  their stderr carries the auto-select notice, left in.
- **Font size is derived, not chosen** (`node capture-tasks/cols.mjs`). The
  widest unbreakable token is beat 1's Guide URL, 74 columns with its indent,
  which rules out 24 px and up. 21 px gives 82 columns. The account is wrapped
  at 78 by the report itself, so it never re-wraps.
- **Ligatures off.** The account's ` ``` ` and `---`, and the progress lines'
  `&&`, are characters in a terminal.
- **Beat 5's temp path is neutral.** The run's workspace lives under
  `os.tmpdir()`. When the synthetic user's commands name it, the progress
  lines print it. `capture.sh` sets `TEMP`, `TMP` and `TMPDIR` to `C:\tmp` for
  that run, so such a path reads `C:/tmp/manni-task-…`, with no user name.
  This take's commands ran with relative paths and print none.
- `manni` is `node -r media/capture/tty.cjs dist/cli.js`, which only tells the
  CLI that stdout and stderr are a terminal, so colour and the progress stream
  are emitted. Staged input, real output.
- **Silent.** The MP4 carries Remotion's silent AAC track. Measured on the
  finished file: -inf LUFS, -inf dBTP, so there is nothing to normalise.

## How to rebuild it

```bash
# from the repo root, with Claude Code on PATH and signed in
npm run build
bash media/capture-tasks/capture.sh       # beats 1 and 5; `red` or `t1` re-shoots one
cd media && node capture-tasks/cols.mjs   # re-derive the font size

cd remotion
npm ci
node scripts/captures-tasks.mjs           # captures -> src/tasks/captures.json
npx remotion render TestTasksDemo ../test-tasks-1x1.mp4
npx remotion still TestTasksDemo ../test-tasks-1x1.thumb.png --frame=1160

# timings for the sidecars come from the same beats the composition uses
npx tsc src/tasks/beats.ts src/beats.ts --outDir scripts/out-tasks \
  --module commonjs --target ES2022 --moduleResolution node \
  --resolveJsonModule --esModuleInterop --skipLibCheck
cd scripts && node vtt-tasks.cjs && node transcript-tasks.cjs

# GIF, for hosts that will not take an MP4
cd ../.. && ffmpeg -i test-tasks-1x1.mp4 -vf "fps=12,scale=540:540:flags=lanczos,split[a][b];[a]palettegen=max_colors=128:stats_mode=diff[p];[b][p]paletteuse=dither=none:diff_mode=rectangle" test-tasks-1x1.gif
```

Thumbnail (`.thumb.png`): frame 1160, in beat 5. It shows the golden run's
seven green `PASS` rows, marked, under `time manni test tasks --journey t1`.

## Suggested LinkedIn caption

In `test-tasks-1x1.post.txt`. Do not post; hand over.
