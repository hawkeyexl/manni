---
status: "accepted"
date: 2026-09-01
decision-makers: [hawkeyexl]
---

# Split long content for inference; never truncate it

## Context and Problem Statement

Three paths sent page content to a model, and two of them silently cut it. `fill` and `scriptgen`
both did `slice(0, 6000)` and appended `…(truncated)`; the judge capped nothing and sent whole
pages. A page over the cap was filled and script-generated from its first half. The model never
saw the rest, and nothing in any output said so.

## Decision Drivers

- A proposal or a script derived from half a page is indistinguishable, downstream, from one
  derived from all of it.
- docmeta solved this for its own `fill`; the family should not solve it twice or differently.
- The judge's case is not the same shape as the other two. It produces a *verdict*, and verdicts do
  not merge the way proposals do.

## Considered Options

- Raise the cap.
- Split, and merge per-part results, including per-part verdicts for the judge.
- Split, and for the judge gather evidence per part, then judge once.

## Decision Outcome

The chosen option is to **split, with a merge chosen per path**. `src/core/split.ts` ports docmeta's
contract. That means greedy chunks cut at the last newline, with no overlap. Content that fits is
returned unchanged, and a provider overflow triggers halve-once-and-retry.

- **`fill`** proposes against each part and merges by eval id, keeping the highest confidence.
- **the judge** gathers bearing evidence from each part, then judges the assertion against the
  collected evidence in a single call.
- **`scriptgen`** produces one artifact, so there is nothing to merge: the cap simply comes out.

### Consequences

- Good, because no path silently drops bytes.
- Good, because merging per-part *verdicts* is avoided, and it is unsound. "The page documents the
  `--force` flag" is satisfied if *any* part documents it; "the page never promises unreleased
  features" is violated if *any* part promises one. One needs OR across parts, the other AND. Nothing
  in an assertion's text reliably says which, so a merge rule would have to guess, and guess
  quietly. Gathering evidence sidesteps the quantifier. One judge answers the original question
  against the whole collection, as it would have with the page in front of it.
- Good, because the verdict contract is unchanged, still one `JudgeVerdict` per run. Consensus,
  confidence zones, the response cache, human review and `calibrate` needed no changes.
- Good, because content that fits skips the evidence stage entirely, so the common path is
  byte-identical to before and its cached verdicts stay valid.
- Bad, because a split page costs one call per part on top of the verdict calls.
- Bad, because the judge prompt changed, so `PROMPT_VERSION` bumps and any cached verdicts formed
  under the old prompt are invalidated.
- Neutral, because `scriptgen` gains no splitting. With one output there is nothing to merge, and
  an overflow there is already an errored result (ADR 01022) rather than a half-informed script.

### Confirmation

`test/unit/split.test.ts` pins that parts rejoin to the original, and that a line longer than the
budget still makes progress. It pins that a short page is judged in exactly one call with no
evidence stage. A long one gathers per part and judges once. It also pins that a part which cannot
be gathered errors rather than judging on an incomplete collection. `chunk-<budget>` is in both
cache keys for the reason docmeta documents at its own call site. Halve-and-retry makes two budgets
produce genuinely different content, and without the budget in the key the second run silently
replays the first.
`test/unit/fill.test.ts` pins that the budget in `fill`'s key is the one the proposals were
*produced* at, rather than the one the run asked for. The first implementation stored a
halved-budget result under the full-budget key, which is the replay this rule exists to stop.
There is deliberately no fallback lookup at the halved budget. Serving across the two keys is the
same collision spread over two entries. A page that overflows does so deterministically for
one provider and body, so the retry path finds its own entry from the second run onward.

## Pros and Cons of the Options

### Raise the cap

- Good, because it is one number.
- Bad, because it moves the cliff rather than removing it, and the next page over the new cap fails
  the same silent way.

### Merge per-part verdicts

- Good, because it needs no second prompt.
- Bad, because it is unsound for the quantifier reason above, and unsound quietly.

### Evidence then judge

- Good, because it is correct for both quantifiers without inspecting the assertion.
- Good, because the downstream contract is untouched.
- Bad, because it is a second prompt and a second schema to maintain.
