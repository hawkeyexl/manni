---
status: "accepted"
date: 2026-08-31
decision-makers: [hawkeyexl]
---

# `type` defaults to `regression`, not `capability`

**Backfill.** This records a decision made before the ADR rule existed; until now it lived only as a bullet in [CLAUDE.md](../CLAUDE.md#design-decisions). The date is when the record was written, not when the decision was taken.

## Context and Problem Statement

An eval carries a `type` of either `regression` or `capability`. A regression was true and must stay true. A capability is not true yet, and we intend it to become true. The distinction matters to the reader of a result. A failing regression is a defect, while a failing capability is a known gap.

Most evals do not set the field. Whichever value the default takes therefore describes the great majority of evals in any real corpus. It is the value a user gets without deciding anything.

## Decision Drivers

- **A default is a claim about the common case**, and getting it backwards mislabels most of a corpus.
- The two types are read differently under failure: one is a regression to fix, the other is a backlog item.
- A wrong default is invisible, because nobody writes the field they did not know they needed.
- The vocabulary is docmeta's (`docmeta:evals:1.0.0-proposal.1`), so the default must be defensible beyond this tool.

## Considered Options

- **Default to `regression`.**
- **Default to `capability`.**
- **No default**, requiring `type` on every eval.

## Decision Outcome

The chosen option is to **default to `regression`**. It is applied in `fromDef` in [src/core/resolve.ts](../src/core/resolve.ts), which `resolvePage`/`resolvePages` use to build every resolved eval.

The reasoning is about what people actually write. An eval is nearly always added because someone noticed something that must not break. That is a command that has to keep working, a page that has to stay fresh, or frontmatter that has to keep validating. That is a regression guard. Capability evals assert a quality the corpus has not yet reached, and they are the deliberate, rarer case. They are written during a push to raise a standard. The person writing one is already thinking about the distinction and will happily type the field.

Defaulting the other way would silently relabel a corpus of regression guards as aspirations, which is precisely the framing that makes a red check ignorable.

### Consequences

- Good, because the default matches the common case, so most evals need no `type` at all and are still labelled correctly.
- Good, because the failure mode of the default is conservative. An unlabelled failing eval reads as "this broke," which is the reading that gets it fixed.
- Bad, because a team doing a deliberate capability push must set `type: capability` on every eval in it. Forgetting is silent, and the eval simply reads as a regression.
- Neutral, because the retrofit case is handled by the baseline ratchet (ADR 01017) rather than by relabelling everything as a capability. That is the case where an entire legacy corpus is failing on day one. Those are different problems, and conflating them was the temptation this default resists.

### Confirmation

`test/unit/resolve.test.ts` pins that an eval with no `type` resolves to `regression`, at both the page and config level. The published schema `schemas/frontmatter-1.0.0.json` documents the field and its permitted values.

## Pros and Cons of the Options

### Default to `regression`

- Good, because it matches why evals actually get written.
- Good, because the conservative reading of an unlabelled failure is the useful one.
- Bad, because deliberate capability work must be labelled explicitly, and omissions are silent.

### Default to `capability`

- Good, because it is gentle on a corpus adopting the tool. Day-one failures read as aspirations rather than defects.
- Bad, because it mislabels the overwhelming majority of evals.
- Bad, because it makes every red check dismissible by default, which is how a gate stops being a gate. The adoption problem it solves is better solved by a baseline.

### No default

- Good, because it forces the author to think about the distinction once per eval.
- Bad, because it adds required ceremony to the shortest useful eval, a bare assertion string. The shorthand form has no place to put it.
- Bad, because a required field that is nearly always the same value is a field people set by rote. That produces the appearance of a decision without one.
