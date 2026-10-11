# v2: render the whole session, with a heading where the last turn starts

The judge saw only the last turn's events, under a header that counted the whole session. In 33 of 40 train sessions the earlier-turns block was empty. The header still said "N of M session events" and "turns: 2 (of 2)". On train, the judges read that gap as missing work. Haiku cited it in 19 to 27 rep misses, and Qwen in 3 false blocks on clear breaks.

The change renders every event of the session. A "## The last turn" heading marks where the judged turn starts. Over the cap, the lines before that heading go first, oldest first, and only then is the turn itself cut. The rubric stays at v8, so this round changes what the judge sees and nothing else.

The analyzer expects Haiku to gain 2 to 3.5 points, and Qwen 0.5 to 1.5. It does not expect this alone to reach 95%.

The round was kept. On test, Haiku rose from 82.3% to 83.8%. Its needs-review fell from 15.3 to 13.7 a run, and its missed breaks from 3 to 2.3 a run. Qwen fell from 81.2% to 80.3%, inside its noise floor. Its false blocks fell from 6 to 2, and its missed breaks from 9 to 6.
