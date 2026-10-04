---
status: "accepted"
date: 2026-08-29
decision-makers: [hawkeyexl]
---

# `fill` proposes section metadata, in the document's own call

## Context and Problem Statement

[ADR 01013](01013-section-level-metadata.md) made section metadata first-class. The graph has had
per-section nodes since Phase 3, and the granularity golden rule says content granularity must
match node granularity. [ADR 01015](01015-fill-confidence.md) deferred section-level fill, and that
deferral has become the binding constraint.

The audience it binds is the one `fill` exists for. The brownfield lens is hundreds to thousands
of pages with no realistic prospect of hand-annotation. Section metadata is explicit-only, so a
`sections` block has to be written for every heading that needs one, by hand, on every page.
[ADR 01029](01029-coverage-catches-up-with-the-vocabulary.md) made the gap measurable. Section
coverage starts at 0% on any corpus that has not adopted it, and the regression corpus sits at
11.1%.

## Decision Drivers

- Cost. `fill` is the one command that spends money, and a per-section call would multiply requests
  by the number of headings.
- A model must not be able to create a `dockg:brokenSectionRef`. That finding is what `stats`
  reports when a `sections` key matches no heading; `fill` manufacturing one would be the tool
  fabricating its own error condition.
- Human values are never overwritten without `--force`, and that must hold *per section* rather
  than per document.
- Structured output has to survive every provider. OpenAI's strict `json_schema` (and the GBNF
  grammar Ollama compiles it into) requires `additionalProperties: false` on every object.

## Considered Options

1. **One call per document, sections as a list in the same schema.**
2. **One call per section.**
3. **Sections as a map keyed by slug** in the same call.
4. **Leave it deferred**, and document hand-authoring.

## Decision Outcome

**Option 1 was chosen**, opt-in behind `fill.sections` and `--sections`.

### A list, not a map

The obvious shape is `sections: {<slug>: {...}}`. It cannot be used. Strict structured output
requires `additionalProperties: false` on every object, which cannot express an open-keyed map. So
the schema is a **list of `{slug, …}`**. That says the same thing in a shape every provider can
constrain, and dockg turns it back into a map on the way in. The prompt shows each heading's real
slug beside its title so the model has something exact to copy.

### One call, not N+1

Sections ride along in the document's existing call. There are no extra requests, and the model
sees the whole page. It needs that, because typing a section well depends on how it differs from
the page around it. The prompt says so. Include a section only when its own content differs
meaningfully, rather than repeating the page's values on every heading.

### Dotted field names, so one code path serves both

A section proposal becomes `sections.<slug>.<field>`. `applyKgFields` learned to walk a dotted name
into nested maps. Everything downstream treats these as ordinary fields: the confidence gate,
the SHACL guardrail, the never-overwrite rule, and the `kg.provenance` record. **Preservation is
decided at the leaf**, so a value a human set on one section survives while the section beside it is
still filled.

### An invented slug is dropped

A proposed slug matching no heading is discarded and reported as `unknownSections`. Writing it would
mint a `dockg:brokenSectionRef`, the finding ADR 01013 added so slug drift is never a silent drop.
`fill` reporting that finding is correct. `fill` *creating* it would be the tool fabricating its
own error condition.

### Opt-in

Off by default. It costs more output per document, and section metadata carries the same review
obligation as anything else a model writes. [ADR 01009](01009-opinionated-defaults.md)'s
default-on rule covers hermetic features, and this is neither hermetic nor free.

### Consequences

- **`PROMPT_VERSION` 2 → 3**, invalidating every cached proposal. The prompt contract changed.
- The cache key gains the sections flag. Same fields, different request. A sections run sends a
  different schema and prompt. Its answer must not be served from a doc-only entry, or the other
  way round.
- `label` is not proposable per section, following ADR 01013's ruling that a primary topic per
  section is meaningless.
- `analyzeDoc` now runs for every document, not only on a cache miss. A cached proposal can carry
  sections, and its slugs still have to be checked against real headings. Local parsing, cheap
  beside an LLM call.
- Section fill inherits the graph guardrail unchanged: a section-level `applies-to` that contradicts
  its own `not-applicable-to` is an `sh:disjoint` violation and is rejected before it is written.

### Confirmation

`test/unit/fill-sections.test.ts`, where the refusals matter more than the happy path:

- values land under the matching slug, and the document keeps its own type;
- an invented slug is dropped, reported as `unknownSections`, rendered as
  `[no such section: renamed-heading]`, and **absent from the file**;
- a section field below `minConfidence` is reported and not written;
- a human's section value survives while the section beside it is filled, and is reported as
  `preserved` under its dotted name;
- with sections off, a provider that volunteers them anyway is narrowed away.

End to end, the frontmatter shape this writes passes `dockg validate`. It derives
`iirds:has-topic-type` on the section node, and passes `dockg check` with no findings.

## Pros and Cons of the Options

### 1. One call, sections as a list

- Good, because it adds no requests and gives the model the context section typing needs.
- Good, because the list shape survives strict structured output on every provider.
- Bad, because a long page's sections compete with the document's own fields for output budget, and
  a small model may simply omit them.

### 2. One call per section

- Good, because each section gets the model's full attention.
- Bad, because it multiplies cost by heading count on exactly the corpora too large to
  hand-annotate. Each call would also lack the surrounding page, which is what makes a section's
  type meaningful.

### 3. A map keyed by slug

- Good, because it matches the frontmatter shape exactly, with no conversion.
- Bad, because strict structured output cannot express it. It would work on some providers and
  fail on others, the kind of difference that shows up as a mysterious provider-specific bug.

### 4. Leave it deferred

- Good, because hand-authored section metadata is more trustworthy than proposed metadata.
- Bad, because it is not being hand-authored. Coverage says 11.1% on the corpus that ships with the
  tool, and the audience `fill` serves cannot reach it by hand at all.
