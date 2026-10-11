# Runtime-evals hill-climb, climb 2

The goal was unchanged from climb 1. It asks for placement accuracy of at least 95% on the held-out test split, for both judges, with zero false blocks. Missed breaks and needs-review must not regress. Train grew from 19 sessions to 40 first, with the boundary types climb 1's label audit found. Both splits were then labeled under one policy. A dropped request reads not-followed, and a read-only touch of a read-triggered rule reads not-applicable. Each round ran 3 reps on 193 train pairs and 117 test pairs.

| round | change | Haiku test | Haiku train | Haiku false blocks (test) | Qwen test | Qwen train | Qwen false blocks (test) | kept |
|---|---|---|---|---|---|---|---|---|
| 0 | baseline, judge prompt v8 | 82.3% | 86.4% | 0.3 | 81.2% | 85.5% | 6 | |
| 1 | scope rules by kind, how to work or a result | 79.8% | 83.9% | n/a | 76.9% | 83.9% | n/a | no |
| 2 | render the whole session, with a heading where the last turn starts | 83.8% | 87.0% | 0.3 | 80.3% | 88.1% | 2 | yes |
| 3 | a done-claim counts only for what this rule asks for | 78.3% | 88.3% | 0.0 | 79.5% | 89.6% | 5 | no |
| 4 | a pass bar of 0.6, rescored from round 2's answers | 86.9% | 90.2% | 0.3 | 81.2% | 88.1% | 2 | yes |
| 5 | give action rules a trigger, then re-freeze | not run | not run | n/a | not run | not run | n/a | no |
| 6 | show what met a rule's trigger | 87.2% | 90.3% | 0.0 | 80.3% | 87.6% | 4 | no |

The climb stopped after its third flat round. The code is at rounds 2 and 4.

## Recommended change

Merge rounds 2 and 4. Neither reaches the goal. Haiku ends at 86.9% on test and Qwen at 81.2%.

- [REQUIRED] The per-turn judge sees the whole session, with a heading where the last turn starts. Before, it saw only the last turn under a header that counted the whole session. Both judges read the gap as work never done. Qwen's false blocks on test fell from 6 to 2, and its missed breaks from 9 to 6.
- [TUNE] The test set places verdicts with a pass bar of 0.6, and leaves the block bar as it was. Haiku's three scores sum to 100, so a clear lean under 80 landed in needs-review. On test, Haiku rose from 83.8% to 86.9%. False blocks and missed breaks did not move, since no verdict can newly block. The tool's own default stays at 0.8. A hosted judge that splits its scores this way would gain from the same bar.

## Versus baseline

Haiku rose 4.6 points on test, and its needs-review fell from 15.3 to 8.7 a run. Qwen ended where it began on accuracy. Its false blocks fell from 6 to 2, and its missed breaks from 9 to 6.

## Why trust this

The analyzer read train only. Test was scored every round and never opened. Round 4 placed round 2's saved answers under the new bar, so it is exact for that sample. The rescorer matched round 2's stored accuracy at the old bar on every row. Rounds 1 and 3 rose on train and fell on test, the overfit signature climb 1 also found.

## What else was tried, and what it shows

- Rubric wording has now overfit in 5 of 6 rounds across two climbs. Each one fixed a train cluster and lost more on test.
- Placement is exhausted. A sweep of both bars over the cached scores never moves Qwen. Haiku gains more only by adding false blocks.
- The round 5 re-freeze missed its target. The one-commit rule still came out with no trigger. The new extraction also renamed 9 rule ids, dropped one rule and added another. Scoring it would have meant relabeling both splits.
- Showing what met a trigger reached too few items to matter. Qwen's false blocks on test still rose from 2 to 4.

## What I would try next

- A freeze that keeps rule ids and texts, so an extraction change adds triggers without reshuffling the set.
- A separate judge item for the local model. One shared item has to survive Qwen's input sensitivity, and none of the item changes did.
- Score followed and not-applicable as one passing class, if the metric should match what production does with a verdict. On round 4 that reads 91.7% for Haiku and 92.3% for Qwen. You chose to keep the exact match for this climb.
