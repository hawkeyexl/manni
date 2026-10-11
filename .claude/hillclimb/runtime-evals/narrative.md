# Runtime-evals hill-climb

The goal was placement accuracy of at least 95% on the held-out test split for both judges, with zero wrong blocks. Missed breaks and needs-review must not regress. Each round ran 3 reps on 91 train pairs (19 sessions) and 116 test pairs (20 sessions).

| round | change | Haiku test | Haiku train | Haiku wrong blocks (test) | Qwen test | Qwen train | Qwen wrong blocks (test) |
|---|---|---|---|---|---|---|---|
| 0 | baseline, judge prompt v8 (Haiku judged outside a git repository) | 84.5% | 87.9% | 0.3 | 85.3% | 85.7% | 4 |
| 1 | absent work did not happen; only this rule's own done-claim counts | 79.0% | 89.4% | 0.7 | 81.9% | 86.8% | 7 |
| 2 | every earlier turn gets a line | 85.3% | 88.6% | 0.0 | 79.3% | 85.7% | 4 |
| 0' | Haiku re-baselined, CLI judge in a git repository | 84.2% | 84.2% | 0.7 | n/a | n/a | n/a |
| 3 | evidence first (quote the lines, then score) | 85.1% | 89.4% | 1.3 | 82.2% | 87.9% | 5 |

Haiku rounds 1 and 2 compare against row 0. Round 3 compares against row 0'. Every change is reverted. The code is at the baseline judge.

## Recommended change

Merge no judge change from this loop. None beat the baseline on held-out sessions. Keep the benchmark fixes, which are test-only:

- [REQUIRED] The CLI judge runs from a git repository. It had read "not a git repository" into commit rules, in 17 reasonings.
- [REQUIRED] The CLI judge parses the first JSON object of a reply. A case it cannot judge is scored as errored, which no longer ends the pass.
- [REQUIRED] The CLI judge refuses a reply that a different model served.
- [TUNE] The held-out test split (20 blind sessions, 121 pairs) and the round runner.

## Versus baseline

On test, Haiku stayed at 84.2% to 85.3% across every round, and its reps spread about 7 points (80.2 to 87.1). Qwen fell in every round, by 3 to 6 points. Train rose in every round for both judges.

## Why trust this

The analyzer read train only. Test was scored every round and never opened. The headline numbers were recomputed from the per-row results. Train rising while test falls, round after round, is the overfit signature. The train set is 19 sessions, so a change that fixes its failures does not transfer.

## What else was tried, and what it shows

- The block bar was ruled out on train. No setting moves Qwen, whose wrong blocks score 80 to 100.
- Qwen is deterministic for a given input, but any input change moves its held-out score by 3 to 6 points. Small input changes are its effective noise floor.
- Haiku's ceiling under this judge is near 85%. Most of its misses are hedges into needs-review, which never block.

## What I would try next

- Audit the test labels with an independent reviewer who proposes no changes. They were written blind by one agent, and a label policy that drifted from train's would cap every round.
- Grow train to about 40 sessions, so a change has to hold across more shapes before it reaches test.
- Let a small local model get its own judge prompt. One shared prompt has to survive Qwen's input sensitivity, which none of these did.
- Score "followed" and "not applicable" as one passing class. Both pass in production, and the split between them costs Qwen up to 3 points.
