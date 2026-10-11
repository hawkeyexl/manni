# Video script: One command serves any docs site (`manni site preview`)

**Objective:** Show that you no longer need to know a docs framework's serve
command. `manni site preview` finds Starlight in this repository's `docs/`,
runs `npm run build`, then `npm run preview -- --host 127.0.0.1 --port 4321`.
The host and port come from the `site` collection's `url:`, the same key a bare
`manni a11y check` seeds from. So the crawl in a second terminal finds the
server with no flags: `0 violations on 0 of 238 pages`, exit 0.
**Format:** 1080x1080, 30 fps, silent, captions burned in (LinkedIn autoplays muted).
**Duration:** 34.9 s (spec: 20-45 s).
**Audience:** Docs engineers who run the site locally (Maya), and CI engineers
who serve it in a workflow before a check (Devin).
**Feature:** proposal 0082, `docs/proposals/0082-a-site-domain-runs-the-docs-site.md`.
Reference: `docs/src/content/docs/site/reference/cli.mdx`. Branch
`claude/manni-docs-start-subcommand-54c600`, uncommitted on `13a58c0a`
(manni 4.3.0, Node v24.11.0, Astro 7.2.9).

Visual spec: `docs/content-strategy/design.md`. Accent `#58a6ff` (blue), the
series accent. **Not red, green, yellow or cyan**, which manni's own output
uses. Terminal `#171717`, bands `#0d0d0d`, JetBrains Mono throughout. Title
band 112 px, 2 px accent rules, caption band 86 px.

## Re-shoot after the rename

This video was first cut as `docs-preview-1x1`, when the domain was
`manni docs`. The domain is now `manni site`, its config section is `site:`,
and the Hugo fixture moved to `test/fixtures/site/hugo`. Every beat was
captured again with the renamed CLI, and the measured numbers below are from
that run. Beat 1 came back byte for byte identical, since `ls docs` and main's
CI file did not change. The beats, timing rules and look are unchanged.

## How it was made, and what is staged

Everything printed in the terminal is a real run, captured by one script,
`media/capture-site/capture.sh`. It is the record of the staging. There is no
scratch repository: the material is this repository and one fixture.

- **The typed `manni` is the built CLI.** Each run is `node -r
  ./media/capture/tty.cjs dist/cli.js`, so manni believes stdout and stderr are
  a terminal and colours its output as a terminal receives it.
- **The AI-agent environment is removed.** Astro 7 reads `CLAUDECODE`,
  `AI_AGENT` and similar through the `am-i-vibing` package. Inside an agent it
  backgrounds `astro preview` and prints JSON. `media/capture-site/clean-env.sh`
  unsets every `CLAUDE*`, `ANTHROPIC*`, `AI_AGENT`, `AGENT` and `BAGGAGE`
  variable for each run. `am-i-vibing`'s own CLI reports
  `No agentic environment detected` under it. The video therefore shows what a
  person's shell prints.
- **`FORCE_COLOR=1` for the children.** npm and astro are manni's children and
  inherit the capture file, not the preload. `FORCE_COLOR=1` gives them the
  colour a terminal would. No other variable is set.
- **`ls docs` is captured as `ls -C -w 61 docs`.** That is the column layout a
  61-column terminal draws. A file redirect prints one name per line instead.
  `ls` prints no colour here, so none is shown.
- **`git grep` is captured without colour.** A terminal paints the match red,
  and red means failure in manni's output (design.md, "Reserved colours").
- **The second terminal is real concurrency.** The preview ran in the
  background of `capture.sh` while the Hugo build and the crawl ran in the
  foreground, against the live server. That is two terminals in one script.
- **Hugo is not stubbed.** Hugo is not installed on this machine, and the run
  says so: `hugo not found on PATH`, exit 2. No fake `hugo` was put on `PATH`.
  The beat shows detection in a second framework, plus the message a user
  without the CLI gets.
- **The sitemap header is kept.** The built site ships `sitemap-index.xml`
  with production URLs, so against a local preview it yields 0 pages and the
  crawl follows links. The a11y video moved that sitemap aside. This one leaves
  it, so the header reads `(sitemap: ..., 0 pages; followed links)`, wrapped
  over three rows at spaces.
- **Astro's own deprecation notice is kept.** It is about this repository's
  `astro.config.mjs`, it prints on every preview, and it costs four rows.

### The one cut, and the two compressed waits

- **282 build lines are cut, and the cut is marked.** `manni site preview`
  printed 296 lines. Lines 5 to 286 of `media/capture-site/preview.ans` are
  astro's build log. The replay draws one marker in their place:
  `... 282 lines of astro build output cut (16.1 s) ...`. It is in the accent
  colour and in italics. No tool output in frame uses either, so it reads as
  an edit and not as bytes. Every other line is kept, in order, with its colour.
  `media/remotion/scripts/captures-site.mjs` does the cut and computes both
  numbers from the capture.
