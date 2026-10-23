---
type: persona
id: theo
title: Theo, Doc Contributor
description: Theo is a developer or technical writer who opened a PR.
audience: contributors
---

Theo is a developer or technical writer who opened a PR. The manni meta check is red. He has low context on the tool and is not interested in learning it. He wants to fix the one thing blocking his PR.

**Goal:** understand the specific error, find the offending field and line in his file, fix it, confirm locally, and move on.

**Pains:**
- Error messages are terse with no obvious remediation hint.
- He doesn't know which schema fired or why that rule exists.
- He doesn't want to read the full documentation. He wants a targeted answer.

**How he uses manni meta.** He follows the error link, or searches, to reach the fix-it page. He maps the error to a field and file location, then applies the fix. He runs `npx @hawkeyexl/manni meta validate <file>` locally to confirm green, and he is done.

**Which tools he owns work in.** He owns work in none of them. He reaches meta, lint, cite, a11y, docevals or tracevals only to fix the check that turned his pull request red.

**A red eval is harder to read than a red schema check.** docevals produces at least five failures that look alike in a CI log and have unrelated remedies. There is a deterministic finding pinned to a line, and an AI verdict with a rationale and no line. There is an eval parked in human review, which he has no standing to resolve. There is a generated script that no longer matches its assertion, and an operational exit `2` that is not his fault at all. Triage is the first screen. A rationale is not a remediation, so he reads the assertion and its `examples.fail` beside it to find the sentence. Being told to escalate, and to whom, is a correct outcome. His laptop has neither CI's key nor its warm cache, so the local check is `manni docevals run --deterministic-only` on one file.

The eval fix page has no subject dependencies. It is reached cold from an annotation and must be fully useful to someone who has read nothing else. A change that gives it a prerequisite is a defect.
