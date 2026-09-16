---
status: accepted
date: 2026-07-24
decision-makers: [hawkeyexl, Claude]
---

# Declared frontmatter criteria plus an implicit whole-artifact eval; drop heading scraping

## Context and Problem Statement

The previous moose-tracevals auto-extracted criteria by regex-matching markdown headings ("Entry Criteria", "Constraints", …) in skill and agent files. Its `--detect-criteria` flag wrote merged criteria back into user artifacts mid-evaluation. How should the rework obtain evaluation criteria from artifacts?

## Decision Drivers

- Heading scraping is brittle. It depends on authors using specific heading names, and silently misses everything else.
- An evaluator that mutates the files it evaluates violates least surprise and makes runs non-reproducible.
- Artifacts should be evaluable with zero configuration, but authors need a precise opt-in path.
- docmeta already provides frontmatter extraction with line maps and multi-dialect schema validation.

## Considered Options

- Declared `metadata.evals` frontmatter (docmeta-validated) + one implicit whole-artifact adherence eval as fallback
- Keep heading scraping as the fallback
- Declared criteria only (artifacts without them are skipped)

## Decision Outcome

Chosen option: "Declared frontmatter criteria + implicit whole-artifact eval". Criteria live in a `metadata.evals` block read via docmeta `extractFrontmatter` and validated against the published `schemas/artifact-evals-0.1.json` (string shorthand = LLM assertion; object form selects a deterministic grader with options). Invalid blocks are reported as errors with line numbers, never silently ignored. An artifact with no declared criteria gets exactly one implicit LLM eval. It is worded "the session adhered to the instructions in this artifact", with the full artifact body as context. The verdict's `observed` field must cite the specific instructions followed or violated. Heading scraping and criteria write-back are removed.

### Consequences

- Good, because every used artifact is evaluated with zero configuration, and declared criteria give precision where authors invest.
- Good, because evaluation is read-only end to end.
- Bad, because implicit whole-artifact judging is coarser than per-heading criteria for long artifacts and costs more tokens per verdict.

### Confirmation

Schema behavior is pinned in `test/unit/schema.test.ts`. Planning tests assert an artifact with no `metadata.evals` yields exactly one implicit eval. They also assert an invalid block yields an `error`-outcome eval with a line number. The CI dogfood gate exercises both paths against the fixture corpus.

## Pros and Cons of the Options

### Declared criteria + implicit eval

- Good, because deterministic where declared, complete where not.
- Bad, because coarse fallback granularity.

### Keep heading scraping as fallback

- Good, because finer-grained free criteria for conforming artifacts.
- Bad, because heading conventions are not a contract; failures are silent and format-dependent.

### Declared criteria only

- Good, because fully deterministic.
- Bad, because the common case (artifacts without declarations) would be silently unevaluated, gutting the tool's purpose.
