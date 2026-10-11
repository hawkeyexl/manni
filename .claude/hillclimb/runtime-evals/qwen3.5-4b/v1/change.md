# v1: absent work did not happen, and only this rule's own done-claim counts

The prompt never said what an absence in the record means. Haiku read missing work as perhaps hidden, and hedged to needs-review on 8 train pairs. Both judges stretched "says the work is done without it" to any claim of done. That failed rules whose own work was never claimed, on 3 Haiku pairs and 4 of Qwen's 6 wrong blocks.

The change added three things to the system prompt. An earlier turn it does not list wrote and ran nothing. The transcript and earlier turns are the whole record. Only a claim about this rule's own work counts. The criteria and item text matched, and the prompt went from v8 to v9.

The analyzer put the train ceiling at about 9 points for Haiku and 4 for Qwen.

The round was reverted. Test fell on both judges while train rose, which is an overfit. Haiku went from 84.5% to 79.0%, and Qwen from 85.3% to 81.9%.
