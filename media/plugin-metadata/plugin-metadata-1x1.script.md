# Demo beat sheet for the plugin's page metadata and MCP graph server

- **Type.** A feature demo (`feat(plugin)`, proposal 0103), as a terminal session. Captions carry it
  with no narration, because LinkedIn autoplays muted.
- **Audience:** docs engineers who let Claude Code read and edit their docs, and the CI engineers who
  set that up. Phone-sized, muted.
- **Target:** 40.8 s, five beats, one caption each.
- **Objective:** the viewer sees an agent that reads a docs page get handed the page's metadata. That
  includes the fields kept in a sidecar file the Read never shows, and it comes again when they change. The new `manni meta get --all-fields` flag is the same lookup. The plugin also serves the docs
  graph over MCP and publishes it by itself on first use.
- **Assets:** `media/plugin-metadata/plugin-metadata-1x1.mp4` (not committed), `.gif`, `.thumb.png`,
  `.vtt`, `.transcript.txt`, `.post.txt`, this file, `media/plugin-metadata/capture/`,
  `media/plugin-metadata/repo/`, `media/remotion/src/plugin-metadata/`, and
  `media/remotion/scripts/{captures,vtt,transcript}-plugin-metadata.*`.
- **Look:** `docs/content-strategy/design.md`. 1080x1080, 30 fps, title band 112 px with `n / 5`
  counter, caption band 86 px, accent `#58a6ff` blue (never red, green, yellow or cyan). The only colour
  in the terminal is the dim file prefix on `meta get`'s rows.
- **Material.** A scratch repository (`media/scratch-plugin-metadata/`, staged from `repo/`): one
  collection `site` over `docs/**/*.md`, `externalMetadata: [{ file: "{page}.meta.yaml", keys: [owner,
  eval-suite] }]`, two short pages and one sidecar, `docs/limits.meta.yaml`. Its own `git init` and one
  commit. Nothing is written into this checkout's docs or `docs/public/graph/`.

| # | Time | Title band | Caption band | Typed | On screen |
|---|---|---|---|---|---|
| 1 | 0:00-0:08 | Fields a Read never shows | owner and eval-suite live in a sidecar. Reading the page alone never shows them. | `head -4 docs/limits.md`, `cat docs/limits.meta.yaml` | the page's frontmatter holds `title` and `description`; the sidecar holds `owner` and `eval-suite` (marked) |
| 2 | 0:08-0:14 | manni meta get --all-fields | The new flag prints every stored field, page and sidecar alike. | `manni meta get --all-fields --no-derived docs/limits.md` | four rows, `owner` and `eval-suite` marked |
| 3 | 0:14-0:21 | What the Read hook adds | When the agent reads the page, the plugin's hook hands it the metadata, sidecar included. | `read-page docs/limits.md` | `Metadata for docs/limits.md, from the page and its sidecars:` and one JSON line |
| 4 | 0:21-0:32 | Once, then on change | A second Read adds nothing. Change the sidecar and the next Read says so. | `read-page docs/limits.md`, `sed -i 's/platform-docs/docs-team/' docs/limits.meta.yaml`, `read-page docs/limits.md` | nothing; then `Metadata for docs/limits.md changed since it was last given here. This replaces it:` with `owner` now `docs-team` |
| 5 | 0:32-0:41 | The graph, over MCP | The plugin's MCP server publishes the graph on first use, then answers from it. | `mcp-call lookup "What is the fetch timeout?"` | `publishing the graph before serving it: ... does not exist.`, `published the graph in 0.7s.`, `serving lookup, retrieve, traverse and impact ...`, then the answer naming `docs/limits.md:1-4` |

Beat 4 continues beat 3's screen, so the first read's output is still above the second read that prints
nothing.

## Why this story

The feature is not a new command. It is that an agent no longer has to know a sidecar exists. Beat 1
shows the gap the way the agent sees it: the page alone. Beat 2 shows the flag that closes it for a
person. Beat 3 shows the same lookup arriving in the agent's context on a Read. Beat 4 shows the two rules
that keep it from becoming noise. It comes once per page, and again only on change. Beat 5 is the second
half of the change, the graph over MCP with no setup step.

## What is staged and what is real

- **`read-page` is a short helper** (`repo/read-page.mjs`). It builds the `PostToolUse` envelope Claude
  Code sends after a Read (`hook_event_name`, `tool_name: "Read"`, `session_id`, `tool_input.file_path`,
  `cwd`), pipes it into the plugin's real `plugin/manni/hooks/page-metadata.mjs`, and prints the
  `additionalContext` text the hook returns. Nothing in that text is written by the helper. It prints
  nothing when the hook says nothing, which is beat 4's second read. Each capture run uses a fresh
  `session_id`, so the hook has given that session nothing before beat 3.
- **`mcp-call` is a short helper** (`repo/mcp-call.mjs`). It starts the plugin's real
  `plugin/manni/hooks/graph-server.mjs` as an MCP client would, over stdio, sends `initialize` and one
  `tools/call`, and lets the server's stderr through untouched. The tool answers with JSON; the helper
  prints the best passage as `lookup: <page>:<lines>  <text>`. That last line is the helper's rendering
  of the tool's answer, and the transcript says so.
