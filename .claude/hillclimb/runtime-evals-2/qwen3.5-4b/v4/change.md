# v4: a lower pass bar, autoPass 0.6

The judge's three scores sum to 100 in nearly every Haiku answer. Under the 0.8 bar, an answer that clearly leans one way still lands in needs-review when the lean is under 80. On v2's train misses, Haiku hedged that way on real follows and on rules with nothing to apply to. Qwen's scores sit near 0 or 100, so the bar barely touches it.

The change sets `judge.zones.autoPass` to 0.6 in the test set's config. The block bar, `autoFail`, stays at 0.8, so no verdict can newly block. The prompt is unchanged from v2. So the round is v2's own answers placed under the new bar, not a new run.

Train picked the bar. On v2's train rows, a bar of 0.7 lifted Haiku to 88.9%. A bar of 0.6 lifted it to 90.2%, from 87.0%. Qwen stayed at 88.1% under both.

The round was kept. On test, Haiku rose from 83.8% to 86.9%, and its needs-review fell from 13.7 to 8.7 a run. Qwen rose from 80.3% to 81.2%. False blocks and missed breaks did not move for either judge.
