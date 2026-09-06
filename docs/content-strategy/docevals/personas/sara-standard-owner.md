---
id: persona-standard-owner
type: persona
name: "Sara, Docs Quality Standard Owner"
audience: aud-quality-standard-owner
role: Staff writer, content strategist, or docs lead who owns the style guide and the quality bar
shared_with: manni meta
proficiency:
  [style-guide-authorship, information-architecture, yaml, precedence-reasoning,
   reading-agreement-and-error-rates]
prerequisites: [the-eval-grader-verdict-model, the-grader-hierarchy]
goals:
  - Turn a prose quality standard into assertions a grader can adjudicate consistently
  - Prove with numbers that the judge agrees with human reviewers often enough to gate a build
  - Keep false positives low enough that nobody wants the check removed
  - Push evals down the grader hierarchy so cost and flakiness do not grow with the corpus
pains:
  - Writing a judgeable assertion is a skill nobody has yet
  - Without a golden set she cannot answer "is the judge right?"
  - Binary verdicts feel lossy until the suite-pass-rate reframe lands
  - Left alone, everything becomes an ai eval
content_types:
  [assertion-craft-guide, calibration-walkthrough, conceptual-explainer, human-review-runbook]
journeys:
  [cuj-write-judgeable-assertions, cuj-trust-the-judge, cuj-resolve-review, cuj-cheapen-evals,
   cuj-eval-library]
---

# Persona: Sara

**Scope:** the definer-of-correctness persona for
[`aud-quality-standard-owner`](../audiences/quality-standard-owner.md). Sara decides what "good"
means; [Priya](priya-corpus-owner.md) enforces it and [Devin](devin-pipeline-owner.md) operates it.
Below a certain team size all three are one person, and no page may assume they are separate.

**Deliberately the same Sara as manni meta's**, with a changed subject. There she encodes a metadata
standard as JSON Schema; here she encodes a prose standard as assertions. Same instinct, same
seniority, different medium. See [`_overview.md`](_overview.md).

Sara is a staff writer or content strategist who owns the style guide and the page templates. She is
fluent in YAML, reasons comfortably about precedence and inheritance, and can read an agreement rate
and a false-positive rate without a tutorial. She is the persona who read the methodology before she
found the tool. She is also the one who will be asked, in a review, "why did this fail?"

Her hardest problem is the smallest-looking one: **most assertions people write are unjudgeable.**
"The page is well-written" cannot be adjudicated by anything. "The page states its prerequisites
before the first command" can. The distance between those two sentences is where Sara spends her
effort, and teaching it is the most valuable thing the site does for her. That is why
`evidence`, `examples.pass`, and `examples.fail` are taught as the mechanism that closes the gap,
not as optional frontmatter fields.

Her second problem is **proof**. A quality bar resting on trust will not survive contact with a
skeptical engineering org. She needs the golden set, `calibrate`, the 70% agreement floor, and
`judge.false-positive-alert` as artifacts she can take to that conversation. She cares more about false
positives than about raw accuracy. A check that fails good pages gets disabled inside a week,
and a check that misses a few bad ones does not.

Two reframes have to land explicitly or nothing else does. First, binary verdicts are not crude,
because the nuance lives in the **suite pass rate**. Regression suites target ~100%, capability
suites ~70%. Second, the human-review zone is not a failure of the design. It is the escape hatch that
makes a binary verdict acceptable in the first place. Both are counterintuitive on first contact and
both are load-bearing for her adoption.

She is also the persona who owns the discipline that keeps the tool affordable. If nobody applies
`promote` and `generate`, every eval stays an ai eval and cost grows with the corpus forever.

Success for Sara is a calibration report showing 88% agreement and a 6% false-positive rate. She
prints it in a doc and hands it to an engineering director, who then stops asking whether the check
is trustworthy.
