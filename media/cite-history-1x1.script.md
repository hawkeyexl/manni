# Video script: How long a pin stood stale (`manni cite history`)

**Objective:** Show the question `cite check` cannot answer. Today the page is
clean, but its source changed two weeks before anyone re-pinned it, and two
releases shipped in between. `manni cite history` names the window, the
releases inside it and the total, and exits `0`.
**Format:** 1080x1080, 30 fps, silent, captions burned in (LinkedIn autoplays muted).
**Duration:** 30 s planned (spec: 20-45 s).
**Audience:** CI engineers who ramp a docset into the citation gate (Devin,
D18). Docs engineers who answer a reader's bug about one page (Maya, M5).
**Feature:** `manni cite history`, proposal 0092, plan 3 of 6.

Visual spec: `docs/content-strategy/design.md`. Accent `#58a6ff` (blue), the
series accent. Never red, green, yellow or cyan: manni's own rows use all
four, and this demo's `error` word is red. Terminal `#171717`, bands
`#0d0d0d`, JetBrains Mono throughout. Title band 112 px, 2 px accent rules,
caption band 86 px.

## Beats (storyboard)

Four static full-frame shots. Every beat starts on a cleared terminal and cuts
to the next, with no transitions.

| # | Title (band) | Terminal | Caption (band) | Time |
|---|---|---|---|---|
| 1 | Clean today | `manni cite check docs/limits.md`, `echo $?` | The page passes its citation check today. Was it always right? | 0:00-0:06 |
| 2 | Two weeks of history | `git log --oneline --format="%h %s%d"` | The source changed in #14. Two releases shipped before #19 re-pinned it. | 0:06-0:13 |
| 3 | How long it stood stale | `manni cite history docs/limits.md`, `echo $?` | One window: 14 days, shipped in v1.4.0 and v1.5.0. A report, so exit 0. | 0:13-0:24 |
| 4 | One number for a dashboard | `manni cite history docs/limits.md -f json \| jq .summary.staleSeconds` | The total in seconds, ready for a weekly job. | 0:24-0:30 |

Beat 2 highlights the two tag decorations. Beat 3 highlights `stale 14 days`,
`v1.4.0, v1.5.0` and the dim line's `closed by a re-pin`. Beat 4 holds on the
number.

Thumbnail (`.thumb.png`): the end of beat 3, with the window row, the dim
line and the release summary on screen.

## Real output quoted

Every byte below is from a real run of `node dist/cli.js` built from this
branch, in `media/scratch-cite-history/`, with `NO_COLOR=1`. The typed command
reads `manni`, the name the shim `media/bin/manni` gives the built CLI. The
scratch repository has no config file. So the capture adds `--no-config` to
each manni command through the shim's environment, or types it. The commit hashes below are this build's; a rebuilt scratch repo
gets new ones, and the capture reads them from the run.

Beat 1, `manni cite check docs/limits.md` (exit 0):

```
✓ docs/limits.md
    ✓ fetch-timeout   :15 current   src/limits.ts:2 current

1 file checked, 1 passed, 0 failed, 0 findings
```

Beat 2, `git log --oneline --format="%h %s%d"`:

```
20dfe7e docs: re-pin the fetch timeout (#19) (HEAD -> master)
6a28510 chore(release): 1.5.0 (tag: v1.5.0)
599d285 feat: raise the fetch timeout (#14) (tag: v1.4.0)
6576f1c docs: pin the fetch timeout (#12)
1791ad2 limits
```

Beat 3, `manni cite history docs/limits.md` (exit 0):

```
docs/limits.md
  error  fetch-timeout  src/limits.ts:2  stale 14 days  v1.4.0, v1.5.0
         599d285..20dfe7e  source-changed, closed by a re-pin

1 stale window on 1 citation in 1 page, none open. 338.5 stale pin-hours.
2 releases shipped a stale pin: v1.4.0, v1.5.0.
Walked 5 commits, 2026-10-01 to 2026-10-20.
```

Beat 4, `manni cite history docs/limits.md -f json | jq .summary.staleSeconds`:

```
1218600
```

## What is staged

- **`media/scratch-cite-history/` is the demo repository.** It has its own
  `git init`, five commits with pinned dates, and two tags. `media/scratch-*`
  is gitignored in manni, so nothing here is committed to the repository.
- **The dates are pinned** through `GIT_AUTHOR_DATE` and `GIT_COMMITTER_DATE`,
  so the window reads 14 days on every rebuild. The source changes on
  2026-10-06 at 14:00 UTC and the re-pin lands on 2026-10-20 at 16:30 UTC.
