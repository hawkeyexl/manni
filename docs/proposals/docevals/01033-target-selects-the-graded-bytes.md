---
status: "accepted"
date: 2026-09-01
decision-makers: [hawkeyexl]
---

# `target` selects the graded bytes, and it is called `target`, not `focus`

## Context and Problem Statement

Every grader received the page body and nothing else. An assertion about frontmatter had to be
phrased as prose for the judge; an assertion about a companion file could not be written at all.
The only related field, `evidence`, is a *hint* to the judge about where to look. It cannot change
what the grader is handed.

`claude plugin eval` has the missing concept, but spells it twice: `target` on its `regex` grader
and `focus` on its `llm` grader, for the same union of values.

## Decision Drivers

- The selector is cross-grader by nature. If each grader invents its own spelling in `options`,
  two graders looking at "the frontmatter" have no common way to say so.
- One name, not two, because the inconsistency in the source design is worth not copying.
- Whatever it is called must sit legibly beside `evidence`, which already occupies the "hint"
  slot.

## Considered Options

- `focus`, matching the LLM grader.
- `target`, matching the deterministic grader.
- Per-grader options (`readFrontmatter: true`, and so on).

## Decision Outcome

Chosen option: **`target`**, with a shared shape and family-specific members:
`body` (default) · `raw` · `frontmatter` · `{source: file, path}`.

Three reasons for the name:

1. It names a **data selector**, not an emphasis. It decides which bytes reach the grader; "focus"
   reads as a hint about attention, which is what `evidence` already is.
2. **`evidence` occupies the hint slot.** `focus` collides with it semantically; `target` does not,
   so the pair stays legible. `target` is what is graded, `evidence` is where to look within it.
3. It has to serve **deterministic** graders. A regex grader has no focus; it has a target. That
   `claude plugin eval` itself reaches for `target` on its deterministic grader and `focus` only on
   its LLM one is evidence that `target` is the neutral word.

A grader that cannot serve a requested target says so as an options error rather than quietly
grading something else.

**Today that means every deterministic grader.** `target` is consumed by the judge; no `tool:*`
or `command` grader reads it yet. Rather than let the promise above be aspirational, each grader
declares the targets it can read (`Grader.targets`, absent meaning body-only). The engine turns
any other request into an **error**, naming the grader and the target, before dispatch. It is an
error and not a skip. A skip keeps the run green, and an eval that silently measured the whole page
would then read as coverage it never provided. When a deterministic grader learns to read a
target, it says so in one field and the guard stops applying to it.

### Consequences

- Good, because `tool:regex` (ADR 01029) and the judge share one vocabulary for the same idea.
- Good, because a target that cannot be read is an explicit failure. Falling back to the page body
  would report a verdict about the wrong bytes, which is worse than no verdict (ADR 01022).
- Good, because a companion-file target refuses absolute paths and paths that climb out of the
  page's directory. Content naming an arbitrary path on the machine is the ADR 01025 hazard.
- Good, because MDX noise is stripped only from `body`. Running `cleanBody` over a companion source
  file deletes its `import`/`export` lines. The judge would then be asked whether code exports
  something it can no longer see, which is a real bug the tests caught.
- Bad, because it is new vocabulary in `docmeta:evals`, so it needed the upstream change and a new
  published schema (ADR 01035).

### Confirmation

`test/unit/target-runs.test.ts` asserts on what actually reached the provider for each member. It
pins that `raw` includes the frontmatter and that `frontmatter` excludes the prose. It pins that a
companion file's contents arrive intact, and that a missing file errors rather than silently
grading the body. Two targets on one page must not share a cached verdict.
