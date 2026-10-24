# Demo beat sheet for author-facing content in the graph (proposal 0110)

- **Type.** A feature demo (`feat(graph)`, proposal 0110), as a terminal session.
  Captions carry it with no narration, because LinkedIn autoplays muted.
- **Audience:** Sara, who holds pages to their strategy, and Maya, who lets an
  agent work on the docs. Phone-sized, muted.
- **Target:** 44.8 s, four beats, one caption each.
- **Objective:** the viewer sees three things. A default build types this
  repository's 82 strategy records and links each page to the records it
  names. `--no-authoring` builds a graph of what readers see, with no
  records and no author-facing fields. The plugin's server publishes into
  its own data directory, outside the repository.
- **Assets:** `graph-authoring-1x1.mp4` (not committed), `.thumb.png`, `.vtt`,
  `.srt`, `.transcript.txt`, `.post.txt`, this file, and
  `capture-graph-authoring/`. In `media/remotion/`, the files are
  `src/graph-authoring/`, `scripts/{captures,vtt,transcript}-graph-authoring.*`
  and the `GraphAuthoringDemo` composition in `src/Root.tsx`. No GIF and no
  storyboard. The brief asked for neither, and one shot type, a terminal,
  needs no plan beyond this table.
- **Look:** `docs/content-strategy/design.md`. 1080×1080, 30 fps, title band
  112 px with an `n / 4` counter, caption band 86 px, accent `#58a6ff` blue.
  Never red, green, yellow or cyan. The terminal output carries no colour.
- **Material:** this repository itself, run from its root. It holds 344 pages,
  82 of them strategy records. The graphs land in `.manni/graph/internal/`
  and `.manni/graph/readers/`, which `.gitignore` covers. Nothing is staged.

| # | Time | Title band | Caption band | Typed | On screen |
|---|---|---|---|---|---|
| 1 | 0:00–0:09 | Records in the graph | The default build types this repository's 82 strategy records as audiences, personas and journeys. | `time manni graph publish -o .manni/graph/internal` | the build line `344 pages, 23413 triples, 82 strategy records` (marked), the exports, `real 0m11.687s` |
| 2 | 0:09–0:20 | Which pages serve D11? | Walk back from journey D11 along dcterms:isPartOf. Its four pages are the ones strategy get lists. | `manni graph traverse -g .manni/graph/internal/graph.ttl https://hawkeyexl.github.io/manni/id/strategy/journey/d11 --reverse --predicates dcterms:isPartOf` | D11 and its title, then four page IRIs with their titles (marked), `5 nodes, 4 hops, 0 excluded` |
| 3 | 0:20–0:34 | A graph for readers | --no-authoring leaves out the records and the author-facing fields. Not one created date is left. | `time manni graph publish --collection site --no-authoring -o .manni/graph/readers`, then `manni graph query -g .manni/graph/readers/graph.ttl --predicate dcterms:created` | the build line `262 pages, 21021 triples` with no records clause (marked), `real 0m9.111s`, `No matches.` (marked) |
| 4 | 0:34–0:45 | The plugin's own directory | The plugin's server publishes into its own data directory, outside the repository. | `node plugin/manni/hooks/graph-server.mjs < /dev/null` | the publishing line naming `…/Temp/manni/graph/1b1e36253fe824df/chunks.json` (marked), `published the graph in 11.0s`, the serving line naming the same directory (marked) |

Exact cue times are in `graph-authoring-1x1.vtt` and `.srt`, generated from
the beats the composition renders.

## Why this story

The feature splits what a page carries from what its author keeps. Beat 1
shows the default, which keeps both. The build line names the records it
typed. Beat 2 shows why the typing matters. A walk back from one journey finds
the pages that serve it, and they are the four `manni strategy get d11` lists.
Beat 3 shows the other side. One flag builds the graph a reader or an outside
service should get, and the query proves that a sidecar field such as
`created` is gone. Beat 4 shows the plugin's half. A session's graph lands in
the plugin's data directory, so it never mixes with the folder a site deploys.

## What is staged and what is real

