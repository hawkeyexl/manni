# Video script: Terms as a Vale style (`manni term write -f vale`)

**Objective:** Show that one glossary drives Vale. `manni term write -f vale`
turns the glossary's terms into a Vale style named `Terms`. Once the style is
wired, `vale` flags a guide for three terminology mistakes, with exit 1. They
are an acronym used before it is spelled out, a retired name, and a term in the
wrong case. Then the same glossary renders as one Markdown page per term.
**Format:** 1080x1080, 30 fps, silent, captions burned in (LinkedIn autoplays muted).
**Duration:** 38.7 s (spec: 20-45 s).
**Audience:** docs engineers who own a docset's terminology (Maya) and CI
engineers who run Vale on every pull request (Devin).
**Feature:** proposal 0052, `docs/proposals/0052-term-domain.md`, Decision 5
and 6, and rungs 8 and 10 of the ladder.

Visual spec: `docs/content-strategy/design.md`. Accent `#58a6ff` (blue). Never
red, green, yellow or cyan, which manni's and Vale's output use. Vale prints
`warning` in yellow and `error` in red. Terminal `#171717`, bands `#0d0d0d`,
JetBrains Mono throughout. Title band 112 px, 2 px accent rules, caption band
86 px.

**Vale also prints blue.** Its summary line colours `0 suggestions` with ANSI
34. A terminal draws that in its own shade of blue, and some themes use exactly
`#58a6ff`. The replay draws ANSI 34 as `#8b7bff`, a violet-leaning blue at
5.4:1 on `#171717`. So the count never reads as chrome, and the accent stays
the series accent. The earlier videos never printed ANSI 34, so they are
unaffected.

## How it was made, and what is staged

Everything printed in the terminal is a real run of `cat`, `sed`, Vale 3.20.0,
or `node dist/cli.js`. The CLI was built by `npm run build` from the `tool/term`
branch at `49f63a0`. The typed command reads `manni`, the name the shim
`media/bin/manni` gives the built CLI.

- **A Remotion replay of real bytes, as in the earlier videos.** Vale's
  findings run to 101 characters. A real terminal at a phone-legible size
  hard-wraps them inside a token, which design.md check 2 forbids. The replay
  wraps at spaces only. The composition `TermDemo`
  (`media/remotion/src/term/beats.ts`, shared `src/Demo.tsx`) replays the
  bytes. Typing runs at 35 ms/char, then Enter, then the output after the
  command's **measured** latency. No output byte is edited.
- **manni's bytes come from the TTY preload.** `manni term write` ran under
  `media/capture/tty.cjs`, which makes stdout and stderr report as a terminal.
  Its output carries no colour either way.
- **Vale's bytes come from a real pseudo-terminal.** Vale colours only on a
  terminal and has no flag to force it, and a Go binary cannot take the Node
  preload. So `media/capture-term/pty.mjs` runs Vale inside ttyd, which gives
  it a ConPTY, and saves every byte ttyd relays (`vale-pty.raw`). ConPTY
  re-renders output with cursor moves rather than blank lines and spaces.
  `media/capture-term/pty-screen.mjs` applies those moves to a grid and keeps
  each colour sequence where it landed. The result is `vale.ans`. The same step
  then checks it against a plain run of Vale into a pipe (`vale-plain.ans`).
  With colour removed the two must match line for line, or the capture fails.
  They match.
- **One script builds the repository and takes every capture:**
  `media/capture-term/capture.sh`. It is the record of the staging.
- **`media/scratch-term/` is the demo repository.** It has its own `git init`,
  with one commit by a pinned author and date. `media/scratch-*` is gitignored
  in manni, and discovery honours `.gitignore`. Nothing was committed to manni.
- **Input staged from `test/fixtures/term/cli/failing/`.** The fixture's
  `progressive lens` entry keeps its alt-label `PAL` and its hidden-label
  `no-line bifocal`, and `corrective lens` stays beside it. Both are held in
  one term manifest, `glossary.yaml`, so the whole glossary fits one short
  screen. The definitions are shortened to fit one row each. The guide keeps the
  fixture guide's title, and its body holds the three mistakes.
