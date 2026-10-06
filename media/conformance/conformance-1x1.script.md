# Demo beat sheet for `manni tracevals check` and the Stop hook

- **Type:** feature demo, terminal session. No narration; captions only
  (LinkedIn autoplays muted).
- **Audience:** engineers who let an agent work in a repository that has a
  CLAUDE.md, AGENTS.md or `.cursor/rules`, and want those rules kept.
  Phone-sized, muted.
- **Target:** 37.8 s, four beats, one caption each.
- **Objective:** the viewer sees a rule in CLAUDE.md and a turn in which the
  agent broke it. `manni tracevals check` names that rule under its file, with
  exit 1. Then the same judgement under the Stop hook, whose
  `"decision":"block"` sends the agent back with the report.
- **Assets:** `media/conformance/conformance-1x1.mp4` (not committed),
  `.gif`, `.thumb.png`, `.vtt`, `.transcript.txt`, `.post.txt`, this file,
  `media/conformance/capture/`, and `media/remotion/src/conformance/`.
- **Look:** `docs/content-strategy/design.md`. 1080×1080, 30 fps, title band
  112 px with `n / 4` counter, caption band 86 px, accent `#58a6ff` blue.
  Never red, green, yellow or cyan. The report's red `✖` and yellow `?` share
  the frame in beat 3.
- **Material.** The committed fixture `test/tracevals/fixtures/conformance/`,
  unchanged: its `project/` plus the `traces/breaks.jsonl` session, copied
  into `media/scratch-conformance/`. Its `manni.config.yaml` sets
  `provider: mock`, so rules are extracted and judged offline and
  deterministically, as `test/tracevals/integration/conformance.test.ts` and
  `test/family/turn.test.ts` run them. `stop.json` is the `Stop` envelope
  Claude Code writes to the hook, cut to the three fields the hook reads, with
  the trace's own session id. Nothing adds output. Everything on screen is
  real execution of the built `dist/cli.js`.

| # | Time | Title band | Caption band | Typed | On screen |
|---|---|---|---|---|---|
| 1 | 0:00–0:05 | The rule it ran under | This agent's CLAUDE.md: never git push --force. | `cat CLAUDE.md` | the frontmatter's two rules, `no-force-push` marked |
| 2 | 0:05–0:11 | What the agent did | Its last turn ran npm test, then git push --force. | `grep -o '"command": "[^"]*"' breaks.jsonl`, on beat 1's screen | `npm test` and `git push --force origin main`, the push marked |
| 3 | 0:11–0:24 | Judge the turn | Each broken rule, under its file. Exit 1. | `manni tracevals check breaks.jsonl --project .`, `echo $?` | `CLAUDE.md` with `? run-npm-ci-first` and `✖ no-force-push`, `.cursor/rules/web.mdc` with `✖ never-use-innerhtml-in-components`, `7 rules from 5 files. 2 broken, 1 needs review.`, `1` |
| 4 | 0:24–0:38 | The Stop hook blocks once | As a Stop hook, it sends the agent back to fix it. | `cat stop.json`, `manni check < stop.json` | the envelope, then `{"decision":"block","reason":"This turn broke 2 rules …"}` with the same report inside, marked |

## Why this story

The feature checks the rules an agent read against what it did, while the
agent can still act on the answer. Beats 1 and 2 share one screen, so the rule
and the command that broke it are visible together before anything is judged.

Beat 3 is the by-hand form, and it carries the exit code. The report groups
findings under the file each rule came from. The second `✖` comes from
`.cursor/rules/web.mdc`, a file the agent never opened. Its glob matched the
file the turn edited, and that is how the sources are found. The `?` is a rule
the judge could not decide. It is reported for review and not counted as
broken.

Beat 4 is the reason the feature exists. The plugin's Stop hook is the same
`manni check` the family already runs, fed the envelope on stdin. Its stdout is
the JSON Claude Code reads, so it has no colour and exits 0. The block is the
`decision` field, not the exit code, which is why no `echo $?` follows it.
"Once" in the title is the documented behaviour. A second stop with
`stop_hook_active` set gets a message, not another block. That run is not
filmed, so the title states it and the video does not claim to show it.

## Capture notes

- **Font size is derived, not chosen** (`node conformance/capture/cols.mjs`).
  The longest report line is the `never-use-innerhtml-in-components` finding,
  at 75 characters. 23 px gives 75 columns, so every line of the report sits
  on one row. 24 px gives 72 and wraps three report lines, two of them with an
  orphaned word. The hook's JSON is one 602-character line and wraps at spaces
  at any size; its longest token is 41 characters. The tallest screen, beats 1
  and 2 together, is 24 rows, 768 px against 838 px of terminal.
- `capture.sh` stages the scratch project and an empty scratch home at
  `media/scratch-conformance/` and `media/scratch-conformance-home/`.
  `.gitignore` covers `media/scratch-*/`. `HOME`, `USERPROFILE` and
  `CLAUDE_CONFIG_DIR` point at the empty home, as the tests do, so no user's
  own CLAUDE.md is read. The script refuses to touch a directory it did not
  stage.
- `--project .` is typed because the fixture trace records its `cwd` as
  `/conformance-demo`, which does not exist here. A real session's trace
  records the real directory.
- Measured latency, the capture run plus three timing runs
  (`capture/latency.txt`): `tracevals check` 2136–3137 ms from a cold cache,
  the hook 2151–3152 ms. The replay uses the median of the four, about 2.5 s
  each, so nothing is sped up. Another test suite was running on the machine
  at the time, which accounts for the spread.
- `manni` is `node -r media/capture/tty.cjs dist/cli.js`, which only tells the
  CLI that stdout is a terminal so colour is emitted. Staged input, real output.
  Version `4.3.1` (`capture/version.txt`), build commit in
  `capture/build-commit.txt`.
- The audio track is silent AAC (−91 dB measured), as in the earlier videos.
  There is nothing to loudness-normalise.

## How to rebuild it

```bash
# from the repo root
npm run build
cd media
bash conformance/capture/capture.sh          # stages scratch-conformance/, captures every byte
node conformance/capture/cols.mjs 23         # re-derive the font size

cd remotion
npm ci
node scripts/captures-conformance.mjs        # captures -> src/conformance/captures.json
npx remotion render ConformanceDemo ../conformance/conformance-1x1.mp4
npx remotion still ConformanceDemo ../conformance/conformance-1x1.thumb.png --frame=720

# timings for the sidecars come from the same beats the composition uses
npx tsc src/conformance/beats.ts src/beats.ts --outDir scripts/out-conformance \
  --module commonjs --target ES2022 --moduleResolution node \
  --resolveJsonModule --esModuleInterop --skipLibCheck
cd scripts && node vtt-conformance.cjs && node transcript-conformance.cjs

# GIF, for hosts that will not take an MP4
cd ../../conformance && ffmpeg -i conformance-1x1.mp4 -vf "fps=12,scale=540:540:flags=lanczos,split[a][b];[a]palettegen=max_colors=128:stats_mode=diff[p];[b][p]paletteuse=dither=none:diff_mode=rectangle" conformance-1x1.gif

rm -rf ../scratch-conformance ../scratch-conformance-home   # disposable
```

Thumbnail (`.thumb.png`): frame 720, the end of beat 3. Both `✖` rows are
marked under their files, with `1` under `echo $?`.

## Suggested LinkedIn caption (do not post; hand over)

See `conformance-1x1.post.txt`.