- **Beat 4 runs the plugin's own server script,**
  `plugin/manni/hooks/graph-server.mjs`, the one `.mcp.json` starts. It runs
  `manni graph serve --publish -i <dir>`. Its stdin is closed, so the stdio
  server ends once it is up, as when a client hangs up. With
  `CLAUDE_PLUGIN_DATA` unset, as here, the directory is
  `<tmpdir>/manni/graph/<hash>`, and the path on screen is relative to the
  repository root. Under Claude Code it sits inside the plugin's data
  directory. The capture clears that directory first, so the run publishes
  cold.
- **Beat 2's pages match the record.** `capture-graph-authoring/strategy-get-d11.txt`
  holds `manni strategy get d11`, which lists the same four pages.
- **Beat 3's contrast is recorded, not shown.** The default graph answers the
  same query with 262 matches (`capture-graph-authoring/internal-created.txt`).
  The caption claims only what the frame shows.
- `manni` is `node -r media/capture/tty.cjs dist/cli.js`, which only tells the
  CLI that stdout is a terminal. Its `--version` prints 4.20.0, the published
  version. semantic-release bumps it when the feature ships, so no version is
  claimed on screen. The build commit, 5515e5c8, is in
  `capture-graph-authoring/build-commit.txt`.

## Capture notes

- **Font size is derived per beat** (`node capture-graph-authoring/cols.mjs`,
  run from `media/`). Every line fits or wraps at a space, or after a `/`
  inside an IRI or a path, and never inside a token. `b1=21 -v` prints one
  beat's rows at one size. Beat 1 is 21 px, the largest at which no row holds
  one stray word. At 27 px the build line orphans `records`, and at 22 px the
  chunks line orphans `withheld`. Beat 2 is 25 px, the largest with no stray
  rows. Beats 3 and 4 are 23 px. Beat 3's one short row is the real
  `No matches.` line. The composition sets `breakAfter="/"` and turns
  ligatures off, so `--no-authoring` keeps its two hyphens.
- **The wait is compressed, and the real time is on screen.** The default
  publish took 11.7 s and the reader-only one 9.1 s
  (`capture-graph-authoring/latency.txt`). The server waited 8.7 s, then
  2.2 s, between its lines. Every wait over a second replays at 1/5, the same
  factor throughout. bash's own `time` output follows each publish, and the
  server prints `published the graph in 11.0s` itself. `traverse` (751 ms)
  and `query` (656 ms) replay at their measured times. Typing and output are
  1x.
- Typing is 35 ms per character, the fast end of design.md's 35 to 70 ms.
  The traverse line carries a full journey IRI and is 152 characters.
- The audio track is silent AAC, as in the earlier videos. There is nothing
  to normalise for loudness.

## How to rebuild it

```bash
# from the repo root
npm run build
bash media/capture-graph-authoring/capture.sh   # captures every byte
(cd media && node capture-graph-authoring/cols.mjs)   # re-derive the sizes

cd media/remotion
npm ci
node scripts/captures-graph-authoring.mjs      # captures -> src/graph-authoring/captures.json
npx remotion render GraphAuthoringDemo ../graph-authoring-raw.mp4
ffmpeg -i ../graph-authoring-raw.mp4 -f lavfi -i anullsrc=r=48000:cl=stereo -shortest -c:v copy -c:a aac -b:a 64k \
  ../graph-authoring-1x1.mp4 && rm ../graph-authoring-raw.mp4
npx remotion still GraphAuthoringDemo ../graph-authoring-1x1.thumb.png --frame=580

# timings for the sidecars come from the same beats the composition uses
npx tsc --ignoreConfig src/graph-authoring/beats.ts src/beats.ts --outDir scripts/out-graph-authoring \
  --module node16 --moduleResolution node16 --target ES2022 \
  --resolveJsonModule --esModuleInterop --skipLibCheck
cd scripts && node vtt-graph-authoring.cjs && node transcript-graph-authoring.cjs
```

Thumbnail (`.thumb.png`): frame 580, the end of beat 2. Journey D11 sits
above its four marked pages.

## Suggested LinkedIn caption (do not post; hand over)

See `graph-authoring-1x1.post.txt`.
