# `manni tracevals` — demo beat sheet

- **Type:** feature demo, terminal session. No narration; captions only
  (LinkedIn autoplays muted).
- **Audience:** the people who write a repository's agent instructions —
  `CLAUDE.md`, skills, subagents, slash commands — and the CI engineers who
  would like to gate on them. Phone-sized, muted.
- **Target:** 34 s, three beats, one caption each.
- **Objective:** the viewer sees that the instructions an agent session ran
  under are now checkable: `manni tracevals run <trace>` grades a real Claude
  Code session against the evals declared beside those instructions, names the
  rule that was broken, and exits 1 so CI can stop there.
- **Assets:** `media/tracevals-1x1.mp4` (not committed), `.gif`, `.thumb.png`,
  `.vtt`, `.transcript.txt`, this file, `media/capture-tracevals/`, and
  `media/remotion/src/tracevals/`.
- **Look:** `docs/content-strategy/design.md`. 1080×1080, 30 fps, title band
  112 px with `n / 3` counter, caption band 86 px, accent `#58a6ff` blue.
  Never red / green / yellow / cyan: the report's own `PASS`, `FAIL`,
  `⚠`/`○` and dim detail use those in the same frame, and the accent sits
  directly above them.
- **Material:** every message in both traces is a line of
  `test/tracevals/fixtures/traces/claude-session.jsonl`; the eval shapes are
  `test/tracevals/fixtures/project/CLAUDE.md`'s `skill-invoked` and
  `tool-usage` graders. `media/capture-tracevals/make-demo.mjs` subtracts what
  the story has no use for — the plugin skill, the two subagents, the slash
  commands, the deliberately-malformed line the fixture carries to exercise the
  parser — re-chains `parentUuid`, and rewrites the recorded `cwd`. Nothing
  adds output. Everything on screen is real execution of the built
  `dist/cli.js`.

| # | Time | Title band | Caption band | Typed | On screen |
|---|---|---|---|---|---|
| 1 | 0:00–0:08 | The rules, and the checks | CLAUDE.md states two house rules. It now carries the evals that encode them. | `cat CLAUDE.md` | front matter with two evals (`tool-usage`, `skill-invoked` with a `when:` trigger), then the two rules in prose. The rule and the eval that encodes it are marked |
| 2 | 0:08–0:21 | Grade a real session | It read before editing. It edited src/ without the skill. One eval fails, exit 1. | `manni tracevals run session-1.jsonl --deterministic-only`, then `echo $?` | `PASS CLAUDE.md › read-before-edit`, `FAIL CLAUDE.md › source-edits-use-the-skill`, `[error] skill fix-bug was never invoked`, `2 eval(s): 1 pass, 1 fail`, `1` |
| 3 | 0:21–0:34 | The next session | Same rules, same gate. This session used the skill: both evals pass, exit 0. | `manni tracevals run session-2.jsonl --deterministic-only`, then `echo $?` | two `PASS` rows, the implicit `ai` eval reported `SKIP` rather than silently absent, coverage resolves the skill, `3 eval(s): 2 pass`, `0` |

## Why this story

The feature is not "a linter for transcripts". It is that the instructions a
team writes for its agents stop being unverifiable prose. Beat 1 puts the rule
and the check in the same file, on the same screen, so the `FAIL` line in beat 2
has a visible origin. Beat 3 exists because a red line on its own is a
complaint; a gate is a red line that can go green, and the exit codes are what
a CI job reads.

The third beat runs a *second* session rather than editing the first, because a
session that already happened cannot be fixed. What changes between the two
traces is what the agent did, which is exactly what the tool grades. Both
filenames are on screen, so nothing is hidden.

`--deterministic-only` is typed rather than hidden in config. It is the honest
reason no API key appears: `tool-usage` and `skill-invoked` are decided from
the trace alone, and the one `ai` eval reports `SKIP` with its reason instead
of quietly not running. A run with a judge would need a provider, a model and a
network, none of which a 34-second demo can show truthfully.

## Capture notes

