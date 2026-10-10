# v2: give every earlier turn a line

The earlier-turns block dropped any turn that wrote nothing, ran nothing and read no rule source. Every train session opens with such a turn. So the judge saw "N of M session events" with nothing to account for the hidden ones, and Haiku hedged. This covered 8 Haiku pairs, or 14 of its 33 wrong rows.

The change gave such a turn the line "ran no command and wrote no file". The fact is computed for each turn, so it cannot be false for an unseen session. There was no prompt change and no version bump.

The analyzer expected Haiku to gain 2 to 4 test points and Qwen to stay flat.

The round was reverted. Haiku went from 84.5% to 85.3% on test, inside the noise. Qwen fell from 85.3% to 79.3%, with needs-review up from 0 to 5 and missed breaks from 6 to 7.
