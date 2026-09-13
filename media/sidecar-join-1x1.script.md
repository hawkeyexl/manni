# Video script: Sidecar entries keyed by a frontmatter field (`join`)

**Objective:** Show that `sidecars[].join: id` keys a manifest by a page's
frontmatter field instead of its path, so a rename never orphans an entry. Two
pages sharing one id is a finding on both. And `query` refuses to change the id
of a page the manifest matched, with exit 2.
**Format:** 1080x1080, 30 fps, silent, captions burned in (LinkedIn autoplays muted).
**Duration:** 39.8 s (spec: 20-45 s).
**Audience:** docs engineers who move pages, and CI engineers who own the
manifest (personas Maya and Devin, CUJs M1 / M2 / D4; Sara for S3).
**Feature:** proposal 0039, `docs/proposals/0039-sidecar-join.md`.

Visual spec: `docs/content-strategy/design.md`. Accent `#58a6ff` (blue; never
red, green, yellow or cyan, which the CLI's own output uses). Terminal
`#171717`, bands `#0d0d0d`, JetBrains Mono throughout. Title band 112 px, 2 px
accent rules, caption band 86 px.

## How it was made, and what is staged

Everything printed in the terminal is a real run of `node dist/cli.js` on this
branch. The typed command reads `manni` through a shim on PATH
(`media/bin/manni`) that execs the built CLI.

- **A Remotion replay, not a VHS capture.** VHS cannot record on this machine,
  because its bundled `ttyd` hangs on connect. This run re-checked it with a
  one-line tape. VHS echoed the tape header and produced no frame in 60 s. So
  the CLI was run under a small preload that makes stdout/stderr report as a
  TTY (`media/capture/tty.cjs`), and the bytes were saved verbatim
  (`media/capture-join/*.ans`). A Remotion composition
  (`media/remotion/src/join/beats.ts`, `src/Demo.tsx`, composition
  `SidecarJoinDemo`) replays them. It types at 40 ms/char, presses Enter, and
  shows the output after the command's **measured** latency. Nothing in the
  output is edited.
- **`media/scratch-join/` is `test/fixtures/sidecars-join/`, staged.** It is
  its own git repository (`media/` is gitignored in manni, and `manni meta`
  honours `.gitignore` through `git check-ignore`, which would have skipped
  every page). Nothing was committed to manni. Three things differ from the
  fixture, all input, none output:
  1. `docs/new.md` and `docs/no-id.md` were removed. Both fail on missing
     required keys. That is the schema's `required` rule doing its job. It is
     not what this video is about, though, and there is no caption room to
     explain it. `docs/billing.md` stays, because removing it would orphan its
     manifest entry and turn the run into exit 2.
  2. `manni.config.yaml` is the fixture's config in the compact form the
     earlier two videos used (one-line `paths:` and `schemas:`, no
     fixture-comment line). Same keys, same values.
  3. The comment on line 1 of `docs-meta.yaml` was shortened from 74 to 62
     characters so it fits one row at the chosen size. It is still line 1, so
     the `docs-meta.yaml:6` location in the billing finding is unchanged.
  The orphan fixtures (`docs-meta.orphan.yaml`, `manni.orphan.config.yaml`)
  are not used.
- **The rename is on camera.** Beat 2 types
  `mkdir -p docs/guides && mv docs/auth.md docs/guides/authentication.md`
  and then runs the config-corpus `validate`. That run is the one that would
  have raised the orphan error for a path-keyed manifest. Rule 3 of 0039 runs
  the orphan check only on a corpus run. Its exit 1, with a green check on the
  new path, is the demonstration. A scoped run would not have proved it.
- **Beat 3 is the same screen as beat 2** with a new title and caption. The
  duplicate finding is in the same output; a second run would add nothing.
- **Row highlight is chrome.** A faint accent ground (`#58a6ff` at 16%)
  behind the rows a caption is about, so they can be found at phone size.
  The bytes in those rows are untouched.
- **Long lines wrap at spaces, with a hanging indent.** A real terminal would
  hard-wrap at the column edge. The replay breaks only at a space and gives
  the continuation row the line's own indent. No token is split
  (design.md check 2). The bytes are the same; only where the row breaks differs.

## Derived font size

The longest real line is 149 characters (the `query` refusal). Unwrapped it
would need 14 px, illegible on a phone, so the terminal wraps. The search in
`media/capture-join/cols.mjs` runs the space-only wrap over every real line
from 30 px down. **26 px / 66 columns** is the largest size at which the two
`[sidecar:duplicate]` lines wrap to exactly two rows. At that size every
continuation row also carries two or more words. At 28 px each takes three
rows, with the tag alone on the last, and at 27 px four last words are
orphaned. Line height 36 px. The tallest beat is 20 rows = 720 px of the 838 px
available. 23 px / 75 columns, which the URL video derived, also fits. 26 px
was chosen because these lines are shorter and the type can be larger.

## Beats

| # | Title (band) | Terminal | Caption (band) | Length |
|---|---|---|---|---|
| 1 | join: id | `cat manni.config.yaml`, `cat docs-meta.yaml` | The manifest names pages by their id field, not their path. join: id says which field. | 8.9 s |
| 2 | Rename the page | `mkdir -p docs/guides && mv docs/auth.md docs/guides/authentication.md`, `manni meta validate`, `echo $?` | The page moved; its entry did not. The values arrive by id, and the new path passes. | 12.3 s |
| 3 | One id, two pages | (same screen) | dup-a and dup-b both say id: shared. That is a finding on both, and each names the other. | 4.9 s |
| 4 | The id is the join | `manni meta query "UPDATE docs SET id = 'other' WHERE _path = 'docs/guides/authentication.md'"` | query refuses to change the id of a page the manifest matched. Change the manifest first. | 9.0 s |
| 5 | Exit codes for CI | `echo $?` (same screen as beat 4) | 1 for findings. 2 for the refusal. A rename is neither: nothing to edit, nothing orphaned. | 4.8 s |

Beat 1 highlights `join: id` and the three manifest keys. Beat 2 highlights
`✓ docs/guides/authentication.md`, beat 3 the four `dup-a` / `dup-b` rows, and
beat 4 the `manni:` refusal.

Beats 1, 2 and 4 start on a cleared terminal. Beat 3 continues beat 2's
screen and beat 5 continues beat 4's, because `$?` refers to the command
above it.

One caption claim is not a single line on screen and is verified instead:
"nothing orphaned" in beat 5. The evidence is beat 2's corpus run, which is
exit 1 (three findings) rather than the exit 2 an orphaned entry produces.
The orphan path itself is exercised by `test/sidecars-join.test.ts` on the
fixture's `docs-meta.orphan.yaml`.

## Real output quoted

Beat 2, `manni meta validate` after the rename (exit 1):

```
Using manni.config.yaml (.)
✗ docs/billing.md
    /jira  must match pattern "^PLAT-[0-9]+$"  (docs-meta.yaml:6)  [./private.schema.json]
✗ docs/dup-a.md
    /id  2 documents carry id "shared"; docs-meta.yaml cannot tell them apart (docs/dup-b.md)  (line 3)  [sidecar:duplicate]
✗ docs/dup-b.md
    /id  2 documents carry id "shared"; docs-meta.yaml cannot tell them apart (docs/dup-a.md)  (line 3)  [sidecar:duplicate]
✓ docs/guides/authentication.md

4 files checked, 1 passed, 3 failed, 3 errors
```

Also captured, not shown (`media/capture-join/validate-before.ans`): the same
run before the rename, identical except that the passing line reads
`✓ docs/auth.md` and sorts first.

Beat 4, `manni meta query "UPDATE docs SET id = 'other' WHERE _path = 'docs/guides/authentication.md'"` (exit 2):

```
Using manni.config.yaml (.)
manni: "docs/guides/authentication.md": "id" is the field sidecar docs-meta.yaml joins on, and this document has an entry; change the manifest first.
```

`docs/guides/authentication.md` still reads `id: auth-guide` afterwards; the
refusal is at plan time and writes nothing.

## Timing rules applied

- Typing 40 ms per character (spec: 35-70 ms). Cursor is a solid block, no blink.
- Output appears after the command's real measured latency, from three runs
  each. The runs took 593-614 ms for validate and 585-605 ms for query, and the
  replay uses 610 ms for both.
  See `latency` in `media/remotion/src/join/beats.ts`.
- Each beat holds 3.4-4.8 s after its main output, so the caption can be
  read twice.
- Cuts between beats, no transitions.
- No narration, so no loudness pass: the AAC 48 kHz track is silence
  (`anullsrc`), measured at -inf LUFS on the finished file.

## Exact commands, as typed in the video

```bash
cd media/scratch-join                # its own git repo
cat manni.config.yaml
cat docs-meta.yaml
mkdir -p docs/guides && mv docs/auth.md docs/guides/authentication.md
manni meta validate
echo $?
manni meta query "UPDATE docs SET id = 'other' WHERE _path = 'docs/guides/authentication.md'"
echo $?
```

## Material

```
media/scratch-join/
  docs/{auth,billing,dup-a,dup-b}.md   copied from test/fixtures/sidecars-join/docs/
  docs/guides/authentication.md        docs/auth.md after the on-camera mv
  private.schema.json                  copied from test/fixtures/sidecars-join/
  docs-meta.yaml                       fixture manifest; comment on line 1 shortened
  manni.config.yaml                    fixture config in compact form; join: id
```

## Reproduce

```bash
npm run build
cd media/scratch-join
node -r ../capture/tty.cjs ../../dist/cli.js meta validate > ../capture-join/validate.ans 2>&1
node -r ../capture/tty.cjs ../../dist/cli.js meta query "UPDATE docs SET id = 'other' WHERE _path = 'docs/guides/authentication.md'" > ../capture-join/query.ans 2>&1
cd ../remotion
node scripts/captures-join.mjs
npx remotion render src/index.ts SidecarJoinDemo out/join/render.mp4
cd .. && ffmpeg -i remotion/out/join/render.mp4 -f lavfi -i anullsrc=r=48000:cl=stereo -shortest -c:v copy -c:a aac sidecar-join-1x1.mp4
```
