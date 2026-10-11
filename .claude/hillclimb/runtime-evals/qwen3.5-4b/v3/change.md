# v3: evidence first

Qwen asserted facts the transcript contradicts on 8 of its 13 failing train pairs. It called a numbered list a paragraph, and called a spawned auditor absent. Haiku hedged with "the record cannot confirm" where the evidence was simply absent.

The change added one step for every rule. The schema gained a required `evidence` string before `reasoning`. The item asked the judge to quote up to three exact lines that bear on the rule, or to write none. Then it says whether those lines do or claim the rule's work, and then it scores. The prompt went from v8 to v9, and the decision path stayed unchanged.

The analyzer expected Qwen to gain 6 to 9 train points and Haiku to hedge less. The risk was about 45 more tokens per rule for a model that swings on input changes.

The round was reverted. Haiku went from 84.2% to 85.1% on test, inside the noise. Its wrong blocks rose from 0.7 to 1.3 per pass. Qwen fell from 85.3% to 82.2%, with wrong blocks up from 4 to 5 per pass. Train rose on both judges.