- **The glossary is a YAML manifest, not a DocBook `<glossary>`.** The brief
  suggested DocBook. A DocBook glossary has no hidden-label (proposal 0052
  Decision 4), so it cannot say that a name is retired. The retired-name
  finding could not happen. A manifest carries every field.
- **Two config files are staged and not shown.** `manni.config.yaml` holds
  `term.manifests: [glossary.yaml]`, which is how `manni term write` finds the
  manifest with no path given. `.vale.ini` holds `StylesPath = styles` and a
  `[*.md]` section with `BasedOnStyles = Vale`. Beat 3's `sed` adds `Terms` to
  that line, which is the line the beat 2 notice asks for.
- **Vale prints `docs\fitting.md`** with a backslash, because it ran on
  Windows. That is what it printed, so the video keeps it.
- **Ligatures are off for this video.** JetBrains Mono draws `/=` in the `sed`
  command as a slashed equals sign, and `---` as one rule. A terminal prints
  the characters. `DemoView` takes `ligatures={false}` for this composition
  only, so the earlier compositions render as before.
- **Row highlight is chrome.** A faint accent ground (`#58a6ff` at 16%) sits
  behind the rows a caption is about. The bytes in those rows are untouched.

## Derived font size

`media/capture-term/cols.mjs` runs the replay's own space-only wrap over every
real line from 30 px down. The longest real line is 101 characters, the
`Terms.PAL` finding with Vale's column padding. The longest token plus indent
is 30, and no beat needs more than 20 rows, so neither decides the size.
Vale's layout does. Each finding is the location, the level, the message,
padding, then the rule name. At **21 px / 82 columns** every message fits its
first row, and only the rule name moves to the next. The widest row is
` 5:6   error    Write 'Progressive Lens' in lowercase, except to start a sentence.`,
82 characters. At 22 px (78 columns) the `5:6` message itself breaks before
`sentence.`. Line height is 32 px, and the tallest beat (2) is 17 rows, 544 px
of the 838 px available. The read-back from the render is that the widest row's
rightmost ink sits at x=1047 of 1080.

## Beats (storyboard)

Four static full-frame shots. Every beat starts on a cleared terminal and cuts
to the next, with no transitions.

| # | Title (band) | Terminal | Caption (band) | Time |
|---|---|---|---|---|
| 1 | One glossary, one guide | `cat glossary.yaml`, `cat docs/fitting.md` | The glossary defines progressive lens, its acronym and a retired name. The guide gets all three wrong. | 0:00.0-0:08.3 |
| 2 | Glossary to Vale style | `manni term write -f vale`, `cat styles/Terms/PAL.yml` | manni term write -f vale turns the terms into Vale rules, one per kind of mistake. | 0:08.3-0:18.0 |
| 3 | Vale catches all three | `sed -i 's/= Vale$/= Vale, Terms/' .vale.ini`, `vale docs/fitting.md`, `echo $?` | Add Terms to .vale.ini as the notice says. Vale flags the acronym, the old name and the casing: exit 1. | 0:18.0-0:28.9 |
| 4 | Same terms, new format | `manni term write -f markdown -o docs/terms/`, `cat docs/terms/progressive-lens.md` | The same glossary, rendered as Markdown: one page per term, every field kept. | 0:28.9-0:38.7 |

Beat 1 highlights `alt-labels`, `hidden-labels` and the three guide lines.
Beat 2 highlights the three rule files and the `first:` and `second:` patterns.
Beat 3 highlights the three findings, and beat 4 the write report and the
carried `PAL` and `no-line bifocal`.

Thumbnail (`.thumb.png`): frame 850, the end of beat 3, with the three findings
and `1` on screen.

## Real output quoted

Beat 2, `manni term write -f vale` (exit 0):