- **The build wait is compressed, and its real time is on screen twice.** The
  build log ran 16.1 s (stamps 1403 ms to 17488 ms in `preview.stamped`). The
  replay shows it for 1.2 s. The marker states 16.1 s, and astro's own
  `239 page(s) built in 11.98s` line stays in frame.
- **The crawl is compressed, and bash's `time` is in frame.** The real crawl
  took 5m7.493s over 238 pages, cold and uncapped. The replay waits 2.0 s
  between Enter and the output. `time` is typed, and its three lines are in
  frame unedited, which design.md names the strongest form of disclosure.
- **Every other offset is real, at 1x.** `capture.sh` stamps each preview line
  with its millisecond after Enter. The first announce lands at 1151 ms and
  the second at 17522 ms, with the build's 16.1 s compressed as above. Astro's
  `Local` line follows 116 ms after that. The Hugo refusal lands at 1161 ms.

### Rendering

- **A Remotion replay of real bytes, as in the earlier videos.** The
  composition is `SitePreviewDemo`, with beats in
  `media/remotion/src/site/beats.ts` and the shared `src/Demo.tsx`. Typing runs
  at 40 ms per character, then Enter, then the output.
- **Three additions to the shared replay, none of which edits a byte:**
  - `Command.more`: output that lands in chunks, each at its own offset. A
    command that announces a step, works, and prints again needs it.
  - `Command.running`: the command is still running when the beat ends, so no
    prompt returns. That is what a terminal running a server shows.
  - `src/ansi.ts` parses SGR 42 and 49, the green ground behind astro's
    ` astro ` badge, using the palette's own green. It also draws a line that
    starts with the `CUT` sentinel as chrome.
- **Two normalisations, as before:** tabs to 8-column stops (`ls -C`, `time`)
  and CRLF to LF. No visible character is added or removed.
- **Ligatures are off.** JetBrains Mono draws `://`, `--` and `...` as single
  glyphs. A terminal prints the characters.
- **Row highlight is chrome.** A faint accent ground (`#58a6ff` at 16%) sits
  behind the rows a caption is about. The bytes in those rows are untouched.
- **`[build]` is violet, not the accent.** Astro prints its tags in SGR 34,
  which `src/ansi.ts` maps to `#8b7bff` for exactly this reason.

## Derived font size

`media/capture-site/cols.mjs` runs the replay's own space-only wrap over every
real line, from 34 px down. The longest real line is astro's deprecation
notice, 183 characters. The longest token including indent is 46, the sitemap
URL, so tokens never decide the size. Height does. The tallest screen is beat
2, 21 rows at 28 px.

At **28 px / 61 columns** those 21 rows are 819 px of the 838 px usable
terminal box. At 29 px they are 861 px, which overflows. So 28 px is the
largest that fits. Every line either fits 61 columns or wraps at a space. The
widest row is git grep's `run:` line, whose rightmost ink sits at x=1042 of
1080, measured on the render. `ls` was captured at `-w 61` to match that width, and lays out in two
columns there.

## Beats (storyboard)

Four full-frame shots. Beat 4 continues beat 3's screen, the second terminal.

| # | Title (band) | Terminal | Caption (band) | Time |
|---|---|---|---|---|
| 1 | Which command serves it? | `ls docs`, then `git grep -h "npx astro" main -- .github` | An Astro site. On main, CI typed the serve command by hand: astro preview, a host, a port. | 0:00.0-0:08.0 |
| 2 | manni site preview | `manni site preview` (server left running) | It detects Starlight, builds, then serves on the host and port in the site's url: config. | 0:08.0-0:17.0 |
| 3 | Not only Astro | `manni site build test/fixtures/site/hugo` | In a second terminal: Hugo is one of 13 frameworks it detects. Not installed here, and it says so. | 0:17.0-0:24.0 |
| 4 | a11y finds the server | `time manni a11y check -q --no-progress`, `echo $?` | No URL typed. a11y check reads the same url: and crawls the running site. 238 pages, exit 0. | 0:24.0-0:34.9 |

Beat 1 highlights the `run: npx astro preview` line. Beat 2 highlights both
`manni: Starlight` announce lines and the `Local` URL. Beat 3 highlights
`manni: Hugo`. Beat 4 highlights `0 violations on 0 of 238 pages` and
`5m7.493s`.

"13 frameworks" is the only claim not shown on screen. It is carried as
caption. It is checked against `src/site/core/detect.ts`, which lists
Mintlify, Fern, Starlight, Docusaurus, VitePress, Nextra, Fumadocs, Rspress,
MkDocs, Zensical, Sphinx, Hugo and Jekyll.

