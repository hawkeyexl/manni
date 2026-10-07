# Demo beat sheet for `manni tracevals check`, held to the system prompt it ran under

- **Type:** feature demo, terminal session. No narration; captions only
  (LinkedIn autoplays muted).
- **Feature:** proposal 0081. The per-turn check now reads the system prompt a
  Claude Code session ran under, from the snapshot the transcript records.
  Rules from Claude Code's default prompt are reported and never block. A
  prompt the user wrote blocks like any rule. That covers a replaced
  `--system-prompt` and a user output style.
- **Audience:** engineers who run Claude Code with a prompt or output style of
  their own, and want it held to. Phone-sized, muted.
- **Target:** 41.1 s, three beats, one caption each.
- **Objective.** The viewer sees the recorded prompt ban an unshown `Tests
  pass`, and the agent say it. On the default prompt, `check` marks the break
  `!` and exits 0. On a replaced prompt, the same break is `✖` and exits 1.
- **Assets:** `media/system-prompt/system-prompt-1x1.mp4` (not committed),
  `.thumb.png`, `.vtt`, `.transcript.txt`, `.post.txt`, this file,
  `media/system-prompt/capture/`, and `media/remotion/src/system-prompt/`.
- **Look:** `docs/content-strategy/design.md`. 1080×1080, 30 fps, title band
  112 px with `n / 3` counter, caption band 86 px, accent `#58a6ff` blue.
  Never red, green, yellow or cyan. The report's yellow `!` shares the frame in
  beat 2, and its red `✖` in beat 3.
- **Material.** The committed fixture `test/tracevals/fixtures/conformance/`,
  unchanged. Its `project/` directory and the `traces/system-prompt.jsonl` and
  `traces/system-prompt-custom.jsonl` sessions are copied into
  `media/scratch-system-prompt/`. These are the runs
  `test/tracevals/integration/conformance.test.ts` makes ("the system prompt
  the session ran under"). Nothing adds output. Everything on screen is real
  execution of the built `dist/cli.js`.
- **The judge is the mock.** The fixture's `manni.config.yaml` sets `provider:
  mock`, as `media/conformance/` and `media/session-rules/` did. Rules are
  extracted and judged offline and deterministically, as CI runs them. No model
  judged the filmed run.

| # | Time | Title band | Caption band | Typed | On screen |
|---|---|---|---|---|---|
| 1 | 0:00–0:12 | The prompt it ran under | It bans an unshown Tests pass. The agent claims one. | `grep -o '"systemPrompt":[^]]*' system-prompt.jsonl \| head -1`, `tail -1 system-prompt.jsonl \| grep -o '"text":"[^"]*"'` | the recorded prompt with its boundary marker, then `Tests pass, and the branch is pushed.`; both marked |
| 2 | 0:12–0:24 | Claude Code's default prompt | Its break is reported with !, not blocked. Exit 0. | `manni tracevals check system-prompt.jsonl --project .`, `echo $?` | `! never-say-tests-pass-without`, `None broken, 1 reported.`, `0` |
| 3 | 0:24–0:41 | A prompt you wrote | No default marker. Its break blocks with ✖. Exit 1. | the same `grep` on `system-prompt-custom.jsonl`, then its `check`, `echo $?` | the prompt with no marker, `✖ never-say-tests-pass-without`, `1 broken.`, `1` |

## Why this story

The two traces are the same session with a different recorded prompt. The
default one carries Claude Code's `__SYSTEM_PROMPT_DYNAMIC_BOUNDARY__` marker.
The custom one has none, which is how a prompt replaced with `--system-prompt`
lands. That marker is the whole test, so beat 3 shows the custom prompt before
its check. The viewer can see it is gone.

The mock judge reads a rule's first code span. The turn shows `Tests pass`, so
the rule is judged broken in both runs. The video claims only that, and the
same finding changes severity with the prompt.

A user output style is the other kind of custom prompt. No committed trace
carries one, so the video does not show it, and the captions make no claim
about it.

## Capture notes

- **Font size is derived, not chosen** (`node system-prompt/capture/cols.mjs`).
  The longest line is beat 1's recorded prompt, at 194 characters. It wraps at
  a space at any size. 24 px gives 72 columns, the largest size with no
  orphaned word. Both closing lines fit on one row there. The tallest screen,
  beat 3, is 14 rows, 476 px against 838 px of terminal.
- `capture.sh` stages the scratch project and an empty scratch home at
  `media/scratch-system-prompt/` and `media/scratch-system-prompt-home/`.
  `.gitignore` covers `media/scratch-*/`. `HOME`, `USERPROFILE` and
  `CLAUDE_CONFIG_DIR` point at the empty home, as the tests do, so no user's
  own CLAUDE.md is read. The script refuses to touch a directory it did not
  stage.
- `--project .` is typed because the fixture traces record their `cwd` as
  `/conformance-demo`, which does not exist here.
- Measured latency, the capture run plus three timing runs
  (`capture/latency.txt`): the default-prompt check 396–412 ms cold, the custom
  one 382–405 ms after it. The replay uses 400 ms, so nothing is sped up.
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
bash system-prompt/capture/capture.sh          # stages scratch-system-prompt/, captures every byte
node system-prompt/capture/cols.mjs 24         # re-derive the font size

cd remotion
npm ci
node scripts/captures-system-prompt.mjs        # captures -> src/system-prompt/captures.json
npx remotion render SystemPromptDemo ../system-prompt/system-prompt-1x1.mp4
npx remotion still SystemPromptDemo ../system-prompt/system-prompt-1x1.thumb.png --frame=1228

# timings for the sidecars come from the same beats the composition uses
npx tsc src/system-prompt/beats.ts src/beats.ts --outDir scripts/out-system-prompt \
  --module commonjs --target ES2022 --moduleResolution node \
  --resolveJsonModule --esModuleInterop --skipLibCheck
cd scripts && node vtt-system-prompt.cjs && node transcript-system-prompt.cjs

rm -rf ../../scratch-system-prompt ../../scratch-system-prompt-home   # disposable
```

Thumbnail (`.thumb.png`): frame 1228, the end of beat 3. The `✖` row is marked
under `system-prompt`, with `1` under `echo $?`.

## Suggested LinkedIn caption (do not post; hand over)

See `system-prompt-1x1.post.txt`.
