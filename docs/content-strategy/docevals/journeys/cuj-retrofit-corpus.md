---
id: cuj-retrofit-corpus
type: cuj
title: Get a legacy corpus onto a ratchet without a wall of red
personas: [persona-retrofitter, persona-corpus-owner]
trigger: "Thousands of pages that have never been measured, and a mandate to get quality under control"
entry_point: docs/src/content/docs/docevals/adopt/retrofit-a-legacy-corpus.mdx
success_criteria: >
  Every eval is on at error severity from day one, today's findings are recorded in a committed
  baseline, CI fails only on new findings, the recorded count is falling, and no assertion was
  weakened to get there.
steps:
  - { stage: "Decide what should not be evaluated at all, before anything is recorded", doc: docs/src/content/docs/docevals/adopt/retrofit-a-legacy-corpus.mdx, exists: true }
  - { stage: "Set `baseline:` in the config so a recorded file will actually be read", doc: docs/src/content/docs/docevals/reference/configuration.mdx, exists: true }
  - { stage: "Record today's findings with `run --write-baseline` and commit the file", doc: docs/src/content/docs/docevals/adopt/retrofit-a-legacy-corpus.mdx, exists: true }
  - { stage: "Gate CI on new findings only, and watch the `removed` count on any re-record", doc: docs/src/content/docs/docevals/ci/exit-codes-and-annotations.mdx, exists: true }
  - { stage: "Understand what the baseline does not cover before relying on it", doc: docs/src/content/docs/docevals/reference/files-and-state.mdx, exists: true }
  - { stage: "Propose evals one directory at a time", doc: docs/src/content/docs/docevals/adopt/index.mdx, exists: true }
  - { stage: "Use a capability suite with a target below 1.0 for the judged evals", doc: docs/src/content/docs/docevals/evals/regression-vs-capability.mdx, exists: true }
  - { stage: "Burn down one section, then re-record so the baseline shrinks", doc: docs/src/content/docs/docevals/fix/index.mdx, exists: true }
  - { stage: "Reserve severity inversion for a finding class you will never gate on", doc: docs/src/content/docs/docevals/evals/severity-and-findings.mdx, exists: true }
  - { stage: "Make the surviving evals cheap to keep running", doc: docs/src/content/docs/docevals/adopt/promote-to-deterministic.mdx, exists: true }
---

# CUJ: Get a legacy corpus onto a ratchet

**Scope:** the transition from an unmeasured corpus to a continuously evaluated one. The proposing
mechanics are [`cuj-bootstrap-corpus`](cuj-bootstrap-corpus.md); this journey is about **sequencing**
so that every increment is mergeable. Steady-state operation afterwards is
[`cuj-first-gate`](cuj-first-gate.md) and [`cuj-ci-wire`](cuj-ci-wire.md).

**Trigger.** Someone has been made responsible for the quality of a corpus they did not write, cannot
fully vouch for, and may not delete.

**Narrative.** This journey exists because the obvious approach fails, reliably and expensively. Point
an honest quality bar at 3,000 pages that have never been measured and nearly all of them fail at
once. The result is accurate and useless. It is unmergeable and untriageable, and it teaches the team that
the tool is wrong rather than that the docs are.

The instinct that follows is to soften the assertions until the build goes green. That is the failure
mode this journey exists to prevent, because it is irreversible in practice. An assertion weakened to
accommodate the current state of the corpus permanently encodes that state as the standard, and no
one ever tightens it back.

**The mechanism is the findings baseline.** Turn the eval on at `error` today, and record what the
corpus already fails with `run --write-baseline`. Commit the file, and gate on findings that are not
in it. Pre-existing findings are subtracted before the run decides anything, so the standard tightens
immediately. The backlog becomes a number that falls rather than a build nobody can merge. This is
the ratchet the journey has always been named for. Until [ADR
01017](../../../adrs/01017-a-committed-baseline-ratchets-a-legacy-corpus.md) it did not exist, and
this journey described a manual severity migration standing in for it.

**The limitation belongs in the journey, not only in the reference.** A finding's identity is
`(file, eval name, rule id)`. The line number and message prose are excluded, so a reordering or
an upstream reword does not invalidate the file. The cost is that identity is **per rule per file,
not per occurrence**. A file baselined for three `MD013` findings will not fail when a fourth
appears. Prose has no stable per-occurrence anchor, so this is a trade-off rather than a defect.
Iris needs it stated before she relies on the gate. Scope is likewise narrower than it first reads.
A baseline holds **findings**, which means deterministic graders. An ai-graded verdict has no rule
identity to fingerprint and belongs to [`cuj-resolve-review`](cuj-resolve-review.md) instead.

**The forgiving direction is the dangerous one.** A baseline's failure mode is over-forgiveness, and
it is silent by construction, because its entire job is to make a red run green. Every re-record
therefore reports `(+added, -removed)`, and the journey has to teach `removed` as the number to read.
An accidental `--write-baseline` over a narrowed glob forgives everything it did not see, and nothing
else in a CI log says so. Renaming an eval has the same shape. The name is part of the identity, so
a rename reports that eval's whole backlog as fresh until someone re-records.

**Severity inversion survives, demoted.** `severity: warning` reports without failing, and it remains
the right answer for a finding class the team will never gate on. Reading level on generated
reference and line length in machine-written tables are the examples. It is the wrong answer for
findings they intend to fix, because a warning is permanent in practice and a baseline entry is not.
`files.exclude` and page-level `eval-skip` still remove content that should never have been in scope.
A capability suite with a target pass rate below 1.0 still carries the judged evals. None of these touch what the
assertion says.

Two supporting points earn their space. The first is that **triage is a legitimate first step, not
surrender**. Deprecated sections, generated reference, and archives should be excluded rather than
baselined. A baseline entry is a promise to come back, and nobody comes back for an archive. It also
has to happen *before* the first recording, because narrowing scope afterwards is exactly the shape
that produces an alarming `removed` count. The second is that **batching by directory keeps the
review reviewable**. A `fill` pass across the whole corpus produces a pull request no human can
approve. That stalls the initiative on its first review rather than its first run.

[Iris](../personas/iris-retrofitter.md) owns this journey; [Priya](../personas/priya-corpus-owner.md)
walks it whenever her corpus predates her adoption, which is most of the time.

**Status.** All 10 steps are served by written pages (9 distinct). Re-check this when the journey changes. A step whose `doc` no longer resolves signals that this journey has drifted ahead of the docs. So does a new step with no page behind it.
