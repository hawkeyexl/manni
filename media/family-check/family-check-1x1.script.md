# Demo beat sheet for `manni check` and `manni status`

- **Type:** feature demo, terminal session. No narration; captions only
  (LinkedIn autoplays muted).
- **Audience:** CI engineers and docs engineers who gate a docs repository on
  several manni tools, and anyone letting an agent edit those docs.
  Phone-sized, muted.
- **Target:** 41.7 s, four beats, one caption each.
- **Objective:** the viewer sees that one command runs every check a repository
  has set up, and only those. `manni status` names what is in play. `manni check`
  fails on a real error with exit 1 and lists the rest as skipped, not failed.
  The same command under a Claude Code hook exits 2, which blocks the agent.
  After the fix it passes with exit 0.
- **Assets:** `media/family-check/family-check-1x1.mp4` (not committed),
  `.gif`, `.thumb.png`, `.vtt`, `.transcript.txt`, this file,
  `media/family-check/capture/`, `media/family-check/repo/`, and
  `media/remotion/src/family-check/`.
- **Look:** `docs/content-strategy/design.md`. 1080×1080, 30 fps, title band
  112 px with `n / 4` counter, caption band 86 px, accent `#58a6ff` blue.
  Never red, green, yellow or cyan. The report's own `✗`, its red and green
  summary lines, and the cyan `(root)` field use those in the same frame.
- **Material.** The demo repository is `test/family/fixtures/only-citations/`,
  whose one page cites `src/limits.ts`. It adds a `meta:` section with one
  house schema that requires `title` and `description`, and a second page that
  passes it. `meta.defaults: false` keeps the built-in default schemas
  out, so the only error is the one the story is about. `hook-edit.json` is the
  `PostToolUse` envelope Claude Code sends after an `Edit`, cut to the three
  fields `manni check` reads. Nothing adds output. Everything on screen is real
  execution of the built `dist/cli.js`.

| # | Time | Title band | Caption band | Typed | On screen |
|---|---|---|---|---|---|
| 1 | 0:00–0:07 | What this repo set up | manni status reads the config and the pages. Two checks are in play here. | `manni status` | `meta` and `cite` in play (marked), four domains not set up with the reason, `a11y` and `tracevals` not checked |
| 2 | 0:07–0:17 | One command runs them | A page has no description, so exit 1. What was never set up is skipped. | `manni check`, then `echo $?` | `meta validate` fails `docs/limits.md` on `description`, `cite check` passes, four `skipped` lines with reasons, `1 failed, 4 skipped`, `1` |
| 3 | 0:17–0:29 | The same check, as a hook | Claude Code sends this after an agent's edit. Exit 2 blocks the agent. | `cat hook-edit.json`, `manni check < hook-edit.json`, `echo $?` | the envelope, then `manni found errors in docs/limits.md. Fix them before you continue.` and the per-file report for that one page, `2` |
| 4 | 0:29–0:42 | Fix the page, pass the gate | Add the field. Every check in play passes, exit 0. | `sed -i '2a description: Timeouts and retries.' docs/limits.md`, `manni check`, `echo $?` | both checks green, the same four `skipped` lines, `0 failed, 4 skipped`, `0` |

## Why this story

The feature is not "a wrapper that runs every tool". It is that the gate follows
what the repository set up. Beat 1 shows that list before anything runs, so the
skipped lines in beat 2 read as an answer rather than as noise. A domain nobody
set up is skipped with its reason and never fails the run.

Beat 3 is the reason the command exists in this shape. The plugin's hook is the
same `manni check`, fed the envelope Claude Code writes on stdin. Typing the
envelope by hand is the honest way to show a hook in a terminal. The file is on
screen, and the exit code that blocks the agent is printed by `echo $?`. The
hook's report has no colour, because it writes for the agent, and the frame
shows that as it is.

Beat 4 closes the loop with exit 0. A red line on its own is a complaint; a gate
is a red line that can go green.

## Capture notes

- **Font size is derived, not chosen** (`node family-check/capture/cols.mjs`).
  The longest real line is the `meta validate` error at 93 characters, and the
  longest unbreakable token with its indent is 32 characters. 25 px gives 69
  columns. That is the largest size at which the status table's widest row
  (`a11y … against a running site`, 68 characters) fits on one row. The error
  breaks at a space before its `[./schemas/page.schema.json]` tag, and no token
  is split. The tallest beat, beat 3, is 23 rows, 805 px against 838 px of
  terminal.
- The fix text is `Timeouts and retries.` rather than a longer sentence, so the
  typed `sed` line is 60 columns and does not wrap.
- The demo repository is staged at `media/scratch-family-check/`, with its own
  `git init` and one commit. `.gitignore` covers `media/scratch-*/`.
  `manni check` prints repo-relative paths, so the location costs no width.
  `capture.sh` rebuilds it, and refuses to touch a directory that is not one of
  its own.
- Measured latency, the capture run plus three timing runs
  (`capture/latency.txt`): `status` 1159–1190 ms, `check` 1274–1314 ms, the hook
  run 1160–1193 ms. The replay uses the median, so nothing is sped up. An
  earlier run on a loaded machine measured about 3 s per command. That run was
  discarded along with its capture, not compressed.
- `manni` is `node -r media/capture/tty.cjs dist/cli.js`, which only tells the
  CLI that stdout is a terminal so colour is emitted. Staged input, real output.
  The version line reads `4.3.0` because that is what this checkout's
  `package.json` says (`capture/version.txt`, build commit in
  `capture/build-commit.txt`).
- The audio track is silent AAC, as in the earlier videos. There is nothing to
  loudness-normalise.

## How to rebuild it

```bash
# from the repo root
npm run build
cd media
bash family-check/capture/capture.sh          # stages scratch-family-check/, captures every byte
node family-check/capture/cols.mjs 25         # re-derive the font size

cd remotion
npm ci
node scripts/captures-family-check.mjs        # captures -> src/family-check/captures.json
npx remotion render FamilyCheckDemo ../family-check/family-check-1x1.mp4
npx remotion still FamilyCheckDemo ../family-check/family-check-1x1.thumb.png --frame=495

# timings for the sidecars come from the same beats the composition uses
npx tsc src/family-check/beats.ts src/beats.ts --outDir scripts/out-family-check \
  --module commonjs --target ES2022 --moduleResolution node \
  --resolveJsonModule --esModuleInterop --skipLibCheck
cd scripts && node vtt-family-check.cjs && node transcript-family-check.cjs

# GIF, for hosts that will not take an MP4
cd ../../family-check && ffmpeg -i family-check-1x1.mp4 -vf "fps=12,scale=540:540:flags=lanczos,split[a][b];[a]palettegen=max_colors=128:stats_mode=diff[p];[b][p]paletteuse=dither=none:diff_mode=rectangle" family-check-1x1.gif

rm -rf ../scratch-family-check                # the staged repo is disposable
```

Thumbnail (`.thumb.png`): frame 495, the end of beat 2. The missing
`description` and the four skipped lines are marked, with `1` under `echo $?`.

## Suggested LinkedIn caption (do not post; hand over)

See `family-check-1x1.post.txt`.
