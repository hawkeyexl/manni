# Video script: Provenance pins (`provenance`, `--generated-by`)

**Objective:** Show that `manni meta derive` pins the lines an agent wrote to
the machine that wrote them, before they are committed. A person editing inside
that range breaks the pin, and `manni meta validate` fails with
`derived:stale`, exit 1. Then `derive` re-attributes from git. The agent keeps
its untouched lines, the edited line is attributed to no machine, and
`validate` passes, exit 0.
**Format:** 1080x1080, 30 fps, silent, captions burned in (LinkedIn autoplays muted).
**Duration:** 43.1 s (spec: 20-45 s).
**Audience:** docs engineers who let agents write prose (Maya) and CI
engineers who gate on `validate` (Devin).
**Feature:** proposal 0046, `docs/proposals/0046-provenance-pins.md`; the
story is stress test 9, "A person edits inside an agent's range".

Visual spec: `docs/content-strategy/design.md`. Accent `#58a6ff` (blue; never
red, green, yellow or cyan, which the CLI's and git's output use). Terminal
`#171717`, bands `#0d0d0d`, JetBrains Mono throughout. Title band 112 px, 2 px
accent rules, caption band 86 px.

## How it was made, and what is staged

Everything printed in the terminal is a real run, on this branch, of either
git or `node dist/cli.js` (commit `39e6290`, the already-built `dist/`). The
typed command reads `manni` through the shim on PATH (`media/bin/manni`) that
execs the built CLI.

- **A Remotion replay of real bytes, as in the earlier sidecar and
  collections videos.** VHS *does* record on this machine now. This run
  re-checked it, and a one-line tape rendered a GIF. So the replay was a
  choice, not a workaround. A real terminal hard-wraps at the column edge. The
  validate finding here is 131 characters. A VHS capture at any legible size
  would split a token across rows, and design.md check 2 forbids that. The
  replay wraps at spaces only. So the CLI was run under the preload that makes
  stdout/stderr report as a TTY (`media/capture/tty.cjs`), and the bytes were
  saved verbatim (`media/capture-provenance/*.ans`). The composition
  `ProvenanceDemo` (`media/remotion/src/provenance/beats.ts`, shared
  `src/Demo.tsx`) replays them. Typing runs at 35 ms/char, then Enter, then the output after the
  command's **measured** latency. No output byte is edited.
- **`git diff` is captured as `git -c color.ui=always --no-pager diff`.** An
  interactive terminal colours `git diff` and, for 14 lines, prints it without
  a pager. The flags reproduce that for a redirect. The bytes are git's.
- **`media/scratch-provenance/` is the demo repository.** It has its own
  `git init`, because `media/` is gitignored in manni. Nothing was committed
  to manni. One pinned author, `Sam Rivera <sam@example.com>`, makes all three
  commits, with pinned dates (2026-09-10, -11, -12). That is deliberate. Blame
  names a person for every line. So the agent attribution in beat 5 can only
  come from the stamp inside the agent's commit (0046 evidence rule 2). It
  cannot come from an author name or a trailer. There are no trailers and no
  `derive.machines`.
- **Input staged from `test/fixtures/derive/provenance/`.**
  `permissive.schema.json` is copied. `manni.config.yaml` is the fixture's
  config in compact form, without its comment block and without `machines:`,
  which this story never consults. It keeps
  `collections: [{name: site, paths: ["docs/**/*.md"]}]`,
  `meta.schemas: [./permissive.schema.json]`, `meta.derive.fields: [provenance]`
  and `sources: [git]`. The first commit is the fixture's `docs/limits.md`
  minus its three limit lines. The agent's uncommitted edit, shown in beat 1,
  restores the fixture file byte for byte. The agent itself is not filmed.
- **File line numbers move, and the video does not hide it.** The stamp lives
  in the frontmatter, so writing it pushes the body down. `derive` reports
  file lines 9-12 in beat 2, `validate` reports 13-16 in beat 4, and after the
  second entry `get` reports 16 and 18-19. The YAML holds body lines (6-9),
  which is why a stamp never moves its own pin (0046 "The vocabulary"). The
  captions avoid line numbers for that reason.
- **Row highlight is chrome.** A faint accent ground (`#58a6ff` at 16%) sits
  behind the rows a caption is about. The bytes in those rows are untouched.
  In beat 1 the added blank line (`+` alone) is part of the agent's range. It
  is not highlighted, because the substring match cannot tell it from `+++`.

## Derived font size

