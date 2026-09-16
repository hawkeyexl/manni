---
status: accepted
date: 2026-07-21
decision-makers: [hawkeyexl, Claude]
---

# Qualified provenance with deterministic IRIs and role individuals

## Context and Problem Statement

Direct PROV properties (`prov:wasAttributedTo`, `prov:wasAssociatedWith`)
cannot say *in what role* an agent participated. PROV-O's qualification
pattern can, but its canonical form uses blank nodes, which dockg's
determinism contract forbids.

## Decision Drivers

- No blank nodes, ever; byte-identical serialization.
- Qualified detail should be optional, since most graphs don't need the extra triples.
- The custom `dockg:` namespace must stay small.

## Considered Options

1. Skip qualification entirely.
2. Qualification nodes as blank nodes (canonical PROV examples).
3. Deterministic qualification IRIs + fixed role individuals, opt-in (chosen).

## Decision Outcome

Chosen option 3, behind `provenance.qualified` (default false). Node IRIs are
derived from what they qualify: `{docIri}#attribution-{agentSlug}` for
attributions, `{activityIri}-association` for associations. Roles are three
fixed vocabulary individuals, `dockg:authorRole`, `dockg:generatorRole`, and
`dockg:toolRole` (src/core/vocab.ts ROLE). They are the only namespace additions.
Direct properties are always emitted; qualification is additive, per the PROV
spec's allowance for both forms coexisting.

### Consequences

- Good. Role information without blank nodes, and zero cost when off. Qualified
  and direct forms stay consistent because they are emitted from the same
  call sites (`qualifyAttribution`/`qualifyAssociation`).
- Bad. Roughly four extra triples per qualified relation. One qualification
  node per (doc, agent) pair relies on agent-slug uniqueness, the same collision
  behavior as agent IRIs themselves.

### Confirmation

Derive unit tests assert all four node shapes, deterministic IRIs, role
objects, and that `qualified: false` emits zero qualified triples (golden
safety for default builds).

## Pros and Cons of the Options

- **Skip.** Smallest graph, but roles were an explicit requirement.
- **Blank nodes.** Canonical, but it breaks determinism and the no-bnode emitter.
- **Deterministic IRIs** (chosen). Stable diffs, with slightly unusual IRIs for
  qualification nodes, documented in the README.
