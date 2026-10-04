---
status: accepted
date: 2026-07-23
decision-makers: [hawkeyexl, Claude]
---

# Section-level iiRDS metadata via a slug-keyed `kg.sections` map

## Context and Problem Statement

dockg already emits one `dockg:Section` node per heading (IRI `{docIri}#{slug}`,
GitHub-style heading slug). But the iiRDS typing added in
[ADR 01012](adrs/01012-iirds-core-vocabulary.md), and every other `kg` field,
only attaches at the **document** level. That leaves a granularity gap the iiRDS
research explicitly warns about. The "granularity golden rule" says content
granularity must match node granularity. A single document's *Installation*
section is a `task` while its *Architecture* section is a `concept`. One section
may apply to a product variant the rest of the document does not. Without
per-section metadata, a graph consumer routing at section granularity has
nothing to route on.

How should metadata attach to sections, which fields, with what inheritance, and
what happens when a section reference goes stale?

## Decision Drivers

- Keep all metadata in frontmatter. dockg has never parsed the document body
  for metadata, and the frontmatter-only contract is load-bearing.
- Reuse the existing section-slug identity (section IRIs, link anchors already
  key on it) rather than inventing a new addressing scheme.
- Determinism and the closed-shapes contract are unchanged obligations.
- Do not silently drop metadata. A stale reference is the self-inflicted form
  of the "information evaporation" this roadmap exists to prevent.

## Considered Options

- **Authoring.** A slug-keyed `kg.sections` map against inline body directives.
- **Fields.** iiRDS typing only · iiRDS typing plus `subjects` · all `kg` fields.
- **Inheritance.** Explicit-only against inherit-and-override from the document.
- **Slug drift.** A `dockg:brokenSectionRef` finding · silent drop · hard error.

## Decision Outcome

**Authoring: a slug-keyed `kg.sections` map.** `kg.sections.<heading-slug>: {…}`,
where the key is the same GitHub-style slug used for the section's IRI and for
link anchors. This keeps metadata in frontmatter, is JSON-Schema-validatable,
and joins on an identity the graph already uses. Inline body directives were
rejected: they would introduce body parsing dockg has never done and break the
frontmatter-only contract.

**The fields are the four iiRDS typing fields plus `subjects`.** Those are
`topicType`, `appliesTo`, `softwareLifecyclePhase`, `softwareSubject`, and
`subjects`. `prefLabel`, `altLabels`, `broader`, `narrower` and `related` are
excluded. `prefLabel` maps to `foaf:primaryTopic`, a document's *primary* topic,
which is meaningless per section. The SKOS hierarchy fields hang off that
primary topic. The included set is exactly the metadata whose per-section
meaning is unambiguous.

**Inheritance: explicit-only.** A section node carries exactly what its
`kg.sections.<slug>` block declares; it inherits nothing from the document. This
keeps the graph small (no repetition of the document's typing on every section)
and every triple's origin unambiguous. A consumer that wants the document's
typing reads it on the document node. Inherit-and-override was rejected: it
bloats the graph and blurs provenance for a convenience that authors can express
directly.

**Slug drift: `dockg:brokenSectionRef`.** A `kg.sections` key that matches no
heading derives `<doc> dockg:brokenSectionRef "slug"` (a literal), surfaced by
`dockg stats` and folded into the `stats --check` gate, exactly mirroring
`dockg:brokenLink`. A renamed or removed heading surfaces its orphaned
metadata as a visible finding. Dropping it silently was rejected, and so was
failing the build. A heading rename should degrade to a finding, as broken
links do, rather than break the build.

**Source gating.** All of the above lives under the `sections` derive source.
Without section nodes there is nothing to attach to, and every `kg.sections` key
would falsely read as broken. One consequence is worth stating. Section
`subjects` derive under the `sections` source, whereas document `subjects`
derive under `tags`. That asymmetry is deliberate, since section metadata is one
feature with one gate. It does not change what either emits (`dcterms:subject` →
a shared `skos:Concept`).

### Consequences

- Good. Section-granularity routing, filtering, and typing become possible,
  closing the granularity gap without a new addressing scheme or body parsing.
- Good. The `dockg:` namespace grows by exactly one property
  (`brokenSectionRef`), consistent with the `brokenLink` precedent. The section
  iiRDS predicates reuse the Phase 2 `iirds:` terms.
- Good. Stale references are loud, not silent.
- Bad. The closed Section shape must learn five predicates
  (`shapes/dockg-0.3.ttl`), and the Document shape one more. Until it does,
  `dockg check` fails on them, which is the intended gate.
- Neutral. Two authoring surfaces for the same fields (document-level and
  `kg.sections`). The schema factors the shared subschemas via `$defs` so they
  cannot diverge, and a drift guard pins the enums.

### Confirmation

`schemas/frontmatter-0.6.json` defines `kg.sections` with the value object's
fields drawn from the same `$defs` as the document-level fields;
`test/unit/schema-sync.test.ts` pins those enums to `src/core/iirds.ts`.
`test/unit/derive.test.ts` asserts four things. A matching slug attaches iiRDS
triples to the section node. An unmatched slug emits `dockg:brokenSectionRef`,
an absent `kg.sections` emits nothing, and a section does **not** receive the
document's typing. `test/unit/shacl.test.ts` validates a conforming section
and rejects an out-of-`sh:in` section topic type against `dockg-0.3.ttl`.
`test/integration/check.test.ts` keeps the clean corpus at exit 0, and
`test/integration/query-stats.test.ts` covers `brokenSectionRef` reporting and
its `--check` gate. The determinism gates (double-build, version-normalized
golden, n3 round-trip) cover the new triples.

## Pros and Cons of the Options

### Slug-keyed `kg.sections`

- Good. Frontmatter-only; reuses the existing slug identity; validatable.
- Bad. A key can go stale when a heading is renamed (mitigated by
  `brokenSectionRef`).

### Inline body directives

- Good. Metadata co-located with the section it describes.
- Bad. Requires body parsing dockg has never done; breaks the frontmatter-only
  contract; harder to validate.

### Explicit-only vs. inherit-and-override

- Explicit-only keeps the graph minimal and provenance clear. The cost is that
  "the whole doc is about X" must be stated on the doc, not auto-propagated to
  sections. That is correct, since the doc node already carries it.

### `brokenSectionRef` vs. silent / error

- The finding mirrors `brokenLink`: visible in `stats`, gated by `--check`,
  never a build-breaker. Silent drop hides evaporation; a hard error
  over-punishes a routine heading rename.
