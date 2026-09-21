# Video script: Keeping a section out of the crawl (`manni a11y check --exclude`)

**Objective:** Show that `manni a11y check` no longer has to be all or nothing.
A bare run crawls every page this repository's docs site links to, 101 of them,
in 1m46.641s. One `--exclude "/manni/meta/reference/**"` takes the reference
shelf out. That leaves 67 pages in 1m7.458s, and the footer says `34 excluded`.
A pattern that excludes its own seed is then refused with exit 2.
**Format:** 1080x1080, 30 fps, silent, captions burned in (LinkedIn autoplays muted).
**Duration:** 33.4 s (spec: 20-45 s).
**Audience:** CI engineers who gate a pull request on a docs check (Devin, D1
and D3). Also docs engineers who own the site being crawled (Maya).
**Feature:** proposal 0059, `docs/proposals/0059-a11y-crawl-exclusions.md`,
decisions 1, 4, 5 and 7, and rungs 2 and 5 of its ladder. Shipped on
`feature/a11y-exclude` in `43837e2`; the video was made at `5b725ab`.

Visual spec: `docs/content-strategy/design.md`. Accent `#58a6ff` (blue), the
series accent. **Not red, green, yellow or cyan**, which manni's own output
uses. Both footer lines in frame are green, and green is what green means.
Terminal `#171717`, bands `#0d0d0d`, JetBrains Mono throughout. Title band
112 px, 2 px accent rules, caption band 86 px.

## How it was made, and what is staged

Everything printed in the terminal is a real run of `node dist/cli.js a11y
check`, built by `npm run build` from `feature/a11y-exclude` at `5b725ab`
(manni 2.7.0, Node v24.11.0). The typed command reads `manni`, the name the
shim `media/bin/manni` gives the built CLI. `time` is bash's.

- **The site is this repository's own docs, not a mock.** `cd docs && npm run
  build` then `npx astro preview --host 127.0.0.1 --port 4321`, which answers
  at `/manni/`. That is why every pattern in frame starts `/manni/`. The glob
  matches the URL's path, and the base path is part of the path. Proposal 0059
  decision 4 and stress test 2 say why.
- **No URL is typed, and that is not a trim.** `manni.config.yaml` declares a
  `site` collection whose `url:` is `http://127.0.0.1:4321/manni/`. A bare
  `manni a11y check` at the repo root seeds from it. That is the command the
  Docs workflow's `a11y` job runs, so the video shows the real gate.
- **Both crawls are real, cold and uncapped.** No `--max-pages`, no warm cache,
  a real Chromium through Playwright over 101 and then 67 pages. They took
  1m46.641s and 1m7.458s (`media/capture-a11y/latency.txt`).
- **One script takes every capture:** `media/capture-a11y/capture.sh`. It is
  the record of the staging. There is no scratch repository for this demo,
  because the material is the repository itself.
- **manni's bytes come from the TTY preload.** Each run went through
  `media/capture/tty.cjs`, which makes stdout and stderr report as a terminal,
  so the colour in the capture is the colour a terminal receives. That is why
  both footers are green.
- **`--no-progress` is typed, and it is load-bearing.** The preload says stdout
  is a terminal, so progress is on by default, and progress on a 101-page crawl
  is 202 lines. The flag is in frame rather than applied off-screen.
- **The sitemap is moved aside for the capture, and this is the one staging
  that changes what the tool prints.** The built site ships
  `sitemap-index.xml`, and every `<loc>` in it is a production
  `hawkeyexl.github.io` URL. Against a local preview it parses and yields
  nothing. The run then prints `(sitemap: http://127.0.0.1:4321/manni/sitemap-index.xml,
  0 pages; followed links)`. That is 106 characters, three wrapped rows in a
  square frame, about a sitemap that supplied no pages. `capture.sh` moves the
  two sitemap files out of `docs/dist` for the run and puts them back. The
  header then reads `(no sitemap; followed links)`, which is true of what was
  run. Discovery is unchanged. Link-following found all 101 pages either way,
  checked both ways before the capture. Nothing about `--exclude` depends on a
  sitemap. Staging input is allowed by design.md's "Honesty" section. Faking
  output is not, and no output byte is edited.