- **One edit.** After the first line the server prints two more notices, about the docevals report
  and the vector sidecar. They are long, and the frame is phone-sized.
  The composition replaces them with one marker line, `... 2 advisory lines left out`. It is drawn in
  the accent blue and in italic, like the site-preview video's cut marker, so it cannot be read as output.
  `captures-plugin-metadata.mjs` fails if those are not the two lines it is cutting. The full bytes are in
  `capture/graph.ans` and `capture/graph.times`.
- **The republish is not in the video.** `republishing the graph: the checkout changed since the last
  publish.` needs one server answering two calls with an edit between them. A second `mcp-call` starts a
  new server, which would print the other notice (`publishing the graph before serving it: the working
  tree has changes`). A claim that is not shown is not made, so the caption says only "on first use".
- `manni` is `node -r media/capture/tty.cjs node_modules/@hawkeyexl/manni/dist/cli.js`, which only tells
  the CLI that stdout is a terminal so colour is emitted. `node_modules/@hawkeyexl/manni` is a junction
  to this checkout's root, so the hooks resolve this branch's build the way an install would. The version
  line reads `4.18.0` (`capture/version.txt`), build commit in `capture/build-commit.txt`.
- `--no-derived` in beat 2 is the flag the hook passes. Without it, `get` also prints `created`,
  `last-updated` and `authors` read from the scratch repo's one commit, which would bury the two rows the
  caption is about.
- The data directory the plugin publishes into is `media/scratch-pd/` (`CLAUDE_PLUGIN_DATA`), also
  ignored by `media/scratch-*/`.

## Capture notes

- **Font size is derived, not chosen** (`node plugin-metadata/capture/cols.mjs 28`, run from `media/`).
  The longest real line is the server's `serving ...` notice at 118 characters, which breaks at a space.
  The longest unbreakable token is the artifact path, `../scratch-pd/graph/b1148b99811b127b/chunks.json`,
  at 49. The longest typed line is `manni meta get --all-fields --no-derived docs/limits.md`, at 60 with its
  prompt. The `sed` line is 59. 28 px gives 61 columns. That is the largest size where both fit on one
  row, with the fewest orphaned words (4, against 7 at 29 px). The JSON context line (102 characters)
  breaks at a space inside the description, and every token on both rows fits. The tallest beat is 12
  rows, 468 px of 838.
- Measured latency is in `capture/latency.txt` and `capture/graph.times`. `meta get` took 298-335 ms
  and the Read hook 407-500 ms. The MCP server's first line came 855 ms after Enter, and the rest 654 ms
  later. The replay uses
  the slower end of each, so output never lands sooner than it did. Nothing is sped up.
- Typing is 36 ms per character, the fast end of design.md's 35-70 ms. The longest typed line is 60
  characters, and the video has five beats.
- The audio track is silent AAC, as in the earlier videos. There is nothing to loudness-normalise (the
  finished file measures -70 LUFS, which is the silence).

## How to rebuild it

```bash
# from the repo root
npm run build
cd media
bash plugin-metadata/capture/capture.sh        # stages scratch-plugin-metadata/, captures every byte
node plugin-metadata/capture/cols.mjs 28       # re-derive the font size

cd remotion
npm ci
node scripts/captures-plugin-metadata.mjs      # captures -> src/plugin-metadata/captures.json
npx remotion render PluginMetadataDemo ../plugin-metadata/raw.mp4
ffmpeg -i ../plugin-metadata/raw.mp4 -f lavfi -i anullsrc=r=48000:cl=stereo -shortest -c:v copy -c:a aac -b:a 64k \
  ../plugin-metadata/plugin-metadata-1x1.mp4 && rm ../plugin-metadata/raw.mp4
npx remotion still PluginMetadataDemo ../plugin-metadata/plugin-metadata-1x1.thumb.png --frame=950

# timings for the sidecars come from the same beats the composition uses
npx tsc src/plugin-metadata/beats.ts src/beats.ts --outDir scripts/out-plugin-metadata \
  --module commonjs --target ES2022 --moduleResolution node \
  --resolveJsonModule --esModuleInterop --skipLibCheck
cd scripts && node vtt-plugin-metadata.cjs && node transcript-plugin-metadata.cjs

# GIF, for hosts that will not take an MP4
cd ../../plugin-metadata && ffmpeg -i plugin-metadata-1x1.mp4 -vf "fps=12,scale=540:540:flags=lanczos,split[a][b];[a]palettegen=max_colors=128:stats_mode=diff[p];[b][p]paletteuse=dither=none:diff_mode=rectangle" plugin-metadata-1x1.gif

rm -rf ../scratch-plugin-metadata ../scratch-pd   # the staged repo and its data directory are disposable
```

Thumbnail (`.thumb.png`): frame 950, the end of beat 4. The changed-since line is marked and `owner` reads
`docs-team`.

## Suggested LinkedIn caption (do not post; hand over)

See `plugin-metadata-1x1.post.txt`.
