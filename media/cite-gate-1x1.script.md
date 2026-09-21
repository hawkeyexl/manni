# Video script: Gate the citations (`manni cite check` in CI and pre-commit)

**Objective:** Show what stops a stale citation. A source line changes, so the
sentence that quotes it is now wrong. The published `manni-cite` pre-commit
hook refuses the commit, because a changed source is an error. `manni cite
update --accept` repairs both ends, and the commit lands. The same check runs
as a step in the Docs workflow, where `-f github` annotates the sentence.
**Format:** 1080x1080, 30 fps, silent, captions burned in (LinkedIn autoplays muted).
**Duration:** 40 s planned (spec: 20-45 s).
**Audience:** CI engineers who add the gate to a pipeline (Devin) and
contributors who hit it on a commit (Theo).
**Feature:** the `manni-cite` hook in `.pre-commit-hooks.yaml`, and the
citation step in `.github/workflows/docs.yml`. The gap it closes is real. #61
shifted the lines of 25 citations in this repository and nothing looked,
because the check only ever ran when someone asked for it.

Visual spec: `docs/content-strategy/design.md`. Accent `#58a6ff` (blue), the
series accent. Never red, green, yellow or cyan: manni's own rows use all
four. Terminal `#171717`, bands `#0d0d0d`, JetBrains Mono throughout. Title
band 112 px, 2 px accent rules, caption band 86 px.

## Beats (storyboard)

Four static full-frame shots. Every beat starts on a cleared terminal and cuts
to the next, with no transitions.

| # | Title (band) | Terminal | Caption (band) | Time |
|---|---|---|---|---|
| 1 | A sentence pinned to a line | `cat docs/limits.md`, `manni cite check docs/limits.md`, `echo $?` | The page pins one sentence to one line of the module. Today it is true. | 0:00-0:09 |
| 2 | The commit the hook refuses | `sed -i 's/10_000;/30_000;/2' src/limits.ts`, `manni cite check docs/limits.md --show-diff`, `git commit -am 'raise the timeout'` | The constant changed, so the sentence is wrong. The hook stops the commit that broke it. | 0:09-0:22 |
| 3 | Repair both ends | `sed -i 's/is 10 seconds/is 30 seconds/' docs/limits.md`, `manni cite update docs/limits.md --accept`, `git commit -am 'raise the timeout'` | Fix the sentence, re-pin, commit. `update --accept` re-mints the claim and the source in one write. | 0:22-0:33 |
| 4 | The same check gates CI | `manni cite check docs/limits.md -f github` | One step in the Docs workflow. A finding annotates the sentence it sits on, and an error fails the job. | 0:33-0:40 |

Beat 1 highlights the `claim.lines` and `source.lines` pair in the
frontmatter, and the sentence at line 16. Beat 2 highlights the `-` and `+`
rows of the diff, then the hook's failure lines. Beat 3 highlights the two
`re-pinned` report lines. Beat 4 highlights `line=16` and
`title=manni%3Acite/source-changed` in the annotation.

Thumbnail (`.thumb.png`): the end of beat 2, with the diff and the refused
commit both on screen.

## Real output quoted

Every byte below is a real run of `node dist/cli.js`, built from this branch
in `media/scratch-cite-gate/`, with `NO_COLOR=1`. The one exception is
pre-commit's own framing in beat 2, marked below. The typed command reads
`manni`, the name the shim `media/bin/manni` gives the built CLI.

Beat 1, `manni cite check docs/limits.md` (exit 0):

```
✓ docs/limits.md
    ✓ fetch-timeout   :16 current   src/limits.ts:2 current

1 file checked, 1 passed, 0 failed, 0 findings
```

Beat 2, `manni cite check docs/limits.md --show-diff` (exit 1):

```
✗ docs/limits.md
    ✗ fetch-timeout   :16 current   src/limits.ts:2 changed since fe61dbe, 0 commits
        diff --git a/src/limits.ts b/src/limits.ts
        index a5ba35a..83cc3ba 100644
        --- a/src/limits.ts
        +++ b/src/limits.ts
        @@ -1,5 +1,5 @@
         export const MAX_FILES = 10_000;
        -export const FETCH_TIMEOUT_MS = 10_000;
        +export const FETCH_TIMEOUT_MS = 30_000;
         export const RETRIES = 3;
```

`0 commits` is right, and it is the point of the hook. The edit is staged and
not committed, so no commit sits between the pin and the working tree. The
finding exists before there is any history to find it in.

Beat 3, `manni cite update docs/limits.md --accept` (exit 0):

```
docs/limits.md: fetch-timeout claim at line 16 re-pinned (changed; now "The fetch timeout is 30 seconds.")
docs/limits.md: fetch-timeout source src/limits.ts:2 re-pinned at 7ea10df (changed; sha256-78af1d33… -> sha256-7cb6e7f1…)
2 citations rewritten in 1 file, 0 skipped
```

Without `--accept` the same command refuses the work rather than guessing,
which is worth one row of beat 3 if it fits:

```
docs/limits.md: fetch-timeout  ✗ skipped: changed since fe61dbe, 0 commits
0 citations rewritten in 0 files, 1 skipped
```

Beat 4, `manni cite check docs/limits.md -f github` (exit 1):

