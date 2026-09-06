---
status: accepted
date: 2026-07-24
decision-makers: [manuel.r.b.silva]
---

# Lexical entry through a search artifact beside the graph, not prose inside it

## Context and Problem Statement

Phase 7's runtime can only start from an IRI you already know. Retrieval needs
the stage before that: **a text question → ranked starting nodes**. Without it
`retrieve()` (Phase 9) has no entry point, and the graph can only be walked by
someone who already knows where to stand.

The obstacle is structural. **The graph carries no prose**, by design. ADR 01008
makes it an index and governance layer, never a corpus. `dockg:Document` has
`dcterms:title` and `dcterms:description`. `dockg:Section` has *only* a title,
and `skos:Concept` has pref and alt labels. A lexical index over that text alone
answers "how do I configure the SP-X100?" as a title match. It cannot answer
"what is the default cache directory?", because those words only exist in the
body. That is precisely the *information evaporation* failure the design
research warns about, surfacing as a concrete product limitation.

So body text must come from somewhere. It must not violate the graph-as-index
contract, and the runtime must not fetch every document before it can answer a
single query.

## Decision Drivers

- **Graph-as-index is not negotiable** (ADR 01008). Prose must not enter the graph.
- **Hermetic.** Entry must work with zero network and zero spend. That lets it
  be a default-on feature (ADR 01009), and lets Phase 10's eval need no LLM.
- **Determinism extends to entry ranking** (ADR 01018 invariant 1).
- **Browser weight.** The runtime is a 6 KB drop-in, and whatever this adds is
  paid by every consumer.
- **Retrieval granularity.** The design's golden rule says content granularity
  must match node granularity.

## Considered Options

**Where body text comes from.** (a) A build-time search artifact beside the
graph. (b) The runtime fetching documents through the `ContentResolver` and
indexing at page load. (c) Prose lifted into the graph. (d) Indexing only graph
metadata and accepting that body words are unfindable.

**Scoring engine:** (a) MiniSearch; (b) a hand-rolled BM25.

## Decision Outcome

### Body text comes from a build-time artifact (option a)

`dockg export --format search` emits **`kg/search.json`**, a sibling of
`graph.ttl` and `graph.jsonld`. That is the Pagefind and VitePress pattern. It is
produced in Node from markdown already on disk, so it stays hermetic. It is a
separate artifact, so the graph remains prose-free and ADR 01008 holds.

The rest were rejected. (b) costs N requests before the first query and
re-indexes on every page load. (c) breaks the graph-as-index contract outright.
(d) is the status quo whose inadequacy motivates this phase.

Like the iiRDS projection (ADR 01017), the exporter walks the built graph and
reads each `dockg:path` from disk. That is the same precedent, so `export`
reading source files is not a new capability.

**The shape** is plain JSON dockg owns, *not* MiniSearch's serialized index:

```json
{ "version": 1,
  "entries": [ { "id": "<iri>", "type": "dockg:Section",
                 "title": "Options", "labels": "config settings",
                 "text": "## Options\n\n…" } ] }
```

Owning the format keeps determinism our contract rather than a library's
internal representation. It keeps the artifact diffable in review, and lets the
engine change without changing the artifact. Building the index at load costs
milliseconds at docs scale. Entries are sorted by `id`, empty fields are
omitted, and there is no wall clock, so runs are byte-identical.

**Indexed node types:** `dockg:Document`, `dockg:Section`, `skos:Concept`.
Concepts are worth seeding from (concept → the documents about it);
`iirds:ProductVariant` is not, because a variant is a *scope filter*, not
something to read.

**The granularity rule is that every node indexes exactly the text it owns.** A
**Section** carries its text down to the next heading of *any* rank, since
subsections are their own nodes. A **Document** carries title and description
plus the prose no section covers. That is its *preamble*, the text before the
first heading. It carries its whole body when it has no sections at all.

The rule is "own text", not "no text when sections exist", because both failure
modes are real. If a document repeated its sections' text it would match
everything they match and shadow them in the rankings, while doubling the
artifact. But if it carried nothing, preamble prose would be indexed *nowhere*
and become unfindable. That is the same evaporation this artifact exists to
prevent, reintroduced at a smaller scale. Owning the complement of its sections
avoids both, with no duplication and no gap.

The rule applies at *both* boundaries, Document→Section and Section→Section.
Enforced only at the first, an H1 section carries its whole subtree and outranks
every heading beneath it. That is the same shadowing, one level down.

