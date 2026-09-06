---
status: "accepted"
date: 2026-08-28
decision-makers: [hawkeyexl]
---

# `fill` writes a durable `eval-provenance` trail instead of reporting confidence and forgetting it

Supersedes [ADR 01001](01001-fill-proposes-llm-evals-with-confidence-gating.md).

## Context and Problem Statement

ADR 01001 gave `fill` a numeric confidence gate. The model self-reports 0–1 per proposal, anything at or above `fill.confidence-threshold` is written into the page, and everything else is reported and dropped. Its own wording is the thing this ADR reopens: *"confidence and rationale stay report-only."*

The gate works. What it leaves behind does not. Once the run ends, the page is indistinguishable from one a human wrote. Nothing records that a model proposed the eval, which model, or how sure it was. A reviewer reading a PR full of new evals cannot tell a machine's 0.71 from an author's considered judgment. Nor is there a way to tell six months later whether anyone ever checked.

[ADR 01009](01009-implement-the-docmeta-evals-vocabulary.md) adopts a vocabulary that has an answer to exactly this. That answer is `eval-provenance`, docmeta proposal 0023's family-wide "machines propose; humans retire the provenance" pattern. It also appears on the page (`provenance`) and in the graph block (`kg.provenance`).

## Decision Drivers

- **The gate answers "should this be written". It does not answer "has a human looked at it".** Those are different questions and only the first was being asked.
- **Confidence is evidence, and it was being thrown away** at the exact moment it became reviewable, after the write, when someone else reads the diff.
- **A trail is only useful if it can be retired.** A permanent "a machine wrote this" marker becomes noise; one a reviewer deletes is a worklist.
- **The vocabulary already specifies it**, down to merge semantics, so inventing a local shape would be a second dialect the day after 01009 removed one.

## Considered Options

- **Keep confidence report-only** (01001 as written).
- **Write confidence onto each eval entry**, as a field beside `assertion`.
- **Write a page-level `eval-provenance` trail**, one entry per model.

## Decision Outcome

The chosen option is **a page-level `eval-provenance` trail**, per the vocabulary. `fill` writes one entry naming the model, the ids it proposed, and its confidence per id, in the same YAML edit that appends the evals.

```yaml
eval-provenance:
  - generated-by: claude-fable-5
    evals: [install-verified, eks-coverage]
    confidence:
      install-verified: 0.88
      eks-coverage: 0.74
```

The confidence gate from 01001 is **kept unchanged**, meaning threshold, dedupe, per-page cap, dry-run byte-identity, and cost budget. This supersedes 01001 on one point only: what happens to the confidence after the decision.

Two details worth stating, because both were choices:

- **Entries merge by `generated-by`.** A second `fill` run by the same model extends its existing entry rather than stacking a near-duplicate; a different model gets its own. Two entries for one model would leave a reviewer reconciling them by hand to answer "has anyone checked these?". That is the one question the trail exists to answer.
- **`fill` never deletes an entry.** Retirement is a human action. A tool that cleared its own provenance would be asserting review it did not perform.

It sits at the page level rather than on each entry. It is a claim about *how the page was authored*, not about what an eval asserts. A per-entry `confidence:` field would also have to be a legal eval field forever, read by nothing at run time.

### Consequences

- **Good.** A reviewer can see which evals a machine proposed and how sure it was, in the diff, without re-running anything.
- **Good.** A surviving entry is a durable "unreviewed" marker, so the retrofit journey gets a worklist instead of a vibe.
- **Neutral.** Pages `fill` touches gain a key. It is part of the published schema, so it validates like anything else.
- **Bad, and accepted.** Nothing verifies that a deleted entry means a human actually reviewed the evals. The trail records a claim and its retirement; it cannot audit the retirement. The alternative is a signature or a review log. That is a much larger mechanism for a marginal gain over "the reviewer deleted it in a PR someone approved".

### Confirmation

`test/unit/frontmatter-append.test.ts` pins the shape and the merge-by-model behavior. It also pins the separate-entry case for a second model, and that no trail is written when none is supplied. Every output there is validated against the published schema, so `fill` cannot write provenance the schema rejects. The 01001 gate tests are unchanged and still pass, covering threshold boundary, dedupe, cap, dry-run, cache, budget, and per-page error containment.

## Pros and Cons of the Options

### Keep confidence report-only

- Good, because it is what shipped and costs nothing.
- Bad, because the evidence is destroyed at the moment it becomes useful to someone other than the person who ran the command.
- Bad, because terminal output is not reviewable in a pull request.

### Confidence on each eval entry

- Good, because it keeps the number next to the thing it describes.
- Bad, because it makes a run-time-meaningless field permanent in the eval vocabulary.
- Bad, because it has no natural retirement. Deleting the field per eval is fussier than deleting one block, and half-retired is a state nobody can read.

### Page-level `eval-provenance`

- Good, because it is the vocabulary's own answer, with merge semantics already specified.
- Good, because retirement is one deletion, and a surviving block is unambiguous.
- Neutral, because it is one more page-level key, under the reserved `eval-` prefix the schema already polices.