- **Font size is derived, not chosen** (`node capture-tracevals/cols.mjs`).
  The longest real line is
  `      options: { skill: fix-bug, expect: used, when: { file-access: "src/**" } }`
  at 80 characters, and the longest unbreakable token is the staged skill's
  absolute path at 57. 26 px gives 66 columns: every line either fits or breaks
  at a space, the tallest beat is 828 px against 838 px of terminal, and no
  token is split. 28 px would have been legible but 897 px tall.
- `options:` is written in YAML flow style in the staged `CLAUDE.md`. Block
  style is four more rows per eval, and the whole file has to fit one frame.
  The keys are identical either way.
- **The demo repository is staged at `~/demo`, not under `media/`.**
  `manni tracevals run` prints the resolved absolute path of the trace, so a
  demo repo inside `.claude/worktrees/<branch>/media/` would put a
  140-character unbreakable token in the first line of every report, and
  design.md forbids splitting a token across a line break. `~/demo` makes that
  header 57 characters. The directory is disposable; `capture.sh` rebuilds it
  and refuses to touch a directory that is not one of its own.
- Staged artifacts get an mtime of 2026-06-20, before the session's last
  timestamp. Otherwise every run carries a "modified after the session ended"
  warning about instructions that, in the story, predate the session.
- Measured latency, the capture run plus three timing runs
  (`capture-tracevals/latency.txt`): `session-1` 701–731 ms, `session-2`
  705–730 ms. The composition holds output for 0.72 s after Enter. Nothing is
  sped up; the real command is this fast.
- No hyphenated word may land on a caption line break. The band wraps at the
  hyphen, and a first draft of beat 2's caption rendered as `fix-` / `bug
  skill.`, which reads as a typo.
- `manni` is `node -r media/capture/tty.cjs dist/cli.js`, which only tells the
  CLI that stdout is a terminal so colour is emitted. Staged input, real output.

## How to rebuild it

```bash
# from the repo root
npm run build
cd media
bash capture-tracevals/capture.sh          # stages ~/demo, captures every byte
node capture-tracevals/cols.mjs 26         # re-derive the font size

cd remotion
npm ci
node scripts/captures-tracevals.mjs        # captures -> src/tracevals/captures.json
npx remotion render TracevalsDemo ../tracevals-1x1.mp4
npx remotion still TracevalsDemo ../tracevals-1x1.thumb.png --frame=620

# timings for the sidecars come from the same beats the composition uses
npx tsc src/tracevals/beats.ts src/beats.ts --outDir scripts/out-tracevals \
  --module commonjs --target ES2022 --moduleResolution node \
  --resolveJsonModule --esModuleInterop --skipLibCheck
cd scripts && node vtt-tracevals.cjs && node transcript-tracevals.cjs

# GIF, for hosts that will not take an MP4
cd ../.. && ffmpeg -i tracevals-1x1.mp4 -vf "fps=12,scale=540:540:flags=lanczos,split[a][b];[a]palettegen=max_colors=128:stats_mode=diff[p];[b][p]paletteuse=dither=none:diff_mode=rectangle" tracevals-1x1.gif

rm -rf ~/demo                              # the staged repo is disposable
```

Thumbnail (`.thumb.png`): frame 620, the end of beat 2, with the `FAIL` row
marked and `1` on the line below the prompt. The failure is the hook; the green
run is the payoff and belongs inside the video.

## Suggested LinkedIn caption (do not post; hand over)

You wrote the `CLAUDE.md`. You wrote the skill. Did the agent actually follow
them?

Until now the only way to find out was to read the transcript yourself.
`manni tracevals` grades a Claude Code session against the instructions it ran
under, and the checks live in the instruction file itself — a few lines of
`evals:` in front matter, next to the rule they encode.

Here, one session edited `src/` without going through the skill the house rules
name. `FAIL`, with the reason, and exit 1 — so CI can stop there. The next
session used it: exit 0.

Two of the three graders in this run are deterministic, decided from the trace
alone, so they need no model and no API key. The third is LLM-judged, and it
says `SKIP` with its reason rather than quietly passing.

`npm i -g @hawkeyexl/manni` · `manni tracevals run <trace>`