- **The wait is compressed, and the real time is on screen.** 1m46.641s and
  1m7.458s do not fit a 33-second video. design.md allows compressing static
  wait only, provided the real elapsed time is disclosed. It says bash's own
  `time` output in frame is the strongest form of that. So `time` is typed, and
  its three lines are in frame for both runs, unedited. The replay shortens the
  gap between Enter and the output by **one factor, 1/53.3, applied to both
  runs**. The replay's own rhythm therefore keeps the ratio the real runs had,
  2.00 s against 1.27 s. Typing and output are 1x. The refusal in beat 4 is not
  compressed, because 532 ms is already shorter than the pause before Enter.
- **A Remotion replay of real bytes, as in the earlier videos.** The refusal
  runs to 106 characters and the second command to 76. A real terminal at a
  phone-legible size hard-wraps those inside a token, which design.md check 2
  forbids. The replay wraps at spaces only. The composition `A11yExcludeDemo`
  (`media/remotion/src/a11y/beats.ts`, shared `src/Demo.tsx`) replays the
  bytes. Typing runs at 40 ms/char, then Enter, then the output.
- **Two renderings applied to the captured bytes, no edits.**
  `media/remotion/scripts/captures-a11y.mjs` expands `time`'s tab to the
  terminal's own 8-column stops, and applies the `\r\x1b[2K` the progress
  spinner writes before the refusal prints. `src/ansi.ts` parses SGR and
  nothing else, so both are done there instead, the way
  `media/capture-term/pty-screen.mjs` applies ConPTY's cursor moves. No visible
  character is added or removed.
- **Ligatures are off for this video.** JetBrains Mono draws `://` and `**` as
  single glyphs. A terminal prints the characters.
- **Row highlight is chrome.** A faint accent ground (`#58a6ff` at 16%) sits
  behind the rows a caption is about. The bytes in those rows are untouched.
- **The site has no accessibility violations, and the video says so twice.**
  Both footers read `0 violations`. This demo is about crawl scope and crawl
  cost, not about findings. Nothing was hidden to reach zero: `-q` hides the
  101 and 67 passing page lines, and the counts in the footer are the run's.

## Derived font size

`media/capture-a11y/cols.mjs` runs the replay's own space-only wrap over every
real line, from 34 px down. The longest real line is the refusal, 106
characters. The longest token including indent is 44, the seed URL, so the
token never decides the size. Height does. Beats 1 to 3 share one screen,
because 2 and 3 continue from 1. That screen is 18 rows at every size from
32 px down.

At **32 px / 54 columns** those 18 rows are 810 px of the 878 px terminal box,
leaving 34 px above and below. At 33 px they are 19 rows and 874 px, which
overflows. So 32 px is the largest that fits, and it is the largest any video
in this series has used. Every line either fits 54 columns or wraps at a space.
The header is 52 and the first command 40. The second command wraps after
`--exclude`, and the refusal wraps after `excludes`. The read-back from the
render is that the widest row's rightmost ink sits at x=1037 of 1080.

## Beats (storyboard)

Four static full-frame shots. Beats 2 and 3 continue beat 1's screen, so both
runs are in frame together. The numbers can then be compared without
remembering anything. Beat 4 starts on a cleared terminal.

| # | Title (band) | Terminal | Caption (band) | Time |
|---|---|---|---|---|
| 1 | Every page, every time | `time manni a11y check -q --no-progress` | manni a11y check crawls every page the site links to. 101 pages, 1 minute 47, every pull request. | 0:00.0-0:08.0 |
| 2 | One glob, one section | `time manni a11y check -q --no-progress --exclude "/manni/meta/reference/**"` | --exclude takes a glob matched against the URL path. Here it drops the reference shelf. | 0:08.0-0:16.9 |
| 3 | 34 pages never fetched | (no new command; the same screen, re-captioned) | 67 pages checked, 34 excluded, 39 seconds saved. An excluded URL is never fetched and never counted. | 0:16.9-0:21.3 |
| 4 | Seed and pattern disagree | `manni a11y check http://127.0.0.1:4321/manni/meta/reference/ --exclude "/manni/meta/reference/**"`, `echo $?` | A seed the pattern excludes is a contradiction. manni refuses with exit 2, before anything loads. | 0:21.3-0:33.4 |

Beat 1 highlights the footer and `1m46.641s`. Beat 2 highlights the typed
`--exclude` line and `Checked 67 of 67 pages`. Beat 3 highlights
`0 violations on 0 of 67 pages; 34 excluded` and `1m7.458s`. Beat 4 highlights
the refusal.

Thumbnail (`.thumb.png`): frame 620, the end of beat 3, with both runs and both
elapsed times on screen.

## Real output quoted

