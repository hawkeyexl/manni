# Demo beat sheet for verification metadata (proposal 0098)

- **Type:** feature demo, terminal session. No narration; captions only
  (LinkedIn autoplays muted).
- **Audience:** docs engineers who run procedure tests in CI, and the authors
  of tools that write into docs pages. Phone-sized, muted.
- **Target:** 28 s, five beats, one caption each.
- **Objective:** the viewer sees a passing test leave a dated record on the
  page. The record names the tool, and manni checks its form. Any tool can
  write the same shape.
- **Status:** script only. Nothing is recorded or rendered yet. Beats 2 and 3
  need a Doc Detective build that writes `verified-by`, from #417's branch
  once it carries that shape. Capture them only against that build.
- **Assets, once made:** `media/verification-1x1.mp4` (not committed), `.gif`,
  `.thumb.png`, `.vtt`, `.transcript.txt`, `.post.txt`, this file and
  `media/capture-verification/`.
- **Look:** `docs/content-strategy/design.md`. 1080×1080, 30 fps, title band
  112 px with an `n / 5` counter, caption band 86 px, accent `#58a6ff` blue.
  Never red, green, yellow or cyan. The diff in beat 3 is already green, and
  manni's own output uses all four.
- **Material.** A scratch repository, `media/scratch-verification/`
  (gitignored), which is its own git repository. It holds one page with one
  inline Doc Detective test, a `.doc-detective.json`, and a
  `manni.config.yaml` with no keys beyond a `site` collection. The page is
  committed once before the run, so beat 3's diff is the write alone.

| # | Time | Title band | Caption band | Typed | On screen |
|---|---|---|---|---|---|
| 1 | 0:00–0:05 | Declare the check | The page names the test that proves it. No tool-specific keys. | `head -8 set-up.md` | front matter with `verified-by:`, `- tool: doc-detective`, `check: cite-set-up` |
| 2 | 0:05–0:12 | Run the tests | manni test run starts Doc Detective, and the test passes. | `manni test run set-up.md` | one passing test under `set-up.md`; the summary; exit `0` |
| 3 | 0:12–0:19 | The pass is recorded | Doc Detective writes the date and its version. last-verified follows. | `git diff --no-color set-up.md` with colour on | `+last-verified: 2026-10-21`, `+    version: …`, `+    passed: 2026-10-21` |
| 4 | 0:19–0:24 | manni checks the write | Days, or timestamps with a timezone. Anything else fails at its line. | `manni meta validate set-up.md`, then `echo $?` | `✓ set-up.md`; `1 passed`; `0` |
| 5 | 0:24–0:28 | Any tool can write it | One guide says where a value goes, and what never to touch. | none; a still of the docs page | `Write manni metadata from another tool`, the rules list in view |

## Why this story

The feature is a date that means "this still works". The proof is a test
passing and the page changing because of it. Beat 1 shows that the author
writes only the declaration. Beat 3 is the payoff, the three added lines in a
diff. Beat 4 shows manni's part, which is checking the form and writing
nothing. Beat 5 says the shape is not Doc Detective's alone.

## Capture commands

Run from the repo root once the Doc Detective build that writes
`verified-by` is installed into a scratch prefix, not this repo's lockfile.

```bash
npm run build
mkdir -p media/scratch-verification && cd media/scratch-verification
git init -q
cp ../../test/fixtures/verification/one-entry.md set-up.md
# Strip the tool-written keys so the page carries the declaration only.
node -e "const f='set-up.md';const fs=require('fs');fs.writeFileSync(f,fs.readFileSync(f,'utf8').replace(/^last-verified:.*\n/m,'').replace(/^    (version|passed):.*\n/gm,''))"
cat >> set-up.md <<'EOF'

<!-- test {"testId":"cite-set-up"} -->
<!-- step {"runShell":{"command":"echo set up","exitCodes":[0]}} -->
<!-- test end -->
EOF
echo '{"input":"set-up.md","detectSteps":false}' > .doc-detective.json
git add -A && git commit -qm "page before the run"

head -8 set-up.md
manni test run set-up.md
git diff set-up.md
manni meta validate set-up.md; echo $?
```

`manni` is this branch's `node dist/cli.js`, linked the way
`.github/workflows/docs-as-tests.yml` links it. The page is markdown, so its
inline test uses the HTML comment form Doc Detective reads in a `.md` file.

Beat 5 is a still of
`https://hawkeyexl.github.io/manni/meta/integrate/write-metadata-from-a-tool/`
from the local preview, `manni site preview`, at 1080 px wide.

## Captions (`.vtt` source)

```text
00:00.000 --> 00:05.000
The page names the test that proves it. No tool-specific keys.

00:05.000 --> 00:12.000
manni test run starts Doc Detective, and the test passes.

00:12.000 --> 00:19.000
Doc Detective writes the date and its version. last-verified follows.

00:19.000 --> 00:24.000
Days, or timestamps with a timezone. Anything else fails at its line.

00:24.000 --> 00:28.000
One guide says where a value goes, and what never to touch.
```

## Checks before shipping (design.md)

1. Longest line measured at the chosen font size, so no line wraps.
2. No text touches the frame edge.
3. Captions on every beat, burned in and in the `.vtt`.
4. `ffprobe`: 1080×1080, 30 fps, h264 yuv420p.
5. Accent `#58a6ff`, blue.

## Suggested LinkedIn caption

A passing docs test used to leave nothing behind. Now the page records it:
`verified-by` names the check, and `last-verified` is the day every check had
passed. manni validates the shape, and any tool can write it.

Do not post; hand over.
