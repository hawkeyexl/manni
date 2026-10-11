# v6: show what met a rule's trigger

The gate decides that a rule with a trigger applies, but the judge saw only the rule's text. A file-access trigger also fires on a read, so a turn that only read a file looked to the judge like a change. On train, Qwen scored a database rule broken because the turn read a migration. It called the read a kind of migration change.

The change lists what met the trigger under the rule, one line each, from the turn the gate checked. A line reads like "read src/db/migrations/001.sql" or "ran `npm test`". When every match was a read, one more line says that no matching file was written or edited. Rules with no trigger keep the v4 item text, and no line names a verdict. The judge prompt goes from v8 to v9.

It changes 26 of 193 train items, so Qwen's answers on the rest cannot move. The analyzer expects Haiku to hold flat, and Qwen to gain about half a point with one fewer false block a run.

The round was reverted, and it was the third flat round, so the climb stopped. On test, Haiku went from 86.9% to 87.2%, inside its noise, and its missed breaks rose from 2.3 to 3 a run. Qwen fell from 81.2% to 80.3%, and its false blocks rose from 2 to 4.