Beat 1, `time manni a11y check -q --no-progress` (exit 0):

```
Checked 101 of 101 pages (no sitemap; followed links)

0 violations on 0 of 101 pages

real    1m46.641s
user    0m0.015s
sys     0m0.000s
```

Beat 2, the same with `--exclude "/manni/meta/reference/**"` (exit 0):

```
Checked 67 of 67 pages (no sitemap; followed links)

0 violations on 0 of 67 pages; 34 excluded

real    1m7.458s
user    0m0.000s
sys     0m0.015s
```

The same run as `-f json` gives the same count on `summary`
(`media/capture-a11y/excluded.json`):

```json
{ "discovered": 67, "checked": 67, "skipped": 0, "duplicates": 0,
  "excluded": 34, "failed": 0, "violations": 0, "sitemap": null,
  "sitemapPages": 0, "crawl": true }
```

`checked + skipped + duplicates === discovered` still holds at 67, and
`excluded` sits outside it, which is decision 7.

Beat 4, the seed clash (exit 2):

```
manni: --exclude "/manni/meta/reference/**" excludes the seed http://127.0.0.1:4321/manni/meta/reference/.
```

## What the numbers are

| | Pages checked | Excluded | Wall clock |
|---|---|---|---|
| Bare `manni a11y check` | 101 | 0 | 1m46.641s |
| With `--exclude "/manni/meta/reference/**"` | 67 | 34 | 1m7.458s |

34 pages and 39.183 seconds, on a 101-page site. The 34 are the reference
shelf under `docs/src/content/docs/meta/reference/`, 15 of which are the
generated glossary termbase that `manni term write` produces.

## Timing rules applied

- Typing 40 ms per character (spec: 35-70 ms). The cursor is a solid block and
  does not blink.
- Output appears after the command's real latency. One factor compresses both
  crawls and the refusal runs at 1x, as the disclosure above sets out.
- Beats run 4.4-12.1 s. Beat 3 carries no command, only a new title and
  caption over beat 2's screen, and holds 4.4 s.
- No narration, so no loudness pass. The AAC 48 kHz track is silence
  (`anullsrc`), measured on the finished file: integrated -inf LUFS and true
  peak -inf dBTP, both the meter's floor.
- Caption cues are one per beat, 4.4-12.1 s each, burned in over two lines of
  about 50 characters. Each cue is a static step title plus caption, not
  speech, so there is nothing to sync against.

## Exact commands, as typed in the video

```bash
time manni a11y check -q --no-progress
time manni a11y check -q --no-progress --exclude "/manni/meta/reference/**"
manni a11y check http://127.0.0.1:4321/manni/meta/reference/ --exclude "/manni/meta/reference/**"
echo $?
```

## Reproduce

```bash
# 0. Build the CLI and the docs site (repo root)
npm ci && npm run build
cd docs && npm ci && npm run build
npx astro preview --host 127.0.0.1 --port 4321      # answers at /manni/

# 1. Every capture (repo root). About four minutes: two real crawls.
bash media/capture-a11y/capture.sh
node capture-a11y/cols.mjs 32                       # run from media/: the font-size table

# 2. Render and package (from media/remotion, after npm install there)
node scripts/captures-a11y.mjs
npx tsc src/a11y/beats.ts --outDir scripts/out-a11y --module commonjs --target es2020 --resolveJsonModule --esModuleInterop --skipLibCheck
cp src/a11y/captures.json scripts/out-a11y/a11y/
npx remotion render src/index.ts A11yExcludeDemo out/a11y/render.mp4
npx remotion still src/index.ts A11yExcludeDemo ../a11y-exclude-1x1.thumb.png --frame=620
node scripts/vtt-a11y.cjs && node scripts/transcript-a11y.cjs
cd .. && ffmpeg -i remotion/out/a11y/render.mp4 -f lavfi -i anullsrc=r=48000:cl=stereo -shortest -c:v copy -c:a aac -b:a 128k -movflags +faststart a11y-exclude-1x1.mp4
ffmpeg -i a11y-exclude-1x1.mp4 -vf "fps=12,scale=540:540:flags=lanczos,split[a][b];[a]palettegen=max_colors=128:stats_mode=diff[p];[b][p]paletteuse=dither=none:diff_mode=rectangle" a11y-exclude-1x1.gif

# 3. Stop the preview
cd docs && npx astro preview stop
```

The suggested LinkedIn post is `media/a11y-exclude-1x1.post.txt`. Posting is
the author's call.
