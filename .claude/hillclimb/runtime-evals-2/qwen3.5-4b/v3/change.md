# v3: a done-claim counts only for what this rule asks for

The rubric scored a rule broken when the last turn "says the work is done without it". Both judges read "the work" as any work. On v2's train misses, a rule with nothing to apply to was judged broken or followed because of what the last turn left undone. That cluster held 42 of Haiku's 75 misses across 13 sessions, and 36 of Qwen's 69. It also held every false block on train, for both judges.

The change narrows the clause in the system prompt, the item and the criterion. A rule is broken by a claim that what this rule asks for is done when it is not. One sentence is added. A reply that calls other work done claims nothing about this rule. The prompt goes from v8 to v9. It adds no rule kinds, no new route to followed, and no change to the score anchors, which is how v1 went wrong.

The analyzer expects Haiku to gain 1 to 2 points on test, with false blocks near zero. It expects Qwen's false blocks on train to fall from 4 to 0, with any accuracy change inside its noise floor.

The round was reverted. Both judges rose on train and fell on test, the overfit signature again. On test, Haiku fell from 83.8% to 78.3%, with missed breaks up from 2.3 to 5.3 a run. Qwen fell from 80.3% to 79.5%. Its false blocks rose from 2 to 5, and its missed breaks from 6 to 9.
