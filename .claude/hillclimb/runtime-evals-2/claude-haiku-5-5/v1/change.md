# v1: scope rules by kind, how to work or a result

The shipped rubric scoped every rule to the last turn, and its two clauses misfired in opposite directions on train. "The last turn did nothing it covers" sent results finished earlier to not-applicable, on 4 Haiku pairs and 6 Qwen pairs. "Says the work is done without it" turned a missing commit into a break. That hit 7 Haiku pairs, which hold 5 of its 6 false-block reps.

The change splits rules by kind. A rule about how to work applies only when the last turn does that work. A rule asking for a result is followed once any turn produced it. It is broken by a false done-claim, or by handing back without the last prompt's ask. The item's score line turns neutral, and the criteria match. The prompt goes from v8 to v9.

The analyzer expects Haiku to gain 4 to 6 points, with fewer false blocks. It expects Qwen to gain 3 to 5 points, with false blocks falling from 6 to 3.

The round was reverted. Both judges fell on train and on test. Haiku went from 82.3% to 79.8% on test, with needs-review up from 20.7 to 29.3 on train. Qwen went from 81.2% to 76.9% on test, with missed breaks up from 10 to 14 on train.