`media/capture-provenance/cols.mjs` runs the space-only wrap over every real
line from 30 px down. The longest real line is 131 characters (the
`derived:stale` finding), and it wraps. The constraint that decides the size
is the longest **token**. `sha256-76646ebd…f60ec` is 71 characters, and at
the continuation indent of 4 it needs 75 columns. **23 px / 75 columns** is the
largest size at which it fits on one row. At 24 px (72 columns) it would have
to split. The read-back from the render is that the hash row's rightmost ink
sits at x=1053 of 1080. Line height is 32 px. The tallest beat (5) is 18 rows,
576 px of the 838 px available.

## Beats (storyboard)

| # | Title (band) | Terminal | Caption (band) | Length |
|---|---|---|---|---|
| 1 | An agent wrote part of it | `git diff` | An agent just wrote these lines. Once they are committed, nothing records which were its. | 4.7 s |
| 2 | Stamp before committing | `MANNI_GENERATED_BY=claude-fable-5 manni meta derive`, `head -7 docs/limits.md`, `git commit -qam "docs: add the limits"` | derive pins the uncommitted lines to claude-fable-5: a body range and a hash of their text. | 10.7 s |
| 3 | A person edits one line | `sed -i 's/of 20/of 50/' docs/limits.md`, `git diff -U0`, `git commit -qam "docs: raise the burst"` | A person changes one line inside the agent's range, and commits it. | 7.7 s |
| 4 | validate: the pin broke | `manni meta validate`, `echo $?` | The pinned text changed since claude-fable-5 wrote it. validate names the range: exit 1. | 7.3 s |
| 5 | derive re-attributes | `manni meta derive`, `manni meta get provenance docs/limits.md`, `manni meta validate`, `echo $?` | The agent keeps its untouched lines. The edited line is attributed to no machine. Exit 0. | 12.8 s |

Every beat starts on a cleared terminal and cuts to the next, with no
transitions. Beat 1 highlights the three added prose lines. Beat 2 highlights
the derive report row, plus `generated-by`, `lines` and `integrity`. Beat 3
highlights the `-`/`+` pair, beat 4 the `/provenance` finding, and beat 5 the
`get` row.

Thumbnail (`.thumb.png`): frame 455, the end of beat 2, with the stamp on
screen.

## Real output quoted

Beat 2, `MANNI_GENERATED_BY=claude-fable-5 manni meta derive` (exit 0), then `head -7`:

```
Using manni.config.yaml (.)
docs/limits.md
    provenance  lines 9-12: (unset) → claude-fable-5  (git: uncommitted)

1 file, 1 changed, 1 range written
---
title: Rate limits
provenance:
  - generated-by: claude-fable-5
    lines: 6-9
    integrity: sha256-76646ebddee80b427f77f919e4bcde3463a971a929c8b776fc7be0ef477f60ec
---
```

Beat 4, `manni meta validate` after the person's commit (exit 1):

```
Using manni.config.yaml (.)
✗ docs/limits.md
    /provenance  provenance lines 13-16 changed since claude-fable-5 wrote them — run manni meta derive  (line 13)  [derived:stale]

1 file checked, 0 passed, 1 failed, 1 error
```

Beat 5, `manni meta derive` (exit 0), `get` (exit 0), `validate` (exit 0):

```
Using manni.config.yaml (.)
docs/limits.md
    provenance  lines 13-16: claude-fable-5 → re-derived  (git: pin)

1 file, 1 changed, 1 range written
Using manni.config.yaml (.)
docs/limits.md: provenance=lines 16 claude-fable-5; lines 18-19 claude-fable-5 (asserted)
Using manni.config.yaml (.)
✓ docs/limits.md

1 file checked, 1 passed, 0 failed, 0 errors
```

The page afterwards carries two entries, body `lines: 6` and `lines: 8-9`.
Body line 7, file line 17, is `Bursts of 50 are allowed.` and has no entry.
That is the evidence for beat 5's caption claim.

## Timing rules applied

- Typing 35 ms per character (spec: 35-70 ms). The cursor is a solid block
  and does not blink.
- Output appears after the command's real measured latency, taken from the
  capture runs (`media/capture-provenance/latency.txt`) plus three timing runs
  each on a copy. derive 682-708 ms, validate 692-757 ms, get 627-666 ms,
  git diff 43-46 ms, git commit 60-63 ms, sed 32 ms. The replay uses 0.71,
  0.76 and 0.67 s for the manni commands and 2 frames for git.
- Each beat holds 1.6-3.5 s after its main output. Every beat is at least
  4.7 s, so the 67-92 character caption can be read on it.
