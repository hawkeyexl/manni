# Demo beat sheet for a page read that names its records (proposal 0107)

- **Type.** A feature demo (`feat(plugin)`, proposal 0107), as a terminal session.
  Captions carry it with no narration, because LinkedIn autoplays muted.
- **Audience:** docs engineers who let Claude Code read and edit their docs.
  Phone-sized, muted.
- **Target:** 43.3 s, four beats, one caption each.
- **Objective:** the viewer sees that a page's persona ids now come with
  pointers to the records behind them. `manni meta get` prints one `record`
  line per record, with no new flag. The plugin's Read hook hands the agent the
  page's key fields, then one short reference per record. On a huge page the
  reply stays under Claude Code's limit and names what it left out.
- **Assets:** `plugin-records-1x1.mp4` (not committed), `.thumb.png`, `.vtt`,
  `.srt`, `.transcript.txt`, `.post.txt`, this file, and `capture/` beside it.
  In `media/remotion/`, the files are `src/plugin-records/`,
  `scripts/{captures,vtt,transcript}-plugin-records.*` and the
  `PluginRecordsDemo` composition in `src/Root.tsx`. No GIF and no storyboard.
  The brief asked for neither, and one shot type, a terminal, needs no plan
  beyond this table.
- **Look:** `docs/content-strategy/design.md`. 1080×1080, 30 fps, title band
  112 px with an `n / 4` counter, caption band 86 px, accent `#58a6ff` blue.
  Never red, green, yellow or cyan. The only colour in the terminal is the dim
  file prefix and `(asserted)` in beat 2.
- **Material:** this repository's own pages and records, run from the repo
  root. Beats 1 to 3 use `docs/src/content/docs/cite/ci/stale-windows.mdx`,
  whose sidecar names personas `devin` and `maya`. Beat 4 uses
  `docs/src/content/docs/cite/reference/cli.mdx`, which stores 59,338
  characters of metadata as JSON. Nothing is staged, and nothing in the
  repository is written.

| # | Time | Title band | Caption band | Typed | On screen |
|---|---|---|---|---|---|
| 1 | 0:00–0:07 | Ids, and nothing more | The page's sidecar names its personas by id. Nothing in it says who devin or maya is. | `head -4 docs/src/content/docs/cite/ci/stale-windows.meta.yaml` | the page key, then `personas:`, `- devin` and `- maya` (marked) |
| 2 | 0:07–0:17 | manni meta get personas | meta get now prints a record line for each persona, with the file to read. No new flag. | `manni meta get personas docs/src/content/docs/cite/ci/stale-windows.mdx` | `Using manni.config.yaml (.)`, the `personas=["devin","maya"] (asserted)` row, and two `record persona <id> docs/content-strategy/personas/<id>.md` rows (marked) |
| 3 | 0:17–0:28 | What a Read hands the agent | Key fields first, then one short line per record. The agent gets references, not the records. | `read-page docs/src/content/docs/cite/ci/stale-windows.mdx \| cut -c -500` | the lead, the page JSON from `title` through `journeys` to the cut, the references lead, and six `<type> <id> <file>` lines (marked) |
| 4 | 0:28–0:43 | A huge page fits the limit | The reply, 3,311 characters, stays under Claude Code's limit of 10,000 and names what it left out. | `read-page docs/src/content/docs/cite/reference/cli.mdx > /tmp/reply.txt`, `wc -c /tmp/reply.txt`, `tail -1 /tmp/reply.txt` | `3311 /tmp/reply.txt` (marked), then the closing line naming `citations` and `provenance` and the `manni meta get` command that prints them (marked) |

Exact cue times are in `plugin-records-1x1.vtt` and `.srt`, generated from
the beats the composition renders.

## Why this story

The feature adds no command and no flag. A page's ids now lead somewhere.
Beat 1 shows the gap as the data holds it, which is two bare ids. Beat 2 shows the
primitive a person can run, the same `get` with two more lines. Beat 3 shows
what the agent receives on a Read. Its key fields come first, then a lead
that says how to fetch a record, then one line per record. Beat 4 shows the
rule that keeps a big page usable. The reply measures well under the limit,
and its last line names the two fields it left out and the command that
prints them.

## What is staged and what is real