Slicing reuses `sectionOwnText`, `documentPreamble`, and `sliceSection` from
[src/runtime/resolve.ts](../src/runtime/resolve.ts). They are the runtime's own
functions, so index-time and retrieval-time text cannot drift. One difference is
deliberate. **Retrieval** uses `sliceSection`, which keeps the subtree, because
asking for "Configuration" should hand back its subsections too. **Indexing**
uses `sectionOwnText`, which does not, because a parent that repeats its
children outranks them. All are fence-aware: a `#` comment in a code block is
not a heading.

A document's body text has its **frontmatter stripped**. The block is machinery,
not prose. Left in, a query for `prefLabel` or `altLabels` would match every
document that has one. Section slices start at their heading and never see it.

### The engine is MiniSearch (option a), with an explicit cost

The maintainer chose it over a hand-rolled BM25, for a battle-tested tokenizer
and fuzzy and prefix matching. That is typo tolerance a ~100-line BM25 would not
have.

The cost is stated plainly. **The runtime loses its zero-dependency property.**
`minisearch` becomes dockg's first production runtime dependency, bundled into
`dist/runtime.js` (tsup `noExternal`) to preserve the single-file browser
drop-in. Left external, the bundle would carry a bare `import MiniSearch from
"minisearch"` that no browser can resolve without an import map or a bundler.
The bundle-purity gate therefore narrows from "no npm dependency" to **an
allow-list of exactly `minisearch`**, plus an assertion that it is *inlined*
rather than imported. Every other dependency, every `node:` specifier, and every
Node-only global still assert absent.

Measured cost, as shipped (unminified, matching the rest of `dist/`):
**22.7 KB gzipped, up from 6.4 KB**. After a consumer's bundler minifies, it is
**10.6 KB gzipped**. The widely-quoted "~6 KB MiniSearch" figure is its
minified-and-gzipped size in isolation. The real delta here is larger, and worth
knowing before the vector leg adds more in Phase 8b.

Two determinism guards exist, because a library's scoring is not a stability
contract. Ranking ties are **broken by IRI** in our code, since MiniSearch does
not guarantee tie order. And the artifact format is ours, so a MiniSearch
upgrade can change ranking but can never change the committed artifact.

### The hybrid seam ships now, unused

`rrfMerge(rankings, k = 60)` (reciprocal rank fusion) lands in this phase with
tests, even though only one ranking exists. With a single list it is an identity
ranking. This is not dead code: it fixes the merge contract before Phase 8b's
vector leg arrives, so adding embeddings cannot reshape the entry API.

### Consequences

- Good. A text question now reaches the right nodes *including by body text*,
  hermetically, with no model and no network.
- Good. `retrieve()` in Phase 9 becomes orchestration over existing parts.
- Neutral. One more artifact to publish alongside the graph, and one more
  determinism gate.
- Bad. The runtime is no longer dependency-free, and grows by roughly the size
  of MiniSearch. Accepted deliberately for tokenizer quality and typo tolerance.
- Bad. `search.json` embeds document text, so publishing it publishes that text.
  Harmless for public docs sites (the same text is already served); worth stating
  for private corpora.

### Confirmation

Unit tests cover the artifact. They check per-type entries, the granularity rule
in both directions, label dedupe across case variants, and byte-identical
rebuilds.
Runtime tests include **a body-only term that is invisible to the graph**, the
case that justifies the artifact's existence. Then `rrfMerge` fusion tests, an
integration test against a `search.json` golden plus a `dockg search` CLI run,
and the updated bundle-purity gate with the new size recorded.

## Pros and Cons of the Options

### (a) Build-time artifact, chosen

- Good. Hermetic, deterministic, one fetch, graph stays prose-free.
- Bad. Another artifact to ship and keep in sync with the graph.

### (b) Resolve-and-index at load

- Good. No new artifact; always matches the live docs.
- Bad. N fetches before the first query; re-indexes every page load; unusable
  offline.

### (c) Prose into the graph

- Good. One artifact.
- Bad. Violates ADR 01008, bloats every graph consumer, and makes the Turtle
  golden a corpus diff.

### (d) Graph metadata only

- Good. Zero new anything.
- Bad. Body words stay unfindable, the evaporation failure this phase exists to fix.

### Engine (b), a hand-rolled BM25, not chosen

- Good. Keeps zero dependencies and full determinism ownership; matches the four
  hand-rolled serializers already in this repo.
- Bad. No fuzzy/prefix matching, so ordinary typos miss; more scoring code to own.
