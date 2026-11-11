# 0128: the `vector` domain builds and queries embeddings without a graph

- **Status:** Proposed
- **Serves:** Three journeys.
  - Devin · D13, "Publish the graph for retrieval". Vectors become one command
    he can run, gate and publish on their own.
  - Maya · M18, "See the docset as a graph". Finding a page by meaning no
    longer starts with learning the graph's artifact chain.
  - Maya · M29, "Ground a site's Ask AI in the docs' proof". The rows a hosted
    vector store ingests keep the same ids.
- **Depends on:** [0051](0051-graph-domain.md), the domain this splits.
  [0034](0034-command-grammar.md), the grammar a new domain follows.
  [0041](0041-collections.md), the document set. graph
  [ADR 01020](graph/01020-local-embeddings.md) and
  [ADR 01038](graph/01038-per-locale-retrieval-artifacts.md), the sidecar
  format and the per-language fan-out, both kept as they are.
- **Relates to:** [0078](0078-family-check-status-and-claude-code-plugin.md), whose `status`
  learns a new row. [0090](0090-served-passages-carry-their-proof.md), whose
  `graph publish` gains a renamed step.
- **Touches:** `src/vector/**` (new), `src/shared/base-iri.ts` (new),
  `src/shared/config-file.ts`, `src/cli.ts`, `src/index.ts`,
  `src/graph/{cli,index}.ts`, `src/graph/commands/{build,embed,search,publish,chunks,questions,export,init}.ts`,
  `src/graph/core/{config,config-schema.json,iri,localizations,vector-index}.ts`,
  `src/graph/runtime/vector.ts`, `src/family/core/in-play.ts`,
  `src/family/commands/status.ts`, `manni.config.yaml`,
  `scripts/{check-cli-reference,check-docs-graph}.mjs`, `test/vector/**` (new),
  `test/graph/**`, `test/family/**`, `docs/src/content/docs/vector/**` (new),
  `docs/src/content/docs/{graph,meta,family}/**`, `docs/astro.config.mjs`,
  `plugin/manni/skills/setup/SKILL.md`, `src/graph/CLAUDE.md`, `CLAUDE.md`
- **Verdict:** Move embedding out of `graph` into a `manni vector` domain with
  two verbs. `vector build` reads pages and writes the search index and its
  vector sidecars in one step. `vector search` ranks by meaning alone. The
  vectors stay keyed by graph node IRIs, so every graph consumer reads them
  unchanged. The IRI base those ids start with moves from `graph.baseIri` to a
  top-level `baseIri:`, because two domains now mint ids from it. `graph embed`
  and `graph.embed` go. graph is Beta, so this ships as a `feat:` minor release.

## Problem

Vectors are a graph artifact today, and the only way to them runs through the
graph. A sidecar embeds the text of `search.<lang>.json`, and only
`graph export search` writes that file, from a `graph.ttl` that only
`graph build` writes. On 4.28.0, a user who wants semantic search over this
repository's own site types the last step first and is sent back:

```console
$ manni graph embed
manni: Localization manifest not found: graph/localizations.json — run `manni graph export search` first.
# exit 2
```

The working order is three commands, each a graph verb:

```console
$ manni graph build --collection site
Wrote docs/public/graph/graph.ttl (266 docs, 22149 triples, 568 concepts (50 from the termbase))
$ manni graph export search
Wrote 3145 nodes to docs/public/graph/localizations.json
$ manni graph embed
Wrote 1 sidecar, recorded in docs/public/graph/localizations.json
  en: 3145 vectors (384-d, onnx-community/granite-embedding-small-english-r2-ONNX) -> docs/public/graph/vectors.en.bin
  3145 embedded, 0 from cache
```

`graph publish` folds the three into one, but only behind a config section the
user has to know about. It also writes the JSON-LD, the chunks and `llms.txt`
on every run. Without that section, the step reports itself skipped:

```console
$ manni graph publish --collection site
build     graph.ttl: 266 pages, 22149 triples
export    search.en.json, localizations.json: 3145 entries
skipped   embed: no graph.embed section
...
```

