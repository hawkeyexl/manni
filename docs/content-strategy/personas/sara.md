---
type: persona
id: sara
title: Sara, Schema Author / Information Architect
description: Sara defines what the metadata means.
audience: schema-authors
goals:
  - Encode the metadata standard as a JSON Schema, wire it to the right documents, and evolve it safely as requirements change.
pains:
  - Dialect confusion. The differences between draft-07 and 2020-12 trip her up.
  - Precedence uncertainty. She isn't sure whether `$schema` in a file overrides the config, or the other way around.
  - Shipping a stricter required field without breaking every existing repo overnight.
---

Sara defines what the metadata *means*. That covers which fields are required and which are recommended, what value formats are acceptable, and the versioning policy for the standard. She has medium-to-high proficiency and understands data modeling, and she is actively learning JSON Schema's finer points.

**How she uses manni meta.** She authors schemas, starting from the OKF built-in or from scratch. She wires them to directories via config overrides, tests resolution, and manages upgrades with versioned URLs.

**Which tools she owns work in.** She owns work in meta and key, and in the citation standard, the eval library and the artifact-evals vocabulary. The required field, its encrypted value, its citations and the assertions a page is judged against are hers.

**The same instinct, in prose.** In docevals she encodes a prose quality standard as assertions rather than a metadata standard as JSON Schema. Three problems are hers there:

- **Most assertions people write are unjudgeable.** "The page is well-written" cannot be decided by anything. "The page states its prerequisites before the first command" can. `evidence` and `examples.pass` / `examples.fail` are the mechanism that closes that gap, not optional fields. The test is whether two reviewers reading the same page would reach the same verdict.
- **Proof.** A standard resting on trust does not survive a skeptical engineering org. She needs a golden set, `manni docevals calibrate`, the 70% agreement floor and the false-positive alert (`judge.falsePositiveAlert`) as artifacts to take into that conversation. She cares more about false positives than raw accuracy, because a check that fails good pages is disabled within a week.
- **Cost that grows with the corpus.** Left alone, every eval stays an `ai` eval. `promote` and `generate` are the discipline that moves them down the grader hierarchy, and applying it is hers.

Two reframes have to land for her. Binary verdicts are not crude, because the nuance lives in the suite pass rate (regression suites near 100%, capability suites near 70%). And the human-review zone is not a failure of the design, it is what makes a binary verdict acceptable. She usually owns the review queue too.
