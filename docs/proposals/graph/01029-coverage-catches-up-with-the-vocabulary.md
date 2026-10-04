---
status: "accepted"
date: 2026-08-29
decision-makers: [hawkeyexl]
---

# Coverage measures the vocabulary, and measures sections

## Context and Problem Statement

Metadata coverage exists as the countermeasure to information evaporation
([ADR 01011](01011-metadata-coverage-in-stats.md)): the number that says what a graph-side consumer
can and cannot see. It measures seven fields, all of them chosen before Phase 2.

Since then the vocabulary grew substantially. Phase 2 added iiRDS topic types and product variants,
Phase 2 the software domain, Phase 4 negative scope, Phase 3 section-level metadata. Coverage
measured none of it. A corpus could type zero documents, scope zero of them to a product, and
report a clean 100%. The countermeasure was blind to four phases of the thing it exists to
measure.

Sections are the sharper half. The graph has had `dockg:Section` nodes since Phase 3 and section
metadata is first-class scope. The granularity golden rule says content granularity must match
node granularity. `stats` counted section nodes and said nothing about whether any of them carried
metadata.

## Decision Drivers

- Coverage's stated job is "what can a consumer see". A field the vocabulary supports and the
  corpus never sets is exactly what it should surface.
- **A fixed list is the point** (ADR 01011). A dynamic census cannot show 0% for a field nobody
  uses, which is the most informative number in the table.
- Reporting on by default does not imply gating on by default
  ([ADR 01009](01009-opinionated-defaults.md)).
- A table nobody reads is worse than a smaller one. Rows that are structurally always near zero
  train readers to skip it.

## Considered Options

1. **Add the affirmative iiRDS fields; report sections separately and ungated.**
2. **Add every new predicate**, negatives included, on one axis.
3. **Add nothing to the fixed list**; let a `--fields` flag select what to measure.
4. **Add the fields but gate sections too**, for symmetry.

## Decision Outcome

**Option 1 was chosen.**

Four fields join the document table, `type`, `applies-to`, `about-product-lifecycle`, and
`about-product-aspect`, taking it from seven to eleven. A second table reports the same iiRDS
fields plus `subject` over `dockg:Section` nodes.

**The two negative predicates are excluded, deliberately.** `not-applicable-to` and
`not-about-product-aspect` are absent from almost every document, and under open-world semantics
([ADR 01014](01014-negative-scope.md)) that absence means *unknown*, not *missing*. Counting it as
a gap would leave every healthy corpus permanently near zero on two rows. Coverage measures what an
author lifted; a negative assertion nobody needed to make is not an omission.

**`label` is excluded from the section table** for the reason ADR 01013 gave when it declined
`prefLabel` at section level. A "primary topic per section" is meaningless, so it cannot be
missing.

**Section coverage is reported, never gated.** Sections are explicit-only. A section gets exactly
what its own block declares, and nothing from its document. So the number starts at zero on every
corpus that has not adopted `kg.sections`. A default gate would fail all of them, which is how a
gate gets switched off and stays off. Reporting it makes the granularity question visible without
making it an obstacle. A `sectionCoverageThreshold` can be added when someone has a corpus where
it would be green.

### Consequences

- **Breaking for anyone using the uniform shorthand.** `coverageThreshold: 80` now gates eleven
  fields rather than seven, and the four new ones start low on most corpora. That is the ratchet
  behaving correctly, since a uniform number means "every measured field" and the measured set
  grew. It will still turn a green gate red on upgrade. The per-field map form is unaffected, and
  unlisted fields are still ungated.
- The report is longer and the field-name column wider, so captured `stats` output changes. Each
  documented capture was re-taken from the binary. The doc-detective suite caught the padding
  change on `get-started/index.mdx` before a human did. That is the first thing that runner has
  paid for since it returned.
- `SECTION_COVERAGE_FIELDS` joins the public library surface next to `COVERAGE_FIELDS`.
- The regression corpus now reports 60% typed documents and **11.1%** typed sections. The second
  number is the one worth having.

### Confirmation

- `test/integration/query-stats.test.ts` pins the exact eleven-row document table and the exact
  five-row section table for the corpus, as JSON. It also covers both blocks in the pretty
  rendering, and a scratch corpus with sections at 0% that gates green under `--check`. That proves
  section coverage cannot fail a build.
- `test/unit/config.test.ts` asserts the uniform shorthand expands across all eleven names.
- `test/unit/schema-sync.test.ts` already pins `COVERAGE_FIELD_NAMES` against the config schema's
  threshold map, so the two cannot diverge.

## Pros and Cons of the Options

### 1. Affirmative fields, sections separate and ungated

- Good, because every row is a field whose absence is genuinely a gap.
- Good, because the section number surfaces the granularity question without failing anyone.
- Bad, because the uniform shorthand's meaning silently widens. Pre-release, this is affordable;
  post-1.0 it would need a migration.

### 2. Every predicate on one axis

- Good, because it needs no judgement about what counts.
- Bad, because two rows would sit near zero forever by design, and a table with permanent noise in
  it stops being read.

### 3. A `--fields` selector

- Good, because each corpus measures what it cares about.
- Bad, because it destroys the property ADR 01011 was built on. A field nobody selected shows
  nothing at all, and the absent-everywhere case is precisely the one worth seeing.

### 4. Gate sections too

- Good, because symmetric.
- Bad, because it fails every corpus on day one. A gate that is red before you start is a gate
  people delete.
