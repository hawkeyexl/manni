---
id: persona-contributor
type: persona
name: "Theo, Doc Contributor"
audience: aud-doc-contributor
role: Engineer or writer who opened a pull request and hit a red manni docevals check
shared_with: manni meta
proficiency: [git, pull-requests, editing-markdown, reading-a-ci-log]
prerequisites: []
goals:
  - Work out which check failed and why
  - Make the smallest correct change
  - Confirm it locally before pushing again
  - Get back to the work he was actually doing
pains:
  - Cannot tell which kind of failure he is looking at
  - A judge rationale names the problem without pointing at the sentence
  - Some failures are not his to fix and nothing tells him that
  - Reproducing locally is not obvious; CI had a key and a warm cache, his laptop has neither
content_types: [single-page-troubleshooting-map, faq]
journeys: [cuj-fix-red-check]
---

# Persona: Theo

**Scope:** the passing-through persona for
[`aud-doc-contributor`](../audiences/doc-contributor.md). Theo did not install manni docevals, did not write
the eval, and will not read the rest of the site. Every other persona configures the tool; Theo only
ever encounters it.

**Deliberately the same Theo as manni meta's.** The contributor who hits a red frontmatter check is the
contributor who hits a red eval, and it is the same bad afternoon either way.

Theo is shipping a feature and updated a page alongside it. He may be a frequent contributor to this
repo and a first-time reader of this site. His entire context on manni docevals is whatever fit in the CI
annotation. He is not hostile to the check. He is busy, and his tolerance for learning a tool to
unblock a two-line edit is close to zero.

His first problem is **triage**, and nothing else works until it is solved. manni docevals produces at least
five failures that look similar in a CI log and have completely different remedies. There is a
deterministic tool finding pinned to a line, and an AI verdict with a rationale and no line. There is
an eval parked in the human-review zone that he has no standing to resolve. There is a stale
`assertion-hash` meaning a generated script no longer matches its assertion. And there is an
operational error that is not his fault at all. His page has to sort these in its first screen.

His second problem is that **a rationale is not a remediation**. "The page promises unreleased
functionality" tells him what is wrong and not which sentence to change. Closing that gap is most of the value of his page. He closes it by
reading the assertion and its `examples.fail` alongside the rationale.

His third is that **not every failure is his**. Being told to escalate, and to whom, is a correct and
respectable outcome. A page that implies every red check is the contributor's fault to fix produces
either a bad edit or a resentful escalation.

Theo imposes the site's one hard structural constraint: `fix/index.mdx` has **no subject
dependencies**. It must be reachable cold, from a link in a CI annotation, and be fully useful to
someone who has read nothing else. Every term it uses is defined inline or linked. Any change that
gives that page a prerequisite is a defect, not a style preference.

Success for Theo is four minutes. Annotation → page → the sentence → the fix → `manni docevals run
--deterministic-only` on one file → green. He never learns what a capability suite is, and that is
the correct outcome.
