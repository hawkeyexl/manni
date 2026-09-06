---
status: "accepted"
date: 2026-09-01
decision-makers: [hawkeyexl]
---

# `tool:regex` and `tool:file-exists`: the deterministic rungs below the judge

## Context and Problem Statement

The grader set jumped from wrapped external tools straight to the AI judge. An assertion as small
as "the page names the current package" had nowhere to go but `ai`. That meant three ensemble
calls and a confidence zone to check a string. "Prefer a deterministic grader where one can express
the assertion" is only advice you can follow if a deterministic grader exists.

## Decision Drivers

- The authoring guidance (ADR 01034's sibling change) tells authors to reach for the cheapest
  grader that can express the assertion. That advice was unfollowable for the simplest cases.
- `claude plugin eval` carries `regex` and `file_exists` for the same reason, with `count:N` for
  "exactly N times".
- Documentation routinely promises files that live beside it, such as a sample project, a spec or
  an image. Nothing could assert those still ship.

## Considered Options

- Keep pushing simple assertions through the judge.
- Add `regex` and `file-exists` as bare grader kinds.
- Add them as native graders under the existing `tool:` namespace.

## Decision Outcome

The chosen option is **native graders in the `tool:` namespace**, namely `tool:regex` and `tool:file-exists`,
alongside `tool:freshness`, `tool:reading-level` and `tool:differentiation`.

The namespace choice is about meaning, not about schema mechanics: the bare kinds `ai`, `command`
and `human` say *how* an assertion is checked, while `tool:*` names *what* checks it. These are
checkers, so they belong there. A useful side effect is that the published frontmatter schema's
`tool:[a-z0-9][a-z0-9-]*` pattern already admits them.

`tool:regex` takes `pattern`, `flags`, and `match: contains | not-contains | count:N`, over
whatever `target` selects (ADR 01034). `tool:file-exists` takes `path` (a glob, relative to the
page's directory) and `exists`.

### Consequences

- Good, because the cheapest expressible check is now available, and the authoring rules can
  legitimately point at it.
- Good, because `count:N` catches the duplicated-heading class of failure that neither a `contains`
  check nor a judge reliably notices.
- Good, because both refuse a path that climbs out of the page's directory. A page is content.
  Content naming an arbitrary path on the machine running the eval is the same hazard class as a
  frontmatter command (ADR 01025).
- Good, because an uncompilable pattern is a *configuration* error, not a page failure. Blaming
  the page for the eval's own bug is how a corpus learns to ignore its findings.
- Bad, because two more graders is two more option surfaces to validate; both ship
  `validateOptions` from birth (ADR 01031).

### Confirmation

`test/unit/regex-file-exists.test.ts` covers every distinct shape. That means each `match` mode, each
`target` member, both `exists` values, the escape guard, and the uncompilable pattern. Both graders
also run over the real fixture corpus through the built CLI, and `.github/workflows/ci.yml` asserts
their outcomes and the weight one of them carries.
