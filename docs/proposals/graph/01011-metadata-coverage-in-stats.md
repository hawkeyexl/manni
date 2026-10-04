---
status: accepted
date: 2026-07-22
decision-makers: [hawkeyexl, Claude]
---

# Report metadata coverage in `dockg stats`, gated by per-field thresholds

## Context and Problem Statement

ADR 01008 fixed the graph's role as an index over the docs. It drew the
consequence that whatever is not lifted into the graph is invisible to
graph-side consumers. Nothing measures that. A corpus where three quarters of
the docs carry no description and half carry no subject produces a thin index.
The first symptom appears downstream, in whatever consumes the graph.

dockg should turn that silence into a number, in the tool users already run for
graph health. Two questions follow: what exactly is measured and how is it
reported, and is it merely reported or also enforceable?

## Decision Drivers

- ADR 01008 makes coverage of lifted metadata a first-class product concern,
  not a user-preference detail.
- ADR 01009 defaults reporting on. A *gate* needs a defensible value, and
  arbitrary gate defaults manufacture false failures.
- Determinism requires identical graph → identical report, stable field order,
  and no float-formatting drift.
- The measurement must reflect the graph, not the frontmatter. A date dockg
  derived from git history is in the index and should count as covered.
- Enforcement must fit the existing exit-code contract and `--check` semantics
  rather than inventing new ones.

## Considered Options

**What to measure:**

1. A fixed list of per-document predicates.
2. Every predicate observed in the graph (fully dynamic).

**How to enforce:**

1. A single uniform threshold across all fields.
2. Per-field thresholds, with a uniform number as shorthand.
3. Report-only; no gate at all.

## Decision Outcome

**Measure a fixed list of per-document predicates.** Coverage counts, for each
field, how many `dockg:Document` nodes carry the mapped predicate:

| field | predicate |
|---|---|
| `title` | `dcterms:title` |
| `description` | `dcterms:description` |
| `creator` | `dcterms:creator` |
| `created` | `dcterms:created` |
| `modified` | `dcterms:modified` |
| `subject` | `dcterms:subject` |
| `prefLabel` | `foaf:primaryTopic` |

`language` (`dcterms:language`) is deliberately **not** measured. Almost no
corpus sets a per-document language, so the field would read 0% in nearly every
report. That is noise in the common case rather than a signal. It can be added
later if multilingual corpora make it meaningful. The drift guard below makes
adding a field a one-line, review-visible change.

A fixed list is the point. The report answers "how complete is my metadata"
against a known target, which a dynamic list cannot do. A predicate absent from
every document would simply never appear, which is exactly the gap worth
showing. The cost is that new lifted predicates, such as Phase 2's iiRDS terms,
must extend this list deliberately. The corpus test pins the field set, so
forgetting is visible in review.

Coverage is measured **against the graph**, so a `dcterms:created` that came
from git history counts as covered. That is consistent with ADR 01008: the
question is what a graph-side consumer can see, not where it came from.

**Report shape.** Percentages round to one decimal
(`Math.round(pct * 1000) / 10`). A graph with zero documents is vacuously 100%
covered, which keeps the gate from failing on an empty graph and avoids a
divide-by-zero. Pretty output gets a `Coverage` block; JSON gets an ordered
array of `{field, predicate, docs, pct}` so consumers get stable ordering
without re-sorting.

**Per-field thresholds, defaulting to no gate.** `stats.coverageThreshold`
accepts either a number (uniform, expanded across all fields) or a map of
field → percent. Both normalize to a total `Record<field, number>` in the
resolved config, defaulting to `{}` with no field gated. Under `--check`, any
field strictly below its threshold is a finding → exit 1, alongside the existing
broken-link gate.

A uniform-only threshold was rejected on arithmetic, not taste. The gate would
be dominated by whichever field a corpus legitimately never sets.
`prefLabel` and `creator` are the concrete case. The regression corpus carries
them on one of four documents (25%), because most docs need neither an explicit
topic concept nor an author. `coverageThreshold: 80` would fail that corpus on those
fields alone, making the knob unusable above low values. Per-field thresholds
let a team demand 100% titles and 50% descriptions while leaving `prefLabel`
ungated, which is the actual shape of the requirement.

Following ADR 01009, the default gates nothing. Coverage is *reported* by
default because reporting is cheap and safe. A threshold value defensible
for every corpus does not exist. The CLI flag `--coverage-threshold <n>` sets
the uniform form only, and the map is config-only. That matches the repo's rule
that per-invocation overrides get flags while corpus-defining settings may be
config-only.

### Consequences

- Good. The evaporation boundary from ADR 01008 is a number in every `stats`
  run, and CI-enforceable per corpus and per field.
- Good. No new command and no new exit-code semantics.
- Good. Teams can adopt the gate incrementally, one field at a time.
- Bad. The field list is hard-coded and must be extended as later phases lift
  new predicates. A forgotten extension shows up as a silently unmeasured
  field.
- Bad. Two config shapes for one key, number or map, is more schema surface
  than a plain number. The resolved type also differs from the authored one.
- Neutral. Fields dockg cannot derive for a given document legitimately depress
  coverage. That is the measurement working, not a defect.

### Confirmation

`test/integration/query-stats.test.ts` pins the corpus's exact values. Title
100%, subject 50%, and description, creator, created, modified and prefLabel at
25% each, plus JSON field order. Gate cases run on per-test scratch corpora.
The regression corpus's deliberate broken link makes its `--check` always exit
1, so it cannot isolate the coverage gate. Those cases are a uniform threshold
failing and a per-field map gating only a satisfied field passing. Then a map
gating an empty field failing, and no threshold leaving `--check` at 0.
`test/unit/config.test.ts` pins the default `{}`. It also pins a uniform number
expanding to exactly the seven field names and the map form passing through.
Out-of-range or unknown-field values are rejected by Ajv.
`test/unit/schema-sync.test.ts` asserts
the schema's `coverageThreshold` property names equal `COVERAGE_FIELDS`, so the
fixed list cannot silently drift from the config surface.

## Pros and Cons of the Options

### Fixed field list

- Good. Measures against a known target, so absent-everywhere fields still
  show up as 0%.
- Bad. Needs deliberate extension as the vocabulary grows.

### Dynamic predicate census

- Good. Never goes stale.
- Bad. Cannot report what is missing everywhere, which is precisely the gap
  that matters. The report's shape would also change with the corpus, which
  makes it useless as a CI gate.

### Uniform threshold only

- Good. One number, trivial to document.
- Bad. Dominated by the least-set field; unusable above low values without
  forcing teams to tag metadata they do not want.

### Report-only, no gate

- Good. Smallest surface.
- Bad. Coverage regressions stay invisible in CI, which is where they would
  otherwise be caught cheaply.
