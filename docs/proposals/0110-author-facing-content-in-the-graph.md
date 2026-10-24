# 0110: Author-facing content in the graph, on by default

- **Status:** Implemented (#247)
- **Serves:**
  - Sara · S17, "Hold the pages to the strategy they were written for". The
    graph says whom each page serves, and which pages serve a journey.
  - Maya · M24, "Let an agent keep the docs green while it writes them". The
    agent's graph knows the records and keeps its proof.
- **Depends on:** Three earlier proposals.
  - [0090](0090-served-passages-carry-their-proof.md) is the delivery rule,
    `deliveredFields`, which chunk metadata already follows.
  - [0102](0102-a-strategy-domain-holds-pages-to-their-personas-and-journeys.md)
    is the strategy records and their id rule.
  - [0103](0103-the-plugin-serves-the-graph-and-keeps-page-metadata-current.md)
    is the plugin's graph server.
- **Supersedes in part:** [0103](0103-the-plugin-serves-the-graph-and-keeps-page-metadata-current.md),
  decision 1. [What this supersedes](#what-this-supersedes) names the passage.
  It also lifts 0102's scope row "graph typing for journeys".
- **Touches:** `src/graph/core/config-schema.json`, `src/graph/core/config.ts`,
  `src/graph/core/graph-output.ts`, `src/graph/core/derive.ts`,
  `src/graph/core/iri.ts`, `src/graph/cli.ts`, the `build`, `export`,
  `publish`, `serve`, `chunks` and `llms` command cores,
  `shapes/graph/shapes-1.3.0.ttl`, `ns/graph/ns-1.4.0.ttl`,
  `plugin/manni/hooks/graph-server.mjs`, `scripts/check-docs-graph.mjs`, the
  Docs workflow, and the graph, strategy and plugin pages.

## Problem

The graph reads 82 strategy records here, one per audience, persona and
journey. Each arrives as a bare `graph:Document`. A page's `personas:` and
`journeys:` derive nothing. So an agent asking "which journeys does this page
serve, and what else serves them?" finds documents with no edges.

The schemas already say which content is the author's. A field marked
`x-manni-location: external` prefers a sidecar: `created`, `authors`,
`citations`, `provenance`, the eval fields and the strategy fields. Chunk
metadata honours that mark, and the Turtle and the passages do not. A
repository that hands its graph to readers, or to a retrieval service outside
its walls, has no switch that leaves that content out. Naming collections
keeps whole files out, and never a field.

The plugin's server publishes every collection beside `graph.out`. Here that
is `docs/public/graph/`, the folder the site deploys.

## Worked example

Sara plans to narrow Devin's journey D11. She opens Claude Code. The plugin's
server publishes into the plugin's data directory, never into
`docs/public/graph/`.

```text
manni: publishing the graph before serving it: ../../AppData/…/graph/3f9c…/chunks.json does not exist.
manni: published the graph in 12.1s.
manni: serving lookup, retrieve, traverse and impact over stdio from ../../AppData/…/graph/3f9c…/chunks.json.
```

She asks the agent which pages belong to D11. At the terminal she checks the
same thing.

```console
$ manni graph publish -o .manni/graph/internal
build     graph.ttl: 344 pages, 23395 triples, 82 strategy records
…
$ manni graph traverse -g .manni/graph/internal/graph.ttl https://hawkeyexl.github.io/manni/id/strategy/journey/d11 --reverse --predicates dcterms:isPartOf
```

The walk lists the pages `manni strategy get d11` lists. She narrows D11 and
leaves the other journeys those pages serve alone.

Her pull request runs the Docs workflow, unchanged. Its
`graph publish --collection site` holds no record, so it writes the bytes it
wrote before.

Then she builds a graph for a support bot outside the team.

```console
$ manni graph publish --collection site --no-authoring -o .manni/graph/readers
build     graph.ttl: 262 pages, 20997 triples
…
$ manni graph query -g .manni/graph/readers/graph.ttl --predicate dcterms:created
No matches.
```

Its passages carry no pins and no eval verdicts.

## Decision

1. **`graph.authoring`, default `true`, and `--no-authoring`.** One boolean.
   `--no-authoring` sets it `false` for one run, as `--no-gitignore` does for
   `meta.respectGitignore`. The flag is on `graph build`, `export`, `publish`
   and `serve`. Its help text reads "Leave out author-facing content:
   strategy records, and every field its schemas prefer in a sidecar". No
   `--authoring` flag exists. With the default on, the only override needed
   is the one that takes away.

2. **What `--no-authoring` leaves out.** Before derivation, a strategy record
   leaves the document set, so a link to one resolves as a link outside the
   build. Every value a page's schemas mark `x-manni-location: external`
   leaves the page, at any depth, from the frontmatter and the inline
   statements. The rule is `deliveredFields`, so the graph and the chunks
   leave out the same values. Chunk rows carry no pins and no eval verdicts,
   and a `created` day the field stamped is `null`. `x-manni-graph-output:
   false` keeps a field out in both modes.

3. **Strategy typing, whenever a record is in the build.** A record mints
   `{baseIri}strategy/{type}/{id}`, typed `schema:Audience`,
   `schema:PeopleAudience` or `graph:Journey`, with its title. Its file names
   it with `foaf:primaryTopic`, unless its `graph` block names a topic. A
   persona's `audience:` derives `dcterms:isPartOf`, and a journey's
   `personas:` derives `schema:audience`. A page's `audiences:` and
   `personas:` derive `schema:audience`, and its `journeys:` derive
   `dcterms:isPartOf`. An edge needs a record of that type and id in the
   build. Ids compare ignoring case, and an unknown id derives nothing.

4. **Shapes 1.3.0 and vocabulary 1.4.0, both MINOR.** `DocumentShape` learns
   `schema:audience` and `dcterms:isPartOf`, and `foaf:primaryTopic` widens
   to the three classes. `AudienceShape`, `PersonaShape` and `JourneyShape`
   are closed. The vocabulary adds `graph:Journey`. Earlier files are
   unchanged.

5. **The plugin publishes outside the tree.** Every project with
   `collections:` gets `manni graph serve --publish -i <data>/graph/<hash>`.
   A session never writes `graph.out`'s directory.

6. **CI gates the typing.** The Docs workflow builds every collection and runs
   `graph check -g` on it. `docs:check-graph` also asserts that a
   `--no-authoring` build holds no `created` only a manifest holds.

7. **The build line names the records.** `, N strategy records` follows the
   termbase clause when N is above zero, on `graph build` and on
   `graph publish`'s build step.

8. **Messages.** `--evals` with authoring off exits 2: "--evals attaches eval
   verdicts, which are author-facing, and this run leaves author-facing
   content out." A configured `graph.export.chunks.evals` warns once and
   exits 0. `serve --no-authoring` without `--publish` exits 2: "--no-authoring
   decides what --publish builds, so it needs --publish." `export
   --no-authoring` exits 2 on a target other than `chunks` and `llms`. It
   says the flag "applies only to graph export chunks and llms", and to
   build the graph with it for the others.

## Known limits

- **`export` reserializes the graph it is given.** On `export`, the flag
  shapes what `chunks` and `llms` read from the pages. `jsonld`, `iirds`,
  `search` and `questions` write the graph as it was built, so they refuse
  the flag with exit 2. A reader-only graph comes from a `--no-authoring`
  build or publish.
- **Passage text is the page's text.** An inline `meta` statement sits in the
  body, so its comment stays in a passage's text, while its fields leave the
  row.
- **`serve --publish --no-authoring` keeps a current artifact.** An artifact
  built at HEAD with author-facing content is served as it is, until the
  checkout changes.
- **IRIs are per repository.** A record borrowed from another repository is
  typed under this one's `graph.baseIri`.
- **Journey steps are not derived.**
- **Pointer claims.** A citation with no claim lines attaches to no passage.
  No test covers a record's pointer claim yet, because that kind of claim
  is not in this repository.

## Rejected

- **A record-gated split.** It kept records out unless their collection was
  named. The split that matters is reader against author, not file against
  file.
- **Off by default, with `--authoring`.** The maintainers' graph is the one
  people build most, so it is the default.
- **An exception list keeping proof in a reader-only graph.** The mark alone
  decides.
- **Records as SKOS concepts, custom predicates, or `prov:Plan` for
  journeys.** schema.org has audience classes, and `dcterms` has the edges.

## Open questions

1. Should this repository's site publish pass `--no-authoring`? It would drop
   the site's pins, eval verdicts and `created` dates. The recommendation is
   no, because `--collection site` already keeps the records out.
2. Should a guard check the published files? A bare publish still writes
   records beside `graph.out`. The recommendation is no guard, because CI
   publishes `--collection site` and the plugin no longer writes there.

## What this supersedes

0103 decision 1 had the plugin publish into the project's own graph output
where `graph:` is set. Every project with `collections:` now publishes into
the plugin's data directory.

## Verification

`test/graph/unit/authoring.test.ts` covers each value the flag drops, and
`test/graph/integration/authoring.test.ts` runs the built CLI. A run with
nothing author-facing writes the same bytes and stdout both ways.
`test/graph/unit/derive-strategy.test.ts` and `strategy-shapes.test.ts` cover
the typing and the shapes. Every golden is unchanged. The dogfood diffs a
`--collection site` publish against one from `main`.
