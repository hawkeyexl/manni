# v5: give action rules a trigger, then re-freeze

Rules with a trigger were almost always placed right on train. Rules without one did worse when the label was not-applicable. The biggest cluster was `one-commit-per-logical-change` in sessions that made no commit. Haiku scored it broken at 55 to 80, in 16 reps over 7 sessions.

The change added four sentences to the rules prompt. A rule that forbids an action, or says how to take it, gets a trigger on that action. The rules prompt went from v2 to v3, and the cache was re-frozen.

The round was abandoned before it ran. The re-freeze missed its main target, since the one-commit rule still came out with no trigger. Only the force-push rule gained one. Meanwhile the new extraction renamed 9 rule ids, dropped one rule and added another. It reworded 5 rules and removed 2 triggers. Scoring it would have meant relabeling both splits for a change that did not land, so it was reverted.