```
Wrote 2 terms to styles/Terms
  Lowercase.yml   2 terms
  Deprecated.yml  1 swap
  PAL.yml         1 acronym
notice: no section of .vale.ini uses the Terms style. Add it to BasedOnStyles:
  [*.md]
  BasedOnStyles = Vale, Terms
```

Beat 3, `vale docs/fitting.md` (exit 1):

```

 docs\fitting.md
 3:27  warning  Spell out 'PAL' on first use, as 'progressive lens (PAL)'.          Terms.PAL
 4:3   warning  Use 'progressive lens' instead of 'no-line bifocal'.                Terms.Deprecated
 5:6   error    Write 'Progressive Lens' in lowercase, except to start a sentence.  Terms.Lowercase

✖ 1 error, 2 warnings and 0 suggestions in 1 file.
```

Beat 4, `manni term write -f markdown -o docs/terms/` (exit 0):

```
Wrote 2 terms to docs/terms/, one file each
```

## Timing rules applied

- Typing 35 ms per character (spec: 35-70 ms). The cursor is a solid block
  and does not blink.
- Output appears after the command's real measured latency, from the capture
  run plus three timing runs (`media/capture-term/latency.txt`).
  `term write -f vale` took 533-548 ms, `vale` 120-126 ms and
  `term write -f markdown` 481-512 ms. The replay uses 0.55, 0.13 and 0.52 s,
  and 1-2 frames for `cat`, `sed` and `echo`.
- Beats run 8.3-10.8 s. Each holds 3.4-4.2 s after its main output, so the
  77-103 character caption can be read on it.
- No narration, so no loudness pass. The AAC 48 kHz track is silence
  (`anullsrc`), measured on the finished file: integrated -70.0 LUFS (the
  meter's floor) and true peak -inf dBFS.
- Caption cues are one per beat, 8.3-10.8 s each, burned in over two lines of
  about 55 characters. That is longer per cue and per line than broadcast
  caption guidance (6-7 s, about 42 characters). It matches the band the
  earlier videos use. Each cue is a static step title plus caption, not
  speech, so there is nothing to sync against.

## Exact commands, as typed in the video

```bash
cd media/scratch-term          # its own git repo
cat glossary.yaml
cat docs/fitting.md
manni term write -f vale
cat styles/Terms/PAL.yml
sed -i 's/= Vale$/= Vale, Terms/' .vale.ini
vale docs/fitting.md
echo $?
manni term write -f markdown -o docs/terms/
cat docs/terms/progressive-lens.md
```

## Reproduce

```bash
# 0. Build the CLI (repo root). Vale and ttyd on PATH.
npm ci && npm run build

# 1. Demo repository and every capture (from anywhere)
bash media/capture-term/capture.sh            # ends by drawing vale.ans and checking it
node media/capture-term/cols.mjs 21         # run from media/: the font-size table

# 2. Render and package (from media/remotion, after npm ci there)
node scripts/captures-term.mjs
npx tsc src/term/beats.ts --outDir scripts/out-term --module commonjs --target es2020 --resolveJsonModule --esModuleInterop --skipLibCheck
cp src/term/captures.json scripts/out-term/term/
npx remotion render src/index.ts TermDemo out/term/render.mp4
npx remotion still src/index.ts TermDemo ../term-vale-1x1.thumb.png --frame=850
node scripts/vtt-term.cjs && node scripts/transcript-term.cjs
cd .. && ffmpeg -i remotion/out/term/render.mp4 -f lavfi -i anullsrc=r=48000:cl=stereo -shortest -c:v copy -c:a aac -b:a 128k -movflags +faststart term-vale-1x1.mp4
ffmpeg -i term-vale-1x1.mp4 -vf "fps=12,scale=540:540:flags=lanczos,split[a][b];[a]palettegen=max_colors=128:stats_mode=diff[p];[b][p]paletteuse=dither=none:diff_mode=rectangle" term-vale-1x1.gif
```

The suggested LinkedIn post is `media/term-vale-1x1.post.txt`. Posting is the
author's call.
