---
status: accepted
date: 2026-07-24
decision-makers: [manuel.r.b.silva]
---

# JSON-LD export via a deterministic hand-rolled serializer

## Context and Problem Statement

dockg's graph reaches consumers only as Turtle. Turtle is the canonical
git-diff form (`src/core/emit.ts`). But the wider web consumes RDF as
**JSON-LD**, meaning answer engines, search crawlers, and JSON tooling. Because
dockg already emits `schema.org` terms, a JSON-LD rendering of the same graph is
directly usable by that audience with no lossy remapping. The roadmap's export
arc (Phase 6) starts here, with a `dockg export --format jsonld` command that
reserializes the built graph as JSON-LD.

The question is not _whether_ to emit JSON-LD but _how_ to keep it inside
dockg's determinism contract. Two exports over the same graph must be
byte-identical, with no wall clock and no blank nodes, exactly as the Turtle
emitter guarantees.

## Decision Drivers

- **Determinism is the product contract.** JSON-LD output must be byte-stable
  and regression-gated by a golden, like the Turtle output.
- **Losslessness.** The endgame is a GraphRAG index; an export that silently
  drops triples would corrupt any round-trip. Every triple must survive.
- **No new heavy dependencies.** dockg has no `jsonld` library and deliberately
  hand-rolls its Turtle emitter so formatting is controlled, not incidental
  library behavior.
- **Stable flag surface.** The `--format` flag should name the formats the
  export arc will grow into (iiRDS package is Phase 6b) without shipping them
  half-done.

## Considered Options

1. **Hand-rolled deterministic JSON-LD serializer** mirroring the Turtle
   emitter. Group by subject, compact CURIE keys, sort everything, build
   objects in sorted key order, `JSON.stringify(_, null, 2)`.
2. **The `jsonld` npm library** (`jsonld.toRDF`/`fromRDF`/`compact`). Its
   output order and formatting are library-defined and not guaranteed stable
   across versions; pinning determinism would mean post-processing its output
   anyway.
3. **Emit JSON-LD as an extra `build` output** rather than a standalone
   command.

## Decision Outcome

**Option 1** was chosen, a hand-rolled `emitJsonLd(quads)` in
`src/core/emit-jsonld.ts`, delivered through a standalone
`dockg export --format jsonld` command (`src/commands/export.ts`) that reads the
built graph the same way `stats` and `check` do.

The output shape is `{ "@context": <PREFIXES table>, "@graph": [ …nodes ] }`.
Nodes are grouped by subject, and `rdf:type` folds into `@type` with compacted
class IRIs. Other predicates use compacted CURIE keys (`compactIri`). IRI
objects become `{ "@id": … }`, plain literals the bare string, and typed
literals `{ "@value": …, "@type": "xsd:…" }`. Single-valued predicates emit a
scalar and multi-valued ones a sorted array. That is a cardinality-driven rule
which is still fully deterministic. dockg emits no blank nodes and no language-tagged literals, so
neither needs handling.

Determinism: `@graph` sorted by `@id`; within a node, predicate keys sorted and
each value array sorted; `@type` sorted; objects built in sorted key order so
`JSON.stringify` is byte-stable. The only variable is the `dockg:version`
literal, normalized in the golden exactly as for Turtle.

`--format` recognizes `iirds` but returns a `DockgError` ("not yet supported
(Phase 6b)") so the flag surface is stable while the iiRDS package serializer is
built out separately.

### Consequences

- Good. Web-native, lossless export with zero new runtime dependencies and the
  same determinism guarantees as Turtle.
- Good. The `export` command generalizes, and Phase 6b adds `iirds` behind the
  same flag.
- Neutral. A second serializer to maintain. Mitigated by a golden regression
  gate and an n-triples-count equivalence check against the source graph.
- Bad. The cardinality-driven scalar/array rule means a predicate's JSON shape
  depends on how many values a given node has. This is standard compacted
  JSON-LD and consumers handle both, but it is worth stating.

### Confirmation

- Unit test over a hand-built quad set: `@type` folding, IRI/plain/typed
  literal rendering, `@context` presence, sorting, valid JSON.
- Integration test. `dockg export --format jsonld` over the corpus matches a
  version-normalized golden `test/fixtures/golden/graph.jsonld`. A double export
  is byte-identical, the `@graph` node count equals the graph's distinct-subject
  count, and `--format iirds` and a missing graph both exit 2.
- The Turtle golden is untouched.

## Pros and Cons of the Options

### Option 1, a hand-rolled serializer

- Good. Total control over byte output → determinism by construction.
- Good. No new dependency; mirrors the established Turtle-emitter philosophy.
- Bad. We own the escaping/compaction logic (already own it for Turtle).

### Option 2, the `jsonld` library

- Good. Spec-complete, handles framing/expansion we don't need.
- Bad. Output ordering and formatting are not a stability contract. Determinism
  would require post-processing its output, which is most of option 1's work
  plus a dependency.

### Option 3, an extra `build` output

- Good. One command produces every artifact.
- Bad. Couples format proliferation to the build path; `stats`/`check` already
  establish the "read the built graph" command pattern that export follows.
