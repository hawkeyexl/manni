---
status: "accepted"
date: 2026-09-13
decision-makers: [hawkeyexl]
---

# Validate pages against the evals draft itself, and attribute machine work in `provenance` and `meta-provenance`

Supersedes [ADR 01035](01035-publish-frontmatter-1-1-0-for-the-proposal-2-vocabulary.md) and
[ADR 01011](01011-fill-writes-a-durable-provenance-trail.md).

## Context and Problem Statement

manni docevals shipped its own copies of the page vocabulary,
`schemas/docevals/frontmatter-1.0.0.json` and `1.1.0.json`, and validated pages against 1.1.0
with its severity enum patched in memory. Proposal 0046 then changed the vocabulary. Evals
`1.0.0-proposal.3` drops `eval-provenance`, so its root guard is `^eval-(?!suite$|skip$)`, and it
spells the lowest severity `notice`. ai-context `1.0.0-proposal.2` drops the page-level
`generated-by`. The machines that wrote the body are in `provenance`, and machine-proposed fields
and evals are in `meta-provenance`. The copies were frozen at the old vocabulary, so they could
not follow. The self-preference check read the two keys that no longer exist, and `fill` wrote
one of them.

## Decision Drivers

- A copy of a draft is a second artifact that drifts. This one had already drifted twice, in its
  severity scale and in `eval-provenance`.
- The built CLI must not read `docs/` at runtime.
- Shared concepts use shared values. `meta-provenance` is one record for the family, and
  `manni meta fill` already writes it.
- None of this was released. The copies exist only on the docevals branch, so removing them breaks
  no consumer.

## Considered Options

- Publish `frontmatter-1.2.0.json` tracking proposal.3, and keep the copies.
- Import the draft from `docs/proposals/0023/` and ship no copy.

## Decision Outcome

Chosen option: "Import the draft and ship no copy". The resolver compiles
`docs/proposals/0023/schemas/evals/1.0.0-proposal.3.json`, which tsup bundles into `dist`. The
copies, their served copies under `docs/public/docevals/schemas/`, the package `exports` for them
and `frontmatterSchemaPath` are gone. `docevals.frontmatterSchema` is the draft object.

Attribution follows proposal 0046:

- The self-preference check compares the judge's model with `provenance` for `target: body`, the
  `fields` of `meta-provenance` for `frontmatter`, both for `raw`, and nothing for a companion
  file. That is the content axis. The criterion axis is a `meta-provenance` entry for the judge
  that lists the eval's id under `evals`.
- `fill` writes `meta-provenance` with the merge `manni meta fill` uses, under `evals` rather
  than `fields`.

### Consequences

- Good, because pages are validated against the draft under review, byte for byte. A change to
  the draft reaches docevals in the same commit.
- Good, because one record serves both fill commands and the check that reads it.
- Bad, because a consumer who wants `manni meta validate` to check eval declarations has to copy
  the draft into their repository, as the citations vocabulary's consumers do. No URL serves it
  until the vocabulary is published.
- Bad, because the page vocabulary now moves with the draft, and a draft can still change. That is
  the cost of implementing a proposal while it is under review.

### Confirmation

`test/docevals/unit/schema.test.ts` asserts that the schema is the draft and that no copy ships.
`test/docevals/unit/self-preference.test.ts` covers every axis and target.
`test/docevals/unit/fill.test.ts` covers the written and merged entry.
`test/docevals/integration/provenance.test.ts` runs the built CLI for the reserved-prefix error
and the `fill` JSON shape.

## Pros and Cons of the Options

### Publish `frontmatter-1.2.0.json` and keep the copies

- Good, because consumers could keep pointing `$schema` at a URL.
- Bad, because it is a third frozen copy of a draft that is still changing.
- Bad, because the served URL promised stability for a vocabulary that has none yet.

### Import the draft and ship no copy

- Good, because nothing needs keeping in step.
- Bad, because there is no URL to point a validator at.