So a semantic index of the docs is the fourth artifact of a tool about RDF.
Devin wants a vector index for the site's search box or a RAG ingester. He has
to learn the graph to get one, and he cannot run, cache or gate it alone.

The ids are the reason the two stay joined. A sidecar row is a graph node IRI,
and `chunks.json`, `graph retrieve` and the browser runtime all join on it. The
prefix those IRIs start with is `graph.baseIri`. Once a second domain mints the
same ids, a key inside one domain's section is the wrong home for it.

## Worked example

Devin adds semantic search to this repository's site. The config already
declares the `site` collection and a `graph:` section, and carries no vectors.

He moves the IRI base to the top of `manni.config.yaml` and adds an empty
`vector:` section, which takes every default:

```yaml
baseIri: https://hawkeyexl.github.io/manni/id/

graph:
  out: docs/public/graph/graph.ttl
  # routes, build, check and export as before

vector: {}
```

He builds the index from the pages, with no graph step first:

```console
$ manni vector build --collection site
Indexed 266 pages: 3145 entries in 1 language
Wrote 1 sidecar, recorded in docs/public/graph/localizations.json
  en: 3145 vectors (384-d, onnx-community/granite-embedding-small-english-r2-ONNX) -> docs/public/graph/vectors.en.bin
  3145 embedded, 0 from cache
# exit 0
```

The files land beside `graph.out`, where `graph search`, `graph publish` and
the runtime already look. No `graph.ttl` is written. He asks a question:

```console
$ manni vector search "pin a sentence to its source" --limit 3
0.8123  https://hawkeyexl.github.io/manni/id/doc/docs/src/content/docs/cite/index.mdx [graph:Document] — Pin sentences to their sources
0.7954  https://hawkeyexl.github.io/manni/id/doc/docs/src/content/docs/cite/get-started/index.mdx#add-a-citation [graph:Section] — Add a citation
0.7710  https://hawkeyexl.github.io/manni/id/doc/docs/src/content/docs/cite/reference/cli.mdx#manni-cite-add [graph:Section] — manni cite add

3 results (vector)
# exit 0
```

The scores and hits above are drafted. The shape and the commands are what
the built CLI prints. The site's CI keeps `graph publish`, which now runs the
vector step because the `vector:` section exists:

```console
$ manni graph publish --collection site
build     graph.ttl: 266 pages, 22149 triples
export    search.en.json, localizations.json: 3145 entries
vector    vectors.en.bin, localizations.json: 3145 vectors, onnx-community/granite-embedding-small-english-r2-ONNX
export    graph.jsonld: 3229 nodes
export    chunks.json, chunks.en.jsonl: 2572 chunks, 0 withheld
export    llms.txt: 266 pages
skipped   iirds: no graph.export.iirds section
Published 8 files to docs/public/graph/.
```

`chunks.json` now carries each row's vector, so the site's Ask AI box ranks by
meaning. Devin's hosted vector store ingests those rows with the same ids it
had before.

## Decision

### 1. One top-level `baseIri:`

`baseIri` joins `collections`, `providers`, `tools` and `encryptionKey` at the
top of `manni.config.yaml`. Its value and default are unchanged. The trailing
separator rule (`resolveBaseIri`) moves to `src/shared/base-iri.ts` with the
key, and graph reads it from there.

There is no override under `graph:` or `vector:`. A second value would mint a
second set of ids, and the join between the two domains is the point. A
`graph.baseIri` left in a config is refused with exit 2, naming the new key, as
0041 refused `graph.inputs`.

### 2. A `vector` domain with `build` and `search`

`manni vector build [paths...]` takes the input surface `graph build` takes.
That covers positional paths, `-` with `--as`, `--collection`, `--exclude`,
`--ext`, `--allow-empty`, `-c` and `--no-config`, with `collections:` as the
fallback. It also takes `--no-authoring`, as every graph verb that reads pages
does.