- **The pin is minted by `manni cite add`,** not written by hand, so its
  integrity is the tool's own.
- **`v1.5.0` is an empty release commit** inside the window, so the release
  column shows more than one tag.

## Build the scratch repository

From the repository root, after `npm run build`:

```bash
mkdir -p media/scratch-cite-history/src media/scratch-cite-history/docs
cd media/scratch-cite-history
printf 'export const MAX_FILES = 10_000;\nexport const FETCH_TIMEOUT_MS = 10_000;\nexport const RETRIES = 3;\n' > src/limits.ts
printf -- '---\ntitle: Limits\n---\n\nThe fetch timeout is 10 seconds.\n' > docs/limits.md
git init -q
git config user.name Ada && git config user.email ada@example.com
git config commit.gpgsign false && git config core.autocrlf false
git add -A
GIT_AUTHOR_DATE=2026-10-01T09:00:00Z GIT_COMMITTER_DATE=2026-10-01T09:00:00Z git commit -q -m "limits"
node ../../dist/cli.js cite add docs/limits.md:5 src/limits.ts:2 --id fetch-timeout --no-config
git add -A
GIT_AUTHOR_DATE=2026-10-02T09:00:00Z GIT_COMMITTER_DATE=2026-10-02T09:00:00Z git commit -q -m "docs: pin the fetch timeout (#12)"
sed -i 's/FETCH_TIMEOUT_MS = 10_000/FETCH_TIMEOUT_MS = 30_000/' src/limits.ts
GIT_AUTHOR_DATE=2026-10-06T14:00:00Z GIT_COMMITTER_DATE=2026-10-06T14:00:00Z git commit -qam "feat: raise the fetch timeout (#14)"
git tag v1.4.0
GIT_AUTHOR_DATE=2026-10-13T10:00:00Z GIT_COMMITTER_DATE=2026-10-13T10:00:00Z git commit -q --allow-empty -m "chore(release): 1.5.0"
git tag v1.5.0
sed -i 's/is 10 seconds/is 30 seconds/' docs/limits.md
node ../../dist/cli.js cite update docs/limits.md --accept --only fetch-timeout --no-config
GIT_AUTHOR_DATE=2026-10-20T16:30:00Z GIT_COMMITTER_DATE=2026-10-20T16:30:00Z git commit -qam "docs: re-pin the fetch timeout (#19)"
```

## Exact commands, as typed in the video

```bash
cd media/scratch-cite-history          # its own git repo
manni cite check docs/limits.md
echo $?
git log --oneline --format="%h %s%d"
manni cite history docs/limits.md
echo $?
manni cite history docs/limits.md -f json | jq .summary.staleSeconds
```

## Captions (one cue per beat)

```
1  00:00.0 --> 00:06.0  The page passes its citation check today. Was it always right?
2  00:06.0 --> 00:13.0  The source changed in #14. Two releases shipped before #19 re-pinned it.
3  00:13.0 --> 00:24.0  One window: 14 days, shipped in v1.4.0 and v1.5.0. A report, so exit 0.
4  00:24.0 --> 00:30.0  The total in seconds, ready for a weekly job.
```

## Timing rules to apply

- Typing 35 ms per character (spec: 35-70 ms), solid block cursor, no blink.
- Output after each command's measured latency, taken during the capture run
  rather than guessed.
- Each beat holds 3.5-4 s after its main output, so a caption of about 90
  characters can be read on it.
- No narration, so the AAC 48 kHz track is silence (`anullsrc`).
- One caption cue per beat, two lines of about 55 characters, burned in.

## Capture and render are outstanding

This file is the script and the beat sheet. Nothing is recorded yet. The
earlier videos in this folder are the pattern: `media/term-vale-1x1.script.md`
records the whole pipeline, and `media/capture-term/` holds its capture
scripts. The steps left are

1. a capture script under `media/capture-cite-history/`, running the commands
   above through `media/capture/tty.cjs` so manni's output reports a terminal;
2. a font size derived from the widest real line, the beat 3 window row at 71
   characters;
3. a `CiteHistoryDemo` composition in `media/remotion/src/`, replaying the
   captured bytes;
4. the render, the still, the VTT and the transcript, then the MP4 and the
   GIF.

The MP4 stays out of git; everything else under `media/` is committed.
Posting to LinkedIn is the author's call, every time.
