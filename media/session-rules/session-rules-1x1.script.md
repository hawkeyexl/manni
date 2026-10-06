# Demo beat sheet for `manni tracevals check`, held to what the session was asked

- **Type:** feature demo, terminal session. No narration; captions only
  (LinkedIn autoplays muted).
- **Feature:** proposal 0080. The per-turn check (0079) now also reads what
  the session was asked: the prompts the user typed, an approved plan, and the
  Spec Kit, Kiro, OpenSpec and plans files the session touched.
- **Audience:** engineers who let an agent work from prompts, plans and specs,
  and want "done" to mean done. Phone-sized, muted.
- **Target:** 39.4 s, four beats, one caption each.
- **Objective:** the viewer sees two prompts, the second a constraint. The
  agent edits the file it was told not to, and says done. `manni tracevals
  check` names the broken request under its source, `prompt`, with exit 1.
  Then the same run's sources: the prompts, the plan and every touched spec.
- **Assets:** `media/session-rules/session-rules-1x1.mp4` (not committed),
  `.thumb.png`, `.vtt`, `.transcript.txt`, `.post.txt`, this file,
  `media/session-rules/capture/`, and `media/remotion/src/session-rules/`.
- **Look:** `docs/content-strategy/design.md`. 1080×1080, 30 fps, title band
  112 px with `n / 4` counter, caption band 86 px, accent `#58a6ff` blue.
  Never red, green, yellow or cyan. The report's red `✖` shares the frame in
  beat 3.
- **Material.** The committed fixture `test/tracevals/fixtures/conformance/`,
  unchanged: its `requests/` project plus the `traces/requests.jsonl` session,
  copied into `media/scratch-session-rules/`. This is the command
  `test/tracevals/integration/conformance.test.ts` runs ("what the session was
  asked"). Nothing adds output. Everything on screen is real execution of the
  built `dist/cli.js`.
- **Judge: mock.** The fixture's `manni.config.yaml` sets `provider: mock`, as
  `media/conformance/` did, so rules are extracted and judged offline and
  deterministically, as CI runs them. No model judged the filmed run.

| # | Time | Title band | Caption band | Typed | On screen |
|---|---|---|---|---|---|
| 1 | 0:00–0:07 | What you asked | Two prompts. The second: do not edit src/legacy.ts. | `grep human requests.jsonl \| grep -o '"content":"[^"]*"'` | both prompts, the constraint marked |
| 2 | 0:07–0:18 | The agent said it was done | It edited src/legacy.ts anyway, then said done. | `grep -o '"Edit","input":{"file_path":"[^"]*"' requests.jsonl`, `tail -1 requests.jsonl \| grep -o '"text":"[^"]*"'`, on beat 1's screen | edits to `specs/001-login/tasks.md` and `src/legacy.ts`, then `Done. The reset flow is in.`; the second edit and the claim marked |
| 3 | 0:18–0:29 | Hold it to what it was asked | The broken request, under its source: prompt. Exit 1. | `manni tracevals check requests.jsonl --project .`, `echo $?` | `prompt` with `✖ do-not-edit-src-legacy`, `14 rules from 10 sources. 1 broken.`, `1` |
| 4 | 0:29–0:39 | Every source it was asked by | Prompts, the approved plan, and every spec it touched. | `manni tracevals check requests.jsonl --project . -f json \| grep '"path"'` | ten source paths; all but `CLAUDE.md` marked |

## Why this story

The brief's story was "the agent said it was done", then the check, then the
result naming `prompt` and `specs/001-login/tasks.md`. The filmed run names
only `prompt`. The mock judge reads a rule's first code span. A prohibition is
broken when the turn shows that span. T014, "Write the reset-password test.",
has no code span, so the mock judges it followed. Producing that second
finding takes a model judge. A local one was tried (`--local`) and stopped,
because its model (`qwen3.5-9b`) is not downloaded here, and downloading it was
out of scope. No output was faked, so the video makes no claim about T014.

`specs/001-login/tasks.md` is still on screen twice, as truth. Beat 2 shows the
agent edited it, and beat 4 lists it as a source the turn is held to. Captions
claim neither a tick nor a catch.

Beat 4 runs the check a second time, as `-f json`, to show what 0080 adds:
every row after `CLAUDE.md`. The pipeline's exit is not echoed there, because
beat 3 already carries the exit code.

## Capture notes

- **Font size is derived, not chosen** (`node session-rules/capture/cols.mjs`).
  The longest line is the finding's dim score line, at 92 characters. It wraps
  at a space at any size. 27 px gives 64 columns, the largest size with no
  orphaned word. Beat 4's typed command wraps once, after `|`. The tallest
  screen, beat 4, is 13 rows, 494 px against 838 px of terminal.
- `capture.sh` stages the scratch project and an empty scratch home at
  `media/scratch-session-rules/` and `media/scratch-session-rules-home/`.
  `.gitignore` covers `media/scratch-*/`. `HOME`, `USERPROFILE` and
  `CLAUDE_CONFIG_DIR` point at the empty home, as the tests do, so no user's
  own CLAUDE.md is read. The script refuses to touch a directory it did not
  stage.
- `--project .` is typed because the fixture trace records its `cwd` as
  `/conformance-demo`, which does not exist here.
- Measured latency, the capture run plus three timing runs
  (`capture/latency.txt`): `tracevals check` 401–427 ms, the JSON run 378–393
  ms. The replay uses about the median, so nothing is sped up.
- `manni` is `node -r media/capture/tty.cjs dist/cli.js`, which only tells the
  CLI that stdout is a terminal so colour is emitted. Staged input, real output.
  Version in `capture/version.txt`, build commit in `capture/build-commit.txt`.
- The audio track is silent AAC (−91 dB measured), as in the earlier videos.
  There is nothing to loudness-normalise.

## How to rebuild it

```bash
# from the repo root
npm run build
cd media
bash session-rules/capture/capture.sh          # stages scratch-session-rules/, captures every byte
node session-rules/capture/cols.mjs 27         # re-derive the font size

cd remotion
npm ci
node scripts/captures-session-rules.mjs        # captures -> src/session-rules/captures.json
npx remotion render SessionRulesDemo ../session-rules/session-rules-1x1.mp4
npx remotion still SessionRulesDemo ../session-rules/session-rules-1x1.thumb.png --frame=875

# timings for the sidecars come from the same beats the composition uses
npx tsc src/session-rules/beats.ts src/beats.ts --outDir scripts/out-session-rules \
  --module commonjs --target ES2022 --moduleResolution node \
  --resolveJsonModule --esModuleInterop --skipLibCheck
cd scripts && node vtt-session-rules.cjs && node transcript-session-rules.cjs

rm -rf ../../scratch-session-rules ../../scratch-session-rules-home   # disposable
```

Thumbnail (`.thumb.png`): frame 875, the end of beat 3. The `✖` row is marked
under `prompt`, with `1` under `echo $?`.

## Suggested LinkedIn caption (do not post; hand over)

See `session-rules-1x1.post.txt`.