- No narration, so no loudness pass. The AAC 48 kHz track is silence
  (`anullsrc`), measured on the finished file: integrated -70.0 LUFS (the
  meter's floor) and true peak -inf dBFS.

## Exact commands, as typed in the video

```bash
cd media/scratch-provenance          # its own git repo
git diff
MANNI_GENERATED_BY=claude-fable-5 manni meta derive
head -7 docs/limits.md
git commit -qam "docs: add the limits"
sed -i 's/of 20/of 50/' docs/limits.md
git diff -U0
git commit -qam "docs: raise the burst"
manni meta validate
echo $?
manni meta derive
manni meta get provenance docs/limits.md
manni meta validate
echo $?
```

## Reproduce

```bash
# 1. Demo repository (from media/)
F=../test/fixtures/derive/provenance; S=scratch-provenance
rm -rf $S && mkdir -p $S/docs && cp $F/permissive.schema.json $S/
cat > $S/manni.config.yaml <<'EOF'
collections:
  - name: site
    paths: ["docs/**/*.md"]
meta:
  schemas: [./permissive.schema.json]
  derive:
    fields: [provenance]
    sources: [git]
EOF
grep -v -e 'The limit is' -e 'Bursts of' -e 'A 429' $F/docs/limits.md | cat -s > $S/docs/limits.md
cd $S && git init -q -b main && git config user.name "Sam Rivera" && git config user.email sam@example.com
GIT_AUTHOR_DATE=2026-09-10T10:00:00Z GIT_COMMITTER_DATE=2026-09-10T10:00:00Z git add -A && git commit -qm "docs: rate limits stub"
cp ../$F/docs/limits.md docs/limits.md      # the agent's edit

# 2. Captures (T = node -r ../capture/tty.cjs ../../dist/cli.js)
git -c color.ui=always --no-pager diff > ../capture-provenance/diff1.ans
MANNI_GENERATED_BY=claude-fable-5 $T meta derive > ../capture-provenance/derive1.ans 2>&1
head -7 docs/limits.md > ../capture-provenance/head1.txt
GIT_AUTHOR_DATE=2026-09-11T09:00:00Z GIT_COMMITTER_DATE=2026-09-11T09:00:00Z git commit -qam "docs: add the limits"
sed -i 's/of 20/of 50/' docs/limits.md
git -c color.ui=always --no-pager diff -U0 > ../capture-provenance/diff2.ans
GIT_AUTHOR_DATE=2026-09-12T14:00:00Z GIT_COMMITTER_DATE=2026-09-12T14:00:00Z git commit -qam "docs: raise the burst"
$T meta validate > ../capture-provenance/validate1.ans 2>&1
$T meta derive > ../capture-provenance/derive2.ans 2>&1
$T meta get provenance docs/limits.md > ../capture-provenance/get.ans 2>&1
$T meta validate > ../capture-provenance/validate2.ans 2>&1

# 3. Render and package (from media/remotion)
node scripts/captures-provenance.mjs
npx tsc src/provenance/beats.ts --outDir scripts/out-provenance --module commonjs --target es2020 --resolveJsonModule --esModuleInterop --skipLibCheck
cp src/provenance/captures.json scripts/out-provenance/provenance/
npx remotion render src/index.ts ProvenanceDemo out/provenance/render.mp4
npx remotion still src/index.ts ProvenanceDemo ../provenance-pins-1x1.thumb.png --frame=455
node scripts/vtt-provenance.cjs && node scripts/transcript-provenance.cjs
cd .. && ffmpeg -i remotion/out/provenance/render.mp4 -f lavfi -i anullsrc=r=48000:cl=stereo -shortest -c:v copy -c:a aac -b:a 128k -movflags +faststart provenance-pins-1x1.mp4
ffmpeg -i provenance-pins-1x1.mp4 -vf "fps=12,scale=540:540:flags=lanczos,split[a][b];[a]palettegen=max_colors=128:stats_mode=diff[p];[b][p]paletteuse=dither=none:diff_mode=rectangle" provenance-pins-1x1.gif
```

## Suggested LinkedIn post (text only; posting is the author's call)

> An agent writes three lines of your docs page. A week later someone edits one
> of them. Which lines are still the agent's?
>
> manni meta derive now answers that from git. Set MANNI_GENERATED_BY and run
> derive before you commit. It stamps a `provenance` entry into the page: the
> machine, the body lines, and a sha256 of their text. When a person edits
> inside that range, the pin no longer matches. `manni meta validate` fails
> with derived:stale and exit 1, so CI catches it. Run derive again and it
> re-reads the history. The agent keeps the lines it wrote, and the line a
> person changed is no longer attributed to any machine.
>
> No new verb, no trailer convention, and no commit SHA in the page.
>
> #docsascode #technicalwriting #AI #devtools
