---
status: "accepted"
date: 2026-09-01
decision-makers: [hawkeyexl]
---

# Criteria group evals in config, not in the page vocabulary

## Context and Problem Statement

`claude plugin eval`'s unit of scoring is a *case*: one stimulus, several named graders, one
aggregate. Ours is an *eval*: one assertion, one grader. There was no way to say "these three
checks together are one criterion". There was also no way to stop three checks written as a group
from outvoting three standalone evals purely by being three.

## Decision Drivers

- The page vocabulary is docmeta's (ADR 01009). A scoring model is *ours*, and inventing page keys
  for it would repeat the mistake ADR 01009 corrected. That mistake was confusing owning the schema
  file with owning the names.
- `moose.config.yaml` already holds the eval library and the suites; grouping belongs where the
  grouping it extends already lives.
- Double-counting is the failure mode to avoid. If members vote *and* the group votes, a criterion
  is a way to inflate a suite rather than to describe it.

## Considered Options

- New page-frontmatter keys for grouping.
- A `criteria` library in config, referenced by suites.
- No grouping; tell authors to write one broader assertion instead.

## Decision Outcome

The chosen option is **a `criteria` library in config**.

```yaml
docevals:
  criteria:
    install-path-is-complete:
      evals: [has-prereqs, has-verify-step]
      combine: all          # all (default) | any
      weight: 2
  suites:
    default:
      evals: [fresh-enough]
      criteria: [install-path-is-complete]
```

A criterion contributes **one** weighted outcome to its suite, evaluated per page that declares its
members. Its member evals contribute nothing individually. Members keep their own results, so a
report still names which one failed.

### Consequences

- Good, because a group is scored once, so writing three checks as a criterion cannot outvote three
  standalone evals.
- Good, because it stays entirely inside our own config schema. No page key, no docmeta change,
  nothing to negotiate upstream before it ships.
- Good, because a criterion whose members were not all graded is **suspended**, not failed. That is
  ADR 01018's rule one level down. A group measured in part has numbers but no verdict. Calling
  a half-measured group "failed" is exactly the false confidence that gets a gate removed rather
  than fixed.
- Bad, because a suite's counts and its criteria counts now describe different things, so
  `SuiteSummary` grew a `criteria` block rather than folding them together.
- Bad, because the grouping is invisible from the page. A reader of `install.md` cannot see that
  two of its evals are scored jointly. That is the cost of not inventing page vocabulary, and it is
  the right trade until docmeta has an opinion.

### Confirmation

`test/unit/criteria.test.ts` pins that members are scored once rather than three times, and that
`combine: any` differs from `all`. It pins that a criterion carries its own weight, and that members
keep their individual results. A filtered run must suspend rather than fail a criterion. The fixture
corpus carries one, and `.github/workflows/ci.yml` asserts its failed and suspended counts.
