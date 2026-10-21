# Demo beat sheet for inline metadata statements (proposal 0099)

- **Type:** feature demo, terminal session. No narration; captions only
  (LinkedIn autoplays muted).
- **Audience:** docs engineers whose pages hold several procedures, some
  tested and some not. Phone-sized, muted.
- **Target:** 34 s, five beats, one caption each.
- **Objective:** the viewer sees a verification date land on one procedure
  rather than the whole page. An edit to that procedure is noticed. A heading
  statement types one section, and retrieval can leave it out.
- **Status:** script only. Nothing is recorded or rendered yet. Beat 2 needs a
  Doc Detective build that writes `meta` statements (#417, after plan 5's
  change there). Beats 4 and 5 need plan 4's `graph retrieve --where` and
  `graph lookup`. Capture each beat only against the build that has it.
- **Assets, once made:** `media/inline-statements-1x1.mp4` (not committed),
  `.gif`, `.thumb.png`, `.vtt`, `.transcript.txt`, `.post.txt`, this file and
  `media/capture-inline-statements/`.
- **Look:** `docs/content-strategy/design.md`. 1080×1080, 30 fps, title band
  112 px with an `n / 5` counter, caption band 86 px, accent `#58a6ff` blue.
  Never red, green, yellow or cyan. manni's own output uses all four, and the
  diff in beat 2 is already green.
- **Material.** A scratch repository, `media/scratch-inline-statements/`
  (gitignored), which is its own git repository. It holds one page,
  `set-up.md`, with two procedures and one inline Doc Detective test, a
  `.doc-detective.json`, and a `manni.config.yaml` with a `site` collection
  and a `graph:` section. The page is committed once before the run, so the
  diff in beat 2 is the write alone.

| # | Time | Title band | Caption band | Typed | On screen |
|---|---|---|---|---|---|
| 1 | 0:00–0:06 | Two procedures, one test | The statement sits above the procedure the test proves. The other has none. | `sed -n 8,20p set-up.md` | `<!-- meta {"verified-by":[{"tool":"doc-detective","check":"first-pin"}]} -->` above steps 1 and 2; a second procedure below with no statement |
| 2 | 0:06–0:14 | The pass lands on the steps | Doc Detective writes the date and pins the lines it proved. | `manni test run set-up.md && git diff set-up.md` | one passing test; the diff's one changed line gains `sha256-…`, `"last-verified":"2026-10-21"` and `"passed":"2026-10-21"` |
| 3 | 0:14–0:21 | An edit is noticed | Change a pinned step and manni says so, line by line. | `sed -i 's/Commit the page/Commit the page and its sidecar/' set-up.md && manni meta validate set-up.md` | `warning the block under the meta statement at line 9 changed since it was pinned, so its last-verified may no longer hold.`; exit `0` |
| 4 | 0:21–0:28 | A section, typed inline | A heading statement types one section. A filter leaves it out. | `manni graph retrieve "How do I install it?" --where applies-to=linux -f json \| jq .trace.filtered` | the statement `{"applies-to":["windows"],"graph":{"type":"task"}}` above `## Install on Windows`; then `[{"node": "…#install-on-windows", "field": "applies-to"}]` |
| 5 | 0:28–0:34 | Facts at sentence level | Agents see which lines were verified, and whether they still match. | `manni graph lookup "How do I pin my first sentence?"` | `statements  lines 10-11: verified 2026-10-21 (doc-detective), changed` |

## Why this story

The feature is metadata that belongs to a block, not a page. Beat 1 shows the
problem in one frame: a page-level date would cover both procedures, and only
one was tested. Beat 2 is the payoff, the one-line diff where a test writes
its date and pin onto the steps it ran. Beat 3 shows why the pin exists: an
edit to those steps no longer borrows the old date. Beats 4 and 5 show the
facts reaching the graph, per section and per passage.

## Capture commands

Run from the repo root. First install the Doc Detective build that writes
`meta` statements into a scratch prefix, not this repo's lockfile. Plan 4's
`graph retrieve` and `graph lookup` must be on this branch too.

```bash
npm run build
mkdir -p media/scratch-inline-statements && cd media/scratch-inline-statements
git init -q
cat > set-up.md <<'EOF'
---
title: Set up citations
description: Pin your first sentence, then install on Windows.
applies-to: [linux, windows]
---

## Pin your first sentence

<!-- meta {"verified-by":[{"tool":"doc-detective","check":"first-pin"}]} -->
1. Run `manni cite add docs/intro.md:12 --source src/limits.ts:10-14`.
2. Commit the page and its `.citations.yaml`.

<!-- test {"testId":"first-pin"} -->
<!-- step {"runShell":{"command":"echo pinned","exitCodes":[0]}} -->
<!-- test end -->

## Pin a sentence by hand

1. Write the entry in the sidecar.
2. Run `manni cite check`.

<!-- meta {"applies-to":["windows"],"graph":{"type":"task"}} -->
## Install on Windows

Run the installer, then restart the shell.
EOF
echo '{"input":"set-up.md","detectSteps":false}' > .doc-detective.json
printf 'collections:\n  site:\n    paths: ["*.md"]\ngraph: {}\n' > manni.config.yaml
git add -A && git commit -qm "page before the run"

sed -n 8,20p set-up.md
manni test run set-up.md && git diff set-up.md
sed -i 's/Commit the page/Commit the page and its sidecar/' set-up.md && manni meta validate set-up.md
manni graph retrieve "How do I install it?" --where applies-to=linux -f json | jq .trace.filtered
manni graph lookup "How do I pin my first sentence?"
```

`manni` is this branch's `node dist/cli.js`, linked the way
`.github/workflows/docs-as-tests.yml` links it. Before beat 4, show the
heading statement with `sed -n 21,23p set-up.md` for one second, inside the
same beat. The line numbers in beat 3's warning follow the page above; check
them against the real capture and fix the `On screen` column if they move.

## Captions (`.vtt` source)

```text
00:00.000 --> 00:06.000
The statement sits above the procedure the test proves. The other has none.

00:06.000 --> 00:14.000
Doc Detective writes the date and pins the lines it proved.

00:14.000 --> 00:21.000
Change a pinned step and manni says so, line by line.

00:21.000 --> 00:28.000
A heading statement types one section. A filter leaves it out.

00:28.000 --> 00:34.000
Agents see which lines were verified, and whether they still match.
```

## Checks before shipping (design.md)

1. Longest line measured at the chosen font size, so no line wraps. Beat 2's
   diff line is long; crop it to the statement's tail or scroll it once.
2. No text touches the frame edge.
3. Captions on every beat, burned in and in the `.vtt`.
4. `ffprobe`: 1080×1080, 30 fps, h264 yuv420p.
5. Accent `#58a6ff`, blue.

## Suggested LinkedIn caption

A docs page with five procedures used to carry one "verified" date for all of
them. Now the date sits on the steps the test ran, pinned to their exact
lines. Edit a step, and manni says the date no longer holds.

Do not post; hand over.
