# Demo beat sheet for served passages (proposal 0090)

- **Type:** feature demo, terminal session. No narration; captions only
  (LinkedIn autoplays muted).
- **Audience:** docs engineers and the people who build an agent or an
  "Ask AI" box over a docs site. Phone-sized, muted.
- **Target:** 36 s, five beats, one caption each.
- **Objective:** the viewer sees one command publish the docs' passages with
  their proof. An agent and a script then get a drifted sentence flagged, and
  a page that depends on it named. One config line keeps the drifted passage
  out of every host.
- **Status.** This is the script alone. Nothing is recorded or rendered yet.
- **Assets, once made:** `media/graph-serve-1x1.mp4` (not committed), `.gif`,
  `.thumb.png`, `.vtt`, `.transcript.txt`, `.post.txt`, this file and
  `media/capture-graph-serve/`.
- **Look:** `docs/content-strategy/design.md`. 1080×1080, 30 fps, title band
  112 px with an `n / 5` counter, caption band 86 px, accent `#58a6ff` blue.
  Never red, green, yellow or cyan, since manni's own output uses all four.
- **Material.** A scratch repository, `media/scratch-graph-serve/`
  (gitignored), which is its own git repository. It holds the fixture
  `test/graph/fixtures/provenance/`, committed twice the way
  `test/graph/integration/chunks.test.ts` commits it. The second commit
  changes the source line one pin rests on, so that pin drifts. One added
  link gives the page a dependent.

| # | Time | Title band | Caption band | Typed | On screen |
|---|---|---|---|---|---|
| 1 | 0:00–0:07 | One command publishes | Build, index and every passage with its proof, in one directory. | `manni graph publish` | the step lines; `chunks.json, chunks.und.jsonl: … chunks, 0 withheld`; `Published 6 files to .manni/graph/.` |
| 2 | 0:07–0:12 | Hand it to an agent | One line of MCP config. The agent gets four tools. | `cat .mcp.json` | `"args": ["manni", "graph", "serve"]` |
| 3 | 0:12–0:22 | One question, with proof | The drifted sentence is flagged. The page that depends on it is named. | `manni graph lookup "How many times does an upload retry?"` | `Matches` with `pins  1 current, 1 error: source-changed`; `Impact, depth 3` listing `other.md`; the summary line |
| 4 | 0:22–0:29 | Or from a script | createRetriever().lookup(): the same answer, as data, for your own model. | `node ask.mjs "How many times does an upload retry?"` | one line per passage: role, title, `verified` or `unverified` |
| 5 | 0:29–0:36 | Raise the floor | withhold: [drifted]. No host serves that passage, and the trace says why. | `manni graph publish` then `manni graph lookup "…" -f json \| jq -c .trace.withheld` | the notice `manni: … chunks withheld by graph.retrieve.withhold (drifted)`; then one `{"node":"…","because":["drifted"],"at":"export"}` per passage the drifted pin touches |

## Why this story

The feature is proof that travels with the passage. Beat 1 shows it costs
one command. Beats 3 and 4 are the payoff, the same drifted sentence flagged
on the CLI an agent's tool mirrors, and again in a script. Beat 3 also shows
the impact section, which is what an agent reads before it edits. Beat 5
shows the publisher's lever: a floor no agent can lower.

## Capture commands

Run from the repo root, after `npm run build`. `manni` is this branch's
`node dist/cli.js`, linked the way `.github/workflows/docs-as-tests.yml`
links it.

```bash
npm run build
rm -rf media/scratch-graph-serve
cp -r test/graph/fixtures/provenance media/scratch-graph-serve
cd media/scratch-graph-serve
# No evals report in this demo; the warning is expected.
sed -i 's/      evals: evals.json/      evals: null/' manni.config.yaml
# A dependent for the impact section.
printf '\nSee [Retry an upload](retry.md).\n' >> docs/other.md
git init -q && git add -A && git commit -qm initial
first=$(git rev-parse HEAD)
sed -i "s/COMMIT/$first/" docs/retry.md
# The drift: the line the second pin rests on changes.
sed -i 's/BACKOFF_MS = 500/BACKOFF_MS = 750/' src/upload.ts
git add -A && git commit -qm drift

cat > .mcp.json <<'EOF'
{ "mcpServers": { "docs": { "command": "npx", "args": ["manni", "graph", "serve"] } } }
EOF

cat > ask.mjs <<'EOF'
import { readFile } from "node:fs/promises";
import { createRetriever } from "../../dist/graph/runtime.js";

const fetch = async (url) => ({ ok: true, status: 200, text: () => readFile(url, "utf8") });
const docs = await createRetriever({ manifest: ".manni/graph/chunks.json", fetch, embed: false });
const result = await docs.lookup(process.argv[2]);
for (const [section, role] of [["matches", "answer"], ["traversal", "background"], ["impact", "dependent"]])
  for (const p of result[section].passages)
    console.log(role.padEnd(11), p.title.padEnd(16), p.provenance.pins.error > 0 ? "unverified" : "verified");
EOF

# Beat 1
manni graph publish
# Beat 2
cat .mcp.json
# Beat 3
manni graph lookup "How many times does an upload retry?"
# Beat 4
node ask.mjs "How many times does an upload retry?"
# Beat 5
printf '  retrieve:\n    withhold: [drifted]\n' >> manni.config.yaml
manni graph publish
manni graph lookup "How many times does an upload retry?" -f json | jq -c .trace.withheld
```

The `retrieve:` lines append under `graph:`, the last section of the
fixture's config. Check that before beat 5, and move them if the fixture
gains a later section.

Every `.mcp.json` and `ask.mjs` line is set up before the camera rolls.
Clear the screen between setup and beat 1, so no scrollback shows.

## Captions (`.vtt` source)

```text
00:00.000 --> 00:07.000
Build, index and every passage with its proof, in one directory.

00:07.000 --> 00:12.000
One line of MCP config. The agent gets four tools.

00:12.000 --> 00:22.000
The drifted sentence is flagged. The page that depends on it is named.

00:22.000 --> 00:29.000
createRetriever().lookup(): the same answer, as data, for your own model.

00:29.000 --> 00:36.000
withhold: [drifted]. No host serves that passage, and the trace says why.
```

## Checks before shipping (design.md)

1. Longest line measured at the chosen font size, so no line wraps. Beat 3's
   pins line is the longest; shorten the question if it wraps.
2. No text touches the frame edge.
3. Captions on every beat, burned in and in the `.vtt`.
4. `ffprobe`: 1080×1080, 30 fps, h264 yuv420p.
5. Accent `#58a6ff`, blue.

## Suggested LinkedIn caption

Docs search hands an agent text. manni hands it the text with its proof:
which sentences still match their source, when the page last changed, and
what depends on it. One command publishes it, one call answers, and one
config line keeps a drifted passage away from every host.

Do not post; hand over.