Thumbnail (`site-preview-1x1.thumb.png`): frame 504, the end of beat 2, with
both announce lines and the `Local` URL on screen.

## Real output quoted

Beat 1, `git grep -h "npx astro" main -- .github`, the step this branch
replaces in `.github/workflows/docs.yml`:

```
        run: npx astro preview --host 127.0.0.1 --port 4321 > ../preview.log 2>&1 &
```

Beat 2, `manni site preview`, with the cut shown as the marker:

```
manni: Starlight in docs/. Running npm run build

> manni-docs@0.0.1 build
> astro build
... 282 lines of astro build output cut (16.1 s) ...
11:42:10 [build] 239 page(s) built in 11.98s
11:42:10 [build] Complete!
manni: Starlight in docs/. Running npm run preview -- --host 127.0.0.1 --port 4321

> manni-docs@0.0.1 preview
> astro preview --host 127.0.0.1 --port 4321

[astro] `markdown.remarkPlugins`, `markdown.rehypePlugins`, and `markdown.remarkRehype` are deprecated. Pass them to `unified({...})` from `@astrojs/markdown-remark` directly instead.
 astro  v7.2.9 ready in 12 ms
┃ Local    http://127.0.0.1:4321/manni
```

Beat 3, `manni site build test/fixtures/site/hugo` (exit 2):

```
manni: Hugo in test/fixtures/site/hugo/. Running hugo
manni: hugo not found on PATH. Install Hugo's CLI, or set site.commands.build.
```

Beat 4, `time manni a11y check -q --no-progress` (exit 0):

```
Checked 238 of 238 pages (sitemap: http://127.0.0.1:4321/manni/sitemap-index.xml, 0 pages; followed links)

0 violations on 0 of 238 pages

real    5m7.493s
user    0m0.045s
sys     0m0.000s
```

## Timing rules applied

- Typing 40 ms per character (spec: 35-70 ms). The cursor is a solid block and
  does not blink.
- Output appears at its measured offset. Two waits are compressed, as the
  disclosure above sets out, and each keeps its real time on screen.
- Beats run 7.0-10.9 s.
- No narration, so no loudness pass. The AAC 48 kHz track is silence
  (`anullsrc`). Measured on the finished file, integrated loudness is -70.0
  LUFS and the peak is -inf dBFS, both the meter's floor.
- Caption cues are one per beat, 7.0-10.9 s each, burned in over two lines of
  about 50 characters. Each cue is a static step title plus caption, not
  speech, so there is nothing to sync against.

## Exact commands, as typed in the video

```bash
ls docs
git grep -h "npx astro" main -- .github
manni site preview
manni site build test/fixtures/site/hugo
time manni a11y check -q --no-progress
echo $?
```

## Reproduce

```bash
# 0. Build the CLI and install the site (repo root). Port 4321 must be free.
npm ci && npm run build
cd docs && npm ci && cd ..

# 1. Every capture (repo root). About five minutes: one build, one real crawl.
#    It starts the preview, runs the rest against it, then stops it with
#    `npx astro preview stop` and checks that 4321 is free.
bash media/capture-site/capture.sh

# 2. Render and package (from media/remotion, after npm install there)
node scripts/captures-site.mjs
node ../capture-site/cols.mjs 28                     # the font-size table
npx tsc src/site/beats.ts --outDir scripts/out-site --module commonjs --target es2020 --resolveJsonModule --esModuleInterop --skipLibCheck
npx remotion render src/index.ts SitePreviewDemo out/site/render.mp4
npx remotion still src/index.ts SitePreviewDemo ../site-preview-1x1.thumb.png --frame=504
node scripts/vtt-site.cjs && node scripts/transcript-site.cjs
cd .. && ffmpeg -i remotion/out/site/render.mp4 -f lavfi -i anullsrc=r=48000:cl=stereo -shortest -c:v copy -c:a aac -b:a 128k -movflags +faststart site-preview-1x1.mp4
ffmpeg -i site-preview-1x1.mp4 -vf "fps=12,scale=540:540:flags=lanczos,split[a][b];[a]palettegen=max_colors=128:stats_mode=diff[p];[b][p]paletteuse=dither=none:diff_mode=rectangle" site-preview-1x1.gif
```

`preview.stamped` ends with one line more than the video uses:
`manni: npm run preview -- --host 127.0.0.1 --port 4321 exited with code 1.`
npm printed it when `capture.sh` stopped the server, after every capture.
`captures-site.mjs` stops at the `Local` line.

The suggested LinkedIn post is `media/site-preview-1x1.post.txt`. Posting is
the author's call.
