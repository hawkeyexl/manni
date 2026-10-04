---
status: accepted
date: 2026-07-24
decision-makers: [hawkeyexl, Claude]
---

# Explicit negative scope, minting `dockg:` non-applicability predicates

## Context and Problem Statement

The iiRDS research's central safety mechanism is the **interlock**. A
graph-governed assistant must be able to *refuse*, saying "this content does NOT
apply to variant X" rather than helpfully guessing across a boundary. dockg's
positive applicability ([ADR 01012](adrs/01012-iirds-core-vocabulary.md)) lets a
document or section say what it *does* apply to
(`iirds:relates-to-product-variant`) and what it *is about*
(`iirds:has-subject`). But RDF is **open-world**. The absence of a positive edge
means "unknown," not "does not apply." So absence alone cannot drive an
interlock. A consumer cannot distinguish "this doc is silent about variant X"
from "this doc explicitly excludes variant X."

How should dockg let content assert **explicit non-applicability**, so a
retrieval layer can implement disciplined silence without inferring from missing
data?

## Decision Drivers

- Determinism and the **no-blank-nodes** invariant are absolute.
- SHACL is dockg's validation contract; the solution must be SHACL-validatable
  as ordinary triples.
- Prefer a standard term over minting into the minimal `dockg:` namespace.
- The negation must be a plain, queryable edge a naive consumer can read. The
  whole point is that a retrieval interlock can act on it.

## Considered Options

1. **Mint minimal `dockg:` predicates.** One negating variants, one negating
   subjects, as plain `<subject> <predicate> <object>` triples.
2. **`owl:NegativePropertyAssertion`.** The OWL-standard idiom for "X does not
   have relation R to Y."
3. **Reuse a standard vocabulary term** (iiRDS or schema.org).
4. **Documentation-only guidance.** Tell consumers to treat some external
   convention as negative scope, and emit nothing.

## Decision Outcome

Chosen option 1. **Mint two minimal `dockg:` predicates**,
`dockg:notApplicableToVariant` and `dockg:notSoftwareSubject`. The frontmatter
fields are `kg.notApplicableTo` (variant labels → minted
`iirds:ProductVariant` nodes) and `kg.notSoftwareSubject` (enum → published
`iirdsSft:` subject IRIs). Both work at **document and section level**, through
the shared `emitIirdsTyping` helper. A contradiction is the same variant or subject
on both the positive and negative predicate of one node. That is a **SHACL
`sh:disjoint` violation** (`dockg check` exit 1), the same core-SHACL construct
already used for `skos:related` against `skos:broader`.

This followed directly from research (sourced to `iirds-consortium/models`,
schema.org, the OWL 2 Primer):

- **No standard term exists.** iiRDS has only affirmative `relates-to-*` and
  `has-*` relations. No antonym, no "excludes", no negative scope. schema.org has
  nothing usable, since `schema:negativeNotes` is the con side of a pro/con
  review rather than applicability. Option 3 is impossible.
- **`owl:NegativePropertyAssertion` is disqualified.** It is the theoretically
  correct idiom, but its only serialization is a **reified blank node**, which
  violates the no-blank-nodes invariant. Giving it a deterministic IRI instead
  abandons the standard shape, so there is no interoperability upside. It is an
  OWL *axiom* rather than a data triple, which is awkward to read back and for
  SHACL. And SHACL cannot interpret its negation semantics without custom
  SPARQL. Option 2 is out.
- Wakabayashi's `what_it_is_not` was therefore necessarily custom. There is
  nothing standard it could have mapped to.

**Trade-off, recorded:** minting a custom predicate is A-Box negation *without*
OWL formal semantics. An OWL reasoner will **not** infer a contradiction if some
triple also asserts the positive relation to the same target. But dockg does not
run an OWL reasoner. Its consistency contract is SHACL, and the `sh:disjoint`
rule enforces exactly this contradiction. The OWL semantics we forgo are
semantics this stack never uses. The plain-triple form is the one that is
deterministic, blank-node-free, and directly validatable. Predicate names read
as instance-level applicability (`notApplicableTo*`), deliberately not
`disjointWith`-style, to avoid implying OWL T-Box property disjointness.

### Consumer contract (open-world)

The README states it explicitly. **Absence of a positive edge means unknown, not
excluded.** A retrieval interlock must query the *negative* edge
(`dockg:notApplicableToVariant`) to exclude content. It must never infer
exclusion from a missing positive edge. This is what makes disciplined silence
expressible over an open-world graph.

### Consequences

- Good. Negative scope is a plain, queryable, SHACL-validated edge. It is the
  interlock the research calls for, expressible without blank nodes or OWL.
- Good. Contradictions fail `check` loudly instead of shipping an
  unresolvable graph.
- Good. Reuses the Phase 3 section plumbing and the shared helper, so doc and
  section behave identically for free.
- Bad. The `dockg:` namespace grows by two properties (6 → 8). Justified: no
  external term exists, and each negates a distinct positive relation.
- Bad. `sh:disjoint` is per-focus-node only. A doc applying to X while one of
  its sections excludes X is *not* flagged. That is correct, since the scopes
  legitimately differ. It does mean the shapes catch only same-node
  contradictions, not every conceivable human authoring mistake.

### Confirmation

`test/unit/derive.test.ts` asserts each negative field emits the right predicate
and object at doc and section level, that `notApplicableTo` mints a
`ProductVariant`, and that an absent field emits nothing. `test/unit/shacl.test.ts`
validates a conforming negative graph and confirms a variant on both
`appliesTo` and `notApplicableTo` (and a subject on both `softwareSubject` and
`notSoftwareSubject`) is a `sh:disjoint` violation. `dockg validate` rejects an
out-of-enum `notSoftwareSubject`; `test/unit/schema-sync.test.ts` pins the enum
to `src/core/iirds.ts`; `test/integration/check.test.ts` keeps the clean corpus
at exit 0 against `dockg-0.4.ttl`. The determinism gates cover the new triples.

## Pros and Cons of the Options

### Mint minimal `dockg:` predicates

- Good. Plain triples, no blank nodes, SHACL-validatable, consumer-legible,
  deterministic.
- Bad. Custom vocabulary; no OWL reasoner semantics (enforced by SHACL
  instead).

### `owl:NegativePropertyAssertion`

- Good. The formally correct RDF idiom; a reasoner would infer contradictions.
- Bad. Mandates a blank node (invariant violation); an axiom not a data triple;
  SHACL cannot validate its semantics; weak consumer/tooling support.

### Reuse a standard term

- Good. Zero namespace growth, maximal interoperability.
- Bad. No such term exists in iiRDS or schema.org, so it is not an option.

### Documentation-only guidance

- Good. Emits nothing new.
- Bad. Leaves the interlock inexpressible in the graph, defeating the phase's
  purpose.
