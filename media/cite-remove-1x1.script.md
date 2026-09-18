# Video script: Remove a citation (`manni cite remove`)

**Objective:** Show the one thing the citation tool could not do. A source
file is gone, so `cite check` fails and `cite update` has nothing to repair.
`manni cite remove --only retries` takes the entry out, deletes the marker
that named it, and moves the claim below the marker up one line, in one write.
The next `cite check` is clean.
**Format:** 1080x1080, 30 fps, silent, captions burned in (LinkedIn autoplays muted).
**Duration:** 34 s planned (spec: 20-45 s).
**Audience:** docs engineers who keep a docset's citations true (Maya) and
contributors who hit a red citation check on a pull request (Theo).
**Feature:** `manni cite remove`, plan 4 of the cite dogfooding plan. The gap
it closes was found by pinning 1,941 citations by hand.

Visual spec: `docs/content-strategy/design.md`. Accent `#58a6ff` (blue), the
series accent. Never red, green, yellow or cyan: manni's own rows use all
four. Terminal `#171717`, bands `#0d0d0d`, JetBrains Mono throughout. Title
band 112 px, 2 px accent rules, caption band 86 px.

## Beats (storyboard)

Four static full-frame shots. Every beat starts on a cleared terminal and cuts
to the next, with no transitions.

| # | Title (band) | Terminal | Caption (band) | Time |
|---|---|---|---|---|
| 1 | The source is gone | `cat docs/limits.md`, `manni cite check docs/limits.md`, `echo $?` | Two pins. The file `retries` rests on was deleted, so the check fails. | 0:00-0:11 |
| 2 | Nothing to repair | `manni cite update docs/limits.md`, `echo $?` | `update` rewrites what moved. A path that is gone cannot be rewritten, so it is skipped. | 0:11-0:18 |
| 3 | Remove it, markers and all | `manni cite remove docs/limits.md --only retries --dry-run` | The entry goes, its marker goes, and the claim below the marker moves up one line. | 0:18-0:28 |
| 4 | Clean again | `manni cite remove docs/limits.md --only retries`, `manni cite check docs/limits.md`, `echo $?` | One write, exit 0. The citation that stayed still pins its sentence. | 0:28-0:34 |

Beat 1 highlights the `retries` entry in the frontmatter, the `<!-- cite
retries -->` marker, and the `missing` row. Beat 3 highlights the three parts
of the diff: the entry's lines, the `lines: 6` to `lines: 5` change, and the
marker line. Beat 4 highlights the report line and the green summary.

Thumbnail (`.thumb.png`): the end of beat 3, with the whole dry-run diff and
the `would be removed` footer on screen.

## Real output quoted

Every byte below is from a real run of `node dist/cli.js` built from this
branch, in `media/scratch-cite-remove/`, with `NO_COLOR=1`. The typed command
reads `manni`, the name the shim `media/bin/manni` gives the built CLI.

Beat 1, `manni cite check docs/limits.md` (exit 1):

```
✗ docs/limits.md
    ✗ retries         marker :23 current   src/retries.ts:3 missing
    ✓ fetch-timeout   :26 current          src/limits.ts:2 current

1 file checked, 0 passed, 1 failed, 1 finding
```

Beat 2, `manni cite update docs/limits.md` (exit 1):

```
docs/limits.md: retries  ✗ skipped: missing
0 citations rewritten in 0 files, 1 skipped
```

Beat 3, `manni cite remove docs/limits.md --only retries --dry-run` (exit 0):

```
--- docs/limits.md
+++ docs/limits.md
@@ -3,13 +3,5 @@
 citations:
-  - id: retries
-    claim:
-      integrity: sha256-3049e93e72873542aac2c1c4778fa655e70656f03c08f202444062f404a3315d
-    source:
-      file: src/retries.ts
-      lines: 3
-      integrity: sha256-4f0c2b8d9a1e6f37c5b0d84e2a9f71c3b6e5d048a2c917f3b8e4d61a05c7f293
-      commit-sha: 4d9f1c2
   - id: fetch-timeout
     claim:
-      lines: 6
+      lines: 5
       integrity: sha256-921b21cccab21a4577f224ec4171aa56a3414bb3a5a4704ab8b6f314c46aa094
@@ -22,3 +14,2 @@
 
-<!-- cite retries -->
 Retries default to 3.
docs/limits.md: removed retries from frontmatter, and its marker at line 23
1 citation would be removed from 1 file
```

Beat 4, `manni cite remove docs/limits.md --only retries` then
`manni cite check docs/limits.md` (exit 0 and exit 0):

```
docs/limits.md: removed retries from frontmatter, and its marker at line 23
1 citation removed from 1 file
```

```
✓ docs/limits.md
    ✓ fetch-timeout   :17 current   src/limits.ts:2 current

1 file checked, 1 passed, 0 failed, 0 findings
```

## What is staged

- **`media/scratch-cite-remove/` is the demo repository.** It has its own
  `git init` and one commit, so `git ls-files` indexes its sources and the
  entries can record a commit. `media/scratch-*` is gitignored in manni, so
  nothing here is committed to the repository.
- **`docs/limits.md` carries two citations.** `retries` is anchored by a
  marker and pinned to `src/retries.ts:3`; `fetch-timeout` stores
  `claim.lines: 6` and is pinned to `src/limits.ts:2`. Only `src/limits.ts`
  exists, which is what makes `retries` `missing`.
- **`claim.lines: 6` is the point of beat 3.** It counts the body, and the
  marker sits above it, so the removal has to move it to 5. A hand-removal
  does not, and the next check reports a claim nobody edited.
- **No config file.** Both commands take the page as a path, so nothing about
  the demo is hidden in `manni.config.yaml`.
- **The page argument is typed once per beat.** `--only retries` names the
  entry by its id, the same name the marker carries.

## Exact commands, as typed in the video

```bash
cd media/scratch-cite-remove          # its own git repo
cat docs/limits.md
manni cite check docs/limits.md
echo $?
manni cite update docs/limits.md
echo $?
manni cite remove docs/limits.md --only retries --dry-run
manni cite remove docs/limits.md --only retries
manni cite check docs/limits.md
echo $?
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

This file is the script and the beat sheet. The capture, the Remotion
composition, the render, the thumbnail, the captions and the GIF are not done
yet. The earlier videos in this folder are the pattern to follow:
`media/term-vale-1x1.script.md` records the whole pipeline, and
`media/capture-term/` holds its capture scripts. The steps left are

1. a capture script under `media/capture-cite-remove/`, running the commands
   above through `media/capture/tty.cjs` so manni's output reports a terminal;
2. a font size derived from the widest real line, the way
   `media/capture-term/cols.mjs` derives one. Two lines compete for widest
   here: the `✗ retries` row with its padding, and the frontmatter's
   71-character integrity lines;
3. a `CiteRemoveDemo` composition beside the others in
   `media/remotion/src/`, replaying the captured bytes;
4. the render, the still, the VTT and the transcript, then the MP4 and the
   GIF, exactly as the term script's Reproduce section lists them.

The MP4 stays out of git; everything else under `media/` is committed.
Posting to LinkedIn is the author's call, every time.