It runs graph's build in memory, then graph's search index over that graph,
then the embedder. It writes `search.<lang>.json`, `localizations.json` and
`vectors.<lang>.bin`, and never `graph.ttl`. Reusing graph's pipeline is the
coupling. The same `graph:` settings, the same `baseIri` and the same pages give
the same IRIs and the same indexed text, byte for byte. A config with no
`graph:` section builds on graph's defaults.

`manni vector search <query>` ranks the nodes of one language by meaning alone.
It reads `localizations.json`, the language's search index and its sidecar, and
embeds the query with the model the sidecar names.

### 3. One directory, beside `graph.out`

Both verbs default to the directory holding `graph.out`, which is where
`graph export search`, `graph search` and `graph publish` already read and
write. `vector build -o` and `vector search -i` move it for one run. There is
no config key for it. `graph.embed.out` goes with nothing in its place,
because a second configured directory is how the two domains would drift apart.

The two domains can both write `search.<lang>.json` there. Given the same
inputs, they write the same bytes. If they ever disagree, the sidecar's
recorded digest catches it, and every reader already refuses a stale sidecar.

### 4. Each ranking leg lives once

The lexical leg is graph's, the vector leg is vector's, and hybrid ranking
stays on graph because it needs both. `graph search --mode` takes
`lexical | hybrid`, and `vector search` has no `--mode`. `graph retrieve --mode`
keeps all three values. It ranks passages for a scoped walk, a different job
from ranking nodes.

### 5. graph keeps the format and the browser seam

The sidecar codec, the `MGRV` magic, the runtime's vector index and the
`@hawkeyexl/manni/graph/embed` export stay where they are. The runtime loads
`embed.js` from beside `runtime.js`, and hosts ship them as a pair. Moving the
export would break that pair and change nothing a CLI user types.

### 6. The family learns the domain

A top-level `vector:` section puts the domain in play, as `graph:` does for
graph. `graph publish` runs its vector step when the section exists.
`manni status` lists vector among the domains `check` does not run, because
building embeddings downloads and runs a model.

## Interface

### Config, before and after

Before, on 4.28.0:

```yaml
graph:
  baseIri: https://hawkeyexl.github.io/manni/id/
  out: docs/public/graph/graph.ttl
  routes:
    - root: docs/src/content/docs
      basePath: /manni
      language: en
  embed:
    model: onnx-community/granite-embedding-small-english-r2-ONNX
    dtype: q8
    out: docs/public/graph
    cacheDir: .manni/graph/embed-cache
    byLanguage:
      de:
        model: Xenova/multilingual-e5-small
```

After:

```yaml
baseIri: https://hawkeyexl.github.io/manni/id/

graph:
  out: docs/public/graph/graph.ttl
  routes:
    - root: docs/src/content/docs
      basePath: /manni
      language: en

vector:
  model: onnx-community/granite-embedding-small-english-r2-ONNX
  dtype: q8
  cacheDir: .manni/vector/cache
  byLanguage:
    de:
      model: Xenova/multilingual-e5-small
```

| Key | Type | Default | Required | What it does |
|---|---|---|---|---|
| `baseIri` | string | `urn:manni:graph:` | No | The prefix of every node IRI that graph and vector mint. |
| `vector` | object | absent | No | Puts the domain in play, and makes `graph publish` build vectors. |
| `vector.model` | string | `onnx-community/granite-embedding-small-english-r2-ONNX` | No | The embedding model id. `mock` embeds offline. |
| `vector.dtype` | string | `q8` | No | The weight quantization the model loads at. |
| `vector.cacheDir` | string | `.manni/vector/cache` | No | Where computed vectors are cached, relative to the working directory. |
| `vector.byLanguage.<tag>.model` | string | `vector.model` | No | The model for one language, matched by canonical BCP-47 tag. |
| `vector.byLanguage.<tag>.dtype` | string | `vector.dtype` | No | The quantization for that language's model. |

Removed: `graph.baseIri`, `graph.embed` and every key under it.
`graph.embed.out` has no successor. The cache moves from
`.manni/graph/embed-cache`, so the first run after upgrading embeds everything
once.

### Command ladder

`vector build`, from the minimum to every option:

```console
$ manni vector build
Indexed 354 pages: 3612 entries in 1 language
Wrote 1 sidecar, recorded in docs/public/graph/localizations.json
  en: 3612 vectors (384-d, onnx-community/granite-embedding-small-english-r2-ONNX) -> docs/public/graph/vectors.en.bin
  3612 embedded, 0 from cache
# exit 0: every collection, every default

$ manni vector build --collection site
# exit 0: one collection, as the worked example shows

$ manni vector build docs/src/content/docs/cite
# exit 0: one directory, labelled from the working directory

$ manni vector build --collection site --embedding-model mock --no-cache -f json
{ "manifestPath": "...", "documents": 266, "entries": 3145, "languages": [ ... ], "embedded": 3145, "cached": 0, "total": 3145 }
# exit 0: offline and scriptable, the form CI fixtures use

$ cat draft.md | manni vector build docs/src/content/docs - --as markdown --exclude "**/proposals/**" --ext md,mdx --no-authoring --embedding-model Xenova/gte-small --dtype fp32 --no-cache -o /tmp/vectors -c manni.config.yaml -f pretty
# exit 0: every option at once; stdin joins the named paths
```

`vector search`, from the minimum to every option:

```console
$ manni vector search "pin a sentence to its source"
# exit 0: ten results, the only language

$ manni vector search "Zitat prüfen" --lang de --limit 5
# exit 0: one language of several

$ manni vector search "pin a sentence" -f json
{ "query": "pin a sentence", "mode": "vector", "results": [ { "iri": "...", "score": 0.8123, "type": "graph:Document", "title": "..." } ], ... }
# exit 0

$ manni vector search "pin a sentence" -i /tmp/vectors --lang en --limit 3 -c manni.config.yaml -f pretty
# exit 0: every option at once
```

Usage and operational errors, each to stderr with exit 2. A path in an error
is absolute, as graph's errors print it. The ladder shortens them:

```console
$ manni vector search "x"            # nothing built yet
manni: Localization manifest not found: docs/public/graph/localizations.json — run `manni vector build` first.

$ manni vector search "x"            # built by graph export search alone
manni: Vector index not found: no sidecar recorded for "en" — run `manni vector build` first.

$ manni vector search "x"            # several languages
manni: This corpus has more than one localization (de, en) — pass --lang to choose one.

$ manni vector build                 # no collections, no paths
manni: No files to build. Pass paths/globs, or declare a collection under `collections:` in manni.config.yaml.

$ manni vector build - --collection site
manni: Reading from stdin (`-`) requires --as <format> to choose an extractor.

$ manni vector build --model gte
error: unknown option '--model'
(add --help for usage)

$ manni graph embed
manni: graph embed moved to manni vector build.

$ manni graph search "x" --mode vector
manni: Unknown --mode "vector". Use lexical | hybrid. For vector-only ranking, run manni vector search.
```

### Messages

| Message | Exit | When |
|---|---|---|
| `<file>: "baseIri" is no longer a graph key. Node IRIs start from one top-level baseIri: key. See <ref>#base-iri` | 2 | A `graph:` section still sets it. |
| `<file>: "embed" is no longer a graph key. Embedding settings live under a top-level vector: section. See <ref>` | 2 | A `graph:` section still has `embed`. |
| `<file>: "baseIri" must be a non-empty string.` | 2 | The top-level value is not one. |
| `Invalid config in <file>:` then one line per schema error | 2 | A `vector:` key is unknown or mistyped. |
| `graph embed moved to manni vector build.` | 2 | Someone types the old verb. |
| `Unknown --mode "vector". Use lexical \| hybrid. For vector-only ranking, run manni vector search.` | 2 | `graph search --mode vector`. |
| `Vector index not found: no sidecar recorded for "<lang>" — run \`manni vector build\` first.` | 2 | `vector search` finds an index without vectors. |
| `Vector index was built from a different search index — the corpus changed. Re-run \`manni vector build\`.` | 2 | The sidecar's digest does not match its index. |
| `no vector sidecar, so chunks carry no vectors and retrieval is lexical only; add a top-level vector: section to add them.` | 0, stderr | `graph export chunks` and `graph publish` without vectors. |
| `skipped   vector: no vector section` | 0, stdout | `graph publish` without a `vector:` section. |