```
::error file=docs/limits.md,line=16,title=manni%3Acite/source-changed::fetch-timeout (src/limits.ts:2): changed since fe61dbe, 0 commits
```

## The one beat whose bytes are not captured yet

Beat 2 ends on pre-commit refusing the commit, and those bytes are pre-commit's
rather than manni's. **pre-commit is not installed on the machine this script
was written on.** So the lines below are its documented shape, not a recorded
run. The capture step must record them and correct this section:

```
manni cite check.........................................................Failed
- hook id: manni-cite
- exit code: 1
```

followed by the tool's own output, which is the `✗` rows quoted above without
the diff, because the hook passes no `--show-diff`.

The capture must also confirm two things the script asserts:

1. the hook receives only the staged paths, so `docs/limits.md` is checked and
   the rest of the demo repository is not;
2. the sources still resolve from the git root, so the staged and uncommitted
   `src/limits.ts` is the file that is read.

Both follow from `.pre-commit-hooks.yaml` and `src/cite/core/sources.ts`, and
`test/pre-commit-hook.test.ts` pins the hook's shape. Neither is proven on
screen until the capture runs.

## What is staged

- **`media/scratch-cite-gate/` is the demo repository.** It has its own
  `git init` and two commits, so `git ls-files` indexes its sources and the
  entry records a commit. `media/scratch-*` is gitignored in manni, so nothing
  here is committed to the repository.
- **The material comes from `test/fixtures/cite/`.** `src/limits.ts` is the
  fixture file unchanged, and `docs/limits.md` carries the fixture's sentence,
  "The fetch timeout is 10 seconds." The citation is minted by a real
  `manni cite add docs/limits.md:6 src/limits.ts:2 --id fetch-timeout`, so the
  pin and its `commit-sha` are the tool's own.
- **A second commit exists on purpose.** `cite add` writes the entry, and
  committing it is what makes beat 2's edit the only uncommitted change. The
  pin then records `fe61dbe`, the commit before the entry, which is why
  beat 3 re-pins at `7ea10df`.
- **`.pre-commit-config.yaml` is staged and not shown.** It names this
  repository as the hook repo with a local `rev`. So the demo runs the hook
  from the branch rather than from a published tag.
- **No `manni.config.yaml`.** Every command names the page, so nothing about
  the demo hides in config discovery.
- **Beat 2's edit is inside the cited line, not above it.** That distinction
  is the whole gate. An edit above the line is `source-moved`, a warning, and
  the commit lands. An edit to the line itself is `source-changed`, an error,
  and it does not. A demo that moved the line would show the hook passing.

## Derived font size

Not derived yet, and beat 4 decides it. The annotation carries one
76-character token, `file=docs/limits.md,line=16,title=manni%3Acite/source-changed::fetch-timeout`,
which no space-only wrap can break. design.md check 2 forbids hard-wrapping
inside a token, so the replay needs at least 76 columns. The widest real line
is that annotation at 136 characters, and it wraps after `::error`. The
frontmatter's integrity rows are 88 characters and wrap at spaces.

21 px gives 82 columns in this series, which clears 76. Run
`media/capture-cite-gate/cols.mjs`, modelled on `media/capture-term/cols.mjs`,
over the real lines before settling it. Beat 2 is the tallest at about 15
rows, so height does not decide.

## Timing rules to apply

- Typing 35 ms per character (spec: 35-70 ms), solid block cursor, no blink.
- Output after each command's measured latency, taken during the capture run
  rather than guessed. `git commit` under pre-commit is the slow one, because
  the hook resolves `@latest` through `npx`.
- Each beat holds 3.5-4 s after its main output, so a caption of about 90
  characters can be read on it.
- No narration, so the AAC 48 kHz track is silence (`anullsrc`).
- One caption cue per beat, two lines of about 55 characters, burned in.

## Exact commands, as typed in the video

```bash
cd media/scratch-cite-gate          # its own git repo
cat docs/limits.md
manni cite check docs/limits.md
echo $?
sed -i 's/10_000;/30_000;/2' src/limits.ts
manni cite check docs/limits.md --show-diff
git commit -am 'raise the timeout'
sed -i 's/is 10 seconds/is 30 seconds/' docs/limits.md
manni cite update docs/limits.md --accept
git commit -am 'raise the timeout'
manni cite check docs/limits.md -f github
```

Beat 4 runs against a page that has drifted again. So the capture either
repeats beat 2's edit, or keeps a copy of the page from that point.

## Capture and render are outstanding

This file is the script and the beat sheet. The capture, the Remotion
composition, the render, the thumbnail, the captions and the GIF are not done
yet. `media/term-vale-1x1.script.md` records the whole pipeline, and
`media/capture-term/` holds its capture scripts. The steps left are

1. install pre-commit, then a capture script under `media/capture-cite-gate/`
   running the commands above through `media/capture/tty.cjs`, so manni's
   output reports a terminal;
2. the font size, derived as the section above sets out;
3. a `CiteGateDemo` composition beside the others in `media/remotion/src/`,
   replaying the captured bytes;
4. the render, the still, the VTT and the transcript, then the MP4 and the
   GIF, exactly as the term script's Reproduce section lists them.

The MP4 stays out of git; everything else under `media/` is committed.
Posting to LinkedIn is the author's call, every time.
