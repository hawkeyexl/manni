---
status: "accepted"
date: 2026-09-01
decision-makers: [hawkeyexl]
---

# Publish `frontmatter-1.1.0.json` for the proposal.2 vocabulary

## Context and Problem Statement

Four new eval fields are page vocabulary, and the page vocabulary is docmeta's (ADR 01009). They
are `weight` (ADR 01030), `target` (ADR 01033), and `runs`/`model`. They landed upstream as
`docmeta:evals:1.0.0-proposal.2`. This repo ships a schema implementing that vocabulary, and
`schemas/frontmatter-1.0.0.json` is a published artifact whose bytes are frozen.

## Decision Drivers

- 1.0.0's bytes are frozen. A consumer may have pinned it by path *or* by its `$id` URL.
- Pages using the new fields must validate, and `resolvePage` validates every page against the
  shipped schema.
- Three-segment semver, and the additions are backward-compatible: every 1.0.0 page is a valid
  1.1.0 page.

## Considered Options

- Add the fields to 1.0.0 in place.
- Publish 1.1.0 and switch the tool to it, keeping 1.0.0 shipped.
- Wait for docmeta to register the vocabulary before shipping anything.

## Decision Outcome

The chosen option is to **publish 1.1.0, and keep 1.0.0 shipped and byte-identical**. `src/schema.ts`,
`resolvePage` and the package `exports` all move to 1.1.0; 1.0.0 stays in `files`/`exports` and in
`docs/public/schemas/` for anyone who pinned it.

### Consequences

- Good, because the freeze rule holds: 1.0.0's bytes are untouched, and a validator pointed at its
  `$id` keeps resolving the same document.
- Good, because the additions are optional, so a page written against 1.0.0 needs no change.
- Good, because `resolvePage` validating against 1.1.0 is what makes the new fields usable at all.
  Validating against 1.0.0 would have rejected every page that used one.
- Bad, because two schema versions now ship, and `schemas:check` and `published-schemas.yml` cover
  both. That is the cost of the freeze rule, and it is the cost the rule exists to pay.
- Neutral, because the tool implements exactly one version at a time. There is no negotiation
  between them; 1.0.0 remains served for consumers, not read by the tool.

### Confirmation

`npm run schemas:check` asserts `schemas/` and `docs/public/schemas/` agree for both versions.
`published-schemas.yml` fetches each `$id` on a schedule, because every local check passes against
a 404ing site. That is what 0.1 shipped with for its whole life. `test/unit/schema.test.ts` pins
the shipped path, the resolvable `$id`, and the three-segment version.