- **`read-page` is the earlier demo's helper,**
  `media/plugin-metadata/repo/read-page.mjs`, reused unchanged. It builds the
  `PostToolUse` envelope Claude Code sends after a Read and pipes it into the
  plugin's real `plugin/manni/hooks/page-metadata.mjs`. It prints the
  `additionalContext` text the hook returns. The helper writes none of that
  text. Each capture run uses a fresh `session_id`, so the hook has given the
  session nothing before beat 3. Inside this repository the hook's launcher
  runs this checkout's own `dist/cli.js`.
- **Beat 3's page JSON is trimmed on screen,** by the `cut -c -500` typed
  there. No line is cut in the edit. The whole reply, 2,543 characters with
  its newline, is in `capture/read-whole.txt`.
- **Beat 4 writes `/tmp/reply.txt`** so that `wc` and `tail` can read one
  reply. A second Read in the same session would print nothing, since the hook
  gives a page once.
- `manni` is `node -r media/capture/tty.cjs dist/cli.js`, which only tells the
  CLI that stdout is a terminal, so colour is emitted. Its `--version` prints
  4.20.0, the published version. semantic-release bumps it when the feature
  ships, so no version is claimed on screen. The build commit is in
  `capture/build-commit.txt`.

## Capture notes

- **Font size is derived per beat** (`node plugin-records/capture/cols.mjs`,
  run from `media/`). Every line fits or wraps at a space, or after a comma
  inside the page JSON, and never inside a token. The script prints the
  largest size that fits each beat, and `b3=23 -v` prints one beat's rows at
  one size. Beat 1 is 27 px, the largest at which the typed line holds one
  row. Beat 2 is 25 px, where each `record` row breaks right before its
  record file. Larger sizes split the ids from their files. Beat 3 is 23 px,
  the largest with no stray one-word rows, at 20 rows. Beat 4 is 30 px, the
  largest with no stray rows. The composition sets `breakAfter=","` and turns
  ligatures off.
- **Latency is disclosed.** A VirtualBox VM held the CPU at 100% for the whole
  session, so runs varied widely (`capture/latency.txt`). `get` took 1.6 to
  8.9 s. On the stale-windows page the Read hook took 1.7 to
  16.6 s. On the cite CLI reference it took 1.7 to 10.3 s. The replay uses 1.8 s, 1.9 s and 2.2 s.
  Each is at least one measured run of that command, so output never lands
  sooner than it did. `head`, `wc` and `tail` replay their measured 638, 649
  and 536 ms. Nothing is sped up.
- Typing is 35 ms per character, the fast end of design.md's 35 to 70 ms.
  The typed paths are the repository's real ones, 63 to 73 characters a line.
- The audio track is silent AAC, as in the earlier videos. There is nothing
  to normalise for loudness.

## How to rebuild it

```bash
# from the repo root
npm run build
bash media/plugin-records/capture/capture.sh   # captures every byte, writes nothing in the repo
(cd media && node plugin-records/capture/cols.mjs)   # re-derive the sizes

cd media/remotion
npm ci
node scripts/captures-plugin-records.mjs      # captures -> src/plugin-records/captures.json
npx remotion render PluginRecordsDemo ../plugin-records/raw.mp4
ffmpeg -i ../plugin-records/raw.mp4 -f lavfi -i anullsrc=r=48000:cl=stereo -shortest -c:v copy -c:a aac -b:a 64k \
  ../plugin-records/plugin-records-1x1.mp4 && rm ../plugin-records/raw.mp4
npx remotion still PluginRecordsDemo ../plugin-records/plugin-records-1x1.thumb.png --frame=820

# timings for the sidecars come from the same beats the composition uses
npx tsc --ignoreConfig src/plugin-records/beats.ts src/beats.ts --outDir scripts/out-plugin-records \
  --module node16 --moduleResolution node16 --target ES2022 \
  --resolveJsonModule --esModuleInterop --skipLibCheck
cd scripts && node vtt-plugin-records.cjs && node transcript-plugin-records.cjs
```

Thumbnail (`.thumb.png`): frame 820, the end of beat 3. The page's key fields
sit above the six marked references.

## Suggested LinkedIn caption (do not post; hand over)

See `plugin-records-1x1.post.txt`.