Every message that tells the user to run `manni graph embed` today names
`manni vector build` instead. That includes the runtime's refusals and the
graph search, retrieve and check messages. The model-loading messages keep
their words.

### Output shapes

`vector build -f json` prints the report below. A path inside the working
directory is relative to it. One outside, as `-o` can name, stays absolute.

```json
{
  "manifestPath": "docs/public/graph/localizations.json",
  "documents": 266,
  "entries": 3145,
  "languages": [
    {
      "language": "en",
      "searchPath": "docs/public/graph/search.en.json",
      "entries": 3145,
      "outPath": "docs/public/graph/vectors.en.bin",
      "model": "onnx-community/granite-embedding-small-english-r2-ONNX",
      "dims": 384,
      "embedded": 3145,
      "cached": 0,
      "total": 3145
    }
  ],
  "embedded": 3145,
  "cached": 0,
  "total": 3145
}
```

`vector search -f json` prints the report `graph search` prints, with `mode`
always `"vector"` and `lexical` always empty. The pretty output is the same
line per hit and the same count line.

The files on disk keep their names, formats and versions.
`localizations.json` stays version 1. The sidecar stays format 2 with the
`MGRV` magic. `graph publish -f json` names its step `vector` where it named it
`embed`.

### Programmatic API

| Before | After |
|---|---|
| `graph.runEmbed`, `graph.renderEmbed` | `vector.runBuild`, `vector.renderBuild` |
| `graph.embedText` | `vector.embedText` |
| none | `vector.runSearch`, `vector.renderSearch` |
| `graph.resolveBaseIri` | Unchanged, now reading the top-level key. |
| `@hawkeyexl/manni/graph/embed`, `@hawkeyexl/manni/graph/runtime` | Unchanged. |

## Known limits

- `vector build` runs the whole graph build in memory. That includes git
  history when `graph.build.derive` asks for provenance, which the index never
  reads. The analyze cache keeps a second run cheap, and skipping a derive
  source would risk ids that drift from graph's.
- `vector search` needs the lexical index beside the sidecar for titles and
  types. `vector build` always writes it, so this only shows when someone
  deletes files by hand.
- The first `vector build` or `vector search` downloads the model, as
  `graph embed` and `graph search` did.
- A cold `vector build` is slow. Embedding this repository's site took 3m22s
  with the default model and no cache. The cache makes later runs pay only for
  changed text.

## Rejected

- **Vector reads and chunks pages on its own.** Its rows would need ids graph
  does not mint, and every consumer would need a join it has today for free.
- **Moving `routes`, `authoring` and `build.derive` up with `baseIri`.** Those
  settings describe how graph reads a corpus, and vector inherits them by
  running graph's build. Only the IRI base names an identity both domains
  publish.
- **A `baseIri` override under `vector:` or `graph:`.** Two values would mint
  two sets of ids for one page.
- **Moving the embedder, the codec and the `graph/embed` export to vector.**
  The runtime pairs `embed.js` with `runtime.js`, and nothing a user types
  would change.
- **A `vector.out` key.** One directory derived from `graph.out` cannot drift.
  `-o` and `-i` cover the one-off case.
- **Keeping `graph embed` as an alias, or `vector search --mode hybrid`.** Each
  is a second surface for one job.

## Open questions

None.

## Verification

- Unit tests cover the top-level `baseIri` parse, its refusal under `graph:`,
  the `vector:` schema with a positive and a negative case per key, and the
  `graph.embed` refusal.
- `test/vector/build.test.ts` builds the golden corpus with the mock embedder.
  It asserts that `search.<lang>.json`, `localizations.json` and
  `vectors.<lang>.bin` match the existing goldens byte for byte, and that no
  `graph.ttl` is written.
