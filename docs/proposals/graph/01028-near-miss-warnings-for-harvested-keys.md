---
status: "accepted"
date: 2026-08-29
decision-makers: [hawkeyexl]
---

# Near-miss warnings for the harvest rule's page-level keys

## Context and Problem Statement

[ADR 01024](01024-the-harvest-rule.md) made five page-level keys load-bearing graph inputs:
`type`, `concepts`, `applies-to`, `not-applicable-to`, and `supersedes`. A page can now declare
what it applies to without opening a `kg` block at all, which is the feature.

Nothing validates them. `dockg validate` checks the `kg` block against the vendored `docmeta:kg`
schema, and that block is `additionalProperties: false`, so a typo inside it is a hard error naming
the offending key. The identical typo one level up is silent. This page passes `validate` clean and
derives **zero** triples:

```yaml
---
title: Typo probe
type: how to
applies_to: [SP-X100]
concept: [alpha]
supersede: ./other.md
---
```

Four facts the author believed they had declared, absent from the graph, with nothing anywhere
saying so. That is information evaporation, the failure
[DESIGN.md](../DESIGN.md) names as the reason coverage reporting exists. It was produced by the
tool built to measure it, and introduced by the feature that made the page level load-bearing.

## Decision Drivers

- **Silence must stay silent** ([ADR 01008](01008-graph-as-index-not-corpus.md)). A page with no
  `type` and no `kg` block must derive nothing. dockg must not start guessing.
- **dockg does not implement the vocabularies these keys belong to** (ADR 01024). Validating them
  must not become adopting them; harvesting `prerequisites` was already ruled out on exactly this
  ground.
- **A page may carry any other key it likes.** A site generator's, a linter's, an author's. Astro
  alone contributes `sidebar`, `draft`, `template`.
- A check that fires on ordinary keys is worse than no check: it trains readers to ignore it.

## Considered Options

1. **A near-miss warning at derive time**, flagging a page key close to a harvested key.
2. **A dockg-side JSON Schema for the page level**, `additionalProperties: false`.
3. **A docmeta-side schema** that `validate` points at, covering the harvested subset.
4. **Do nothing**, and document the hazard.

## Decision Outcome

**Option 1 was chosen:** near-miss warnings on the existing warnings channel
([ADR 01010](01010-provenance-defaults-and-degradation.md)), emitted by `dockg build`.

A schema is the wrong instrument here, and that is the crux. What is wrong with `applies_to` is not
that dockg does not recognize it. dockg does not recognize `sidebar` either, and must not complain
about that. It is that `applies_to` is one character from a key dockg *does* read, on a page that
declares nothing else of the kind. Only a similarity check can tell those apart; a schema strict
enough to catch the first would reject every page.

Detection is deliberately narrow:

- **Separator and case differences always match.** `applies_to`, `appliesTo`, `Supersedes` all
  normalize onto their target.
- **Otherwise, edit distance 1 for short keys and 2 for long ones.** `not-applicable-to` can absorb
  two typos and stay unmistakable; `type` and `types` differ by one and mean different things.
- **A page that declares both spellings is left alone.** The author has already made the choice.
- **Page `type` values get the same treatment**: `how to` warns because it is one edit from
  `how-to`, while `blog-post` stays silent because it maps to nothing *and is meant to*. Warning on
  every unmapped type would fire on every blog post in a corpus.

Options 2 and 3 were rejected together. Both put dockg in the position of ruling on keys owned by
vocabularies it does not implement. Option 4 leaves the tool's own worst failure mode in place.

### Consequences

- **`dockg build` can now emit warnings it never did.** A corpus with near-miss keys will start
  printing them. Exit codes are unchanged. A warning never gates, and a near miss is a suspicion,
  not a finding.
- **The facts are still not derived.** That is correct and deliberate. dockg reports what it did not
  understand rather than guessing what was meant. The warning tells an author where to look.
- **False negatives remain.** A key that is not close to a harvested one, say `product` for
  `applies-to`, is invisible. It is indistinguishable from an ordinary page key. The
  check catches typos, not vocabulary mismatches.
- Detection lives in `src/core/harvest.ts` as a pure function over `DocModel[]`. `deriveGraph`'s
  signature is untouched, and the check can be reused by anything that has parsed the corpus.

### Confirmation

- `test/unit/harvest.test.ts` holds a named ladder in both directions. Eight misspellings that
  must warn, covering snake_case, camelCase, singular, transposed and uppercase on each of the five
  keys. Then the silence cases that matter more: correct spellings, ten ordinary page keys, a page
  declaring both spellings, and unmapped-but-intentional page types.
- `test/integration/build.test.ts` runs the reproducer above end to end. Four warnings on stderr,
  exit 0, and a graph that still contains no `iirds:relates-to-product-variant` or
  `iirds:has-topic-type`.
- Measured against both real corpora before landing: **zero** warnings on the 5-document regression
  corpus and **zero** on dockg's own 36-page documentation site.

## Pros and Cons of the Options

### 1. Near-miss warning at derive time

- Good, because it catches the actual failure, a typo, without ruling on keys dockg does not own.
- Good, because it degrades: no exit-code change, no new gate, nothing to configure.
- Bad, because it is heuristic. A distance threshold is a judgement call, and an unusual key could
  in principle trip it.

### 2. A dockg-side page-level schema

- Good, because it would be exhaustive over the keys it covers.
- Bad, because `additionalProperties: false` at the page level rejects every legitimate key a site
  generator adds, and anything looser cannot detect the typo at all.

### 3. A docmeta-side schema

- Good, because the vocabularies' owner is the right place to define them.
- Bad, because it makes dockg's correctness wait on another repo's release. dockg would still
  have to decide what to do with keys from vocabularies it does not implement.

### 4. Do nothing

- Good, because it is honest about the limits of what dockg can know.
- Bad, because the failure is invisible at the moment it matters, and the tool exists to make
  exactly this kind of absence measurable.