- `test/vector/search.test.ts` moves the vector-mode cases from
  `test/graph/integration/embed.test.ts`. That covers stale, corrupt and
  missing sidecars, model mismatch, and the several-languages refusal.
- `test/vector/input-parity.test.ts` runs the input ladder: paths, stdin,
  collections, the config fallback and no input.
- `test/vector/cli.integration.test.ts` runs every rung of the ladder above
  against the built `dist/cli.js`, including each exit 2.
- `test/graph/integration/publish.test.ts` asserts the `vector` step, and that
  `graph search --mode vector` is refused.
- `test/family` asserts the `status` row with and without a `vector:` section.
- The goldens do not change. Their regeneration recipe becomes
  `manni graph build`, then `manni vector build --embedding-model mock --no-cache`.

### Dogfood

On this repository, after moving `baseIri` to the top level:

```bash
npm run build
npm run docs:check-graph
node dist/cli.js vector build --collection site --embedding-model mock --no-cache
node dist/cli.js vector search "pin a sentence to its source" --limit 3
node dist/cli.js graph publish --collection site
node dist/cli.js status
```

`docs:check-graph` passes with the new key. The vector build writes beside
`docs/public/graph/graph.ttl` and prints no `graph.ttl` line. Without a
`vector:` section, publish reports `skipped   vector: no vector section`.
`status` lists vector as not checked. The PR carries this output.

## Delivery

Two pull requests, stacked.

1. **`claude/family-base-iri`, `feat(graph):`.** The top-level `baseIri`, its
   refusal under `graph:`, the fixtures and the docs. It ships this proposal.
2. **`tool/vector`, `feat(vector):`.** The domain, the removal of `graph embed`
   and `graph.embed`, the `graph search --mode` change, the publish step, the
   status row, the docs section and the demo video. It sets this proposal's
   Status to Implemented.

## Acceptance checklist

### PR 1

- `src/shared/base-iri.ts` parses the top-level `baseIri` and owns its default.
- A `manni.config.yaml` with `baseIri:` at the top builds the same IRIs that
  `graph.baseIri` built.
- A `graph.baseIri` exits 2 with the refusal from the Messages table.
- `manni.config.yaml`, `test/family/fixtures/**` and `test/graph/fixtures/**`
  set `baseIri` at the top level, and no file sets `graph.baseIri`.
- `scripts/check-docs-graph.mjs` reads the top-level key, and
  `npm run docs:check-graph` passes.
- `docs/src/content/docs/meta/reference/configuration.mdx` documents `baseIri`
  beside the other family keys, and the graph configuration page links to it.
- `manni graph init` writes `baseIri` as a commented top-level line.
- This proposal is in `docs/proposals/` and indexed in its README as Proposed.

### PR 2

- `manni vector build` and `manni vector search` exist with the options and
  messages above, and `manni vector --help` lists both.
- `manni graph embed` exits 2 with the moved message, and `graph --help` no
  longer lists it.
- `graph.embed` exits 2 with the refusal from the Messages table.
- `graph search --mode` accepts `lexical | hybrid` only.
- `graph publish` reports a `vector` step when `vector:` exists, and skips it
  otherwise.
- No message anywhere in `src/` names `manni graph embed`.
- `manni status` lists vector, not checked, with its reason and next step.
- `src/index.ts` exports the `vector` namespace from the API table.
- `test/vector/**` exists with the files under Verification, and the graph
  goldens are unchanged.
- `docs/src/content/docs/vector/index.mdx` and
  `docs/src/content/docs/vector/reference/{cli,configuration}.mdx` exist, with
  `title` and `description`. The sidebar lists the domain with the Beta badge.
- `npm run docs:check-cli` verifies the vector reference page.
- The graph pages and the glossary's `vector-sidecar` entry name
  `manni vector build`, and journeys D13 and M18 name the new commands.
- `src/graph/CLAUDE.md` and the root `CLAUDE.md` describe `src/vector/`.
- The demo video's script, captions and sources are in `media/`, and the PR
  carries the MP4 and the dogfood output.
- This proposal's Status reads Implemented, with both PR numbers.
