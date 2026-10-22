# 0101: A pin ignores every statement in its lines

- **Status:** Implemented
- **Serves:**
  - Maya · M30 and M31. A DITA task carries a statement on `<steps>`, and Doc
    Detective verifies each step under it.
  - Sara · S16. A tool that writes into one statement must not break another.
- **Depends on:** [0099](0099-inline-metadata-statements.md), whose
  statements and pins this changes.
- **Supersedes in part:** [0099](0099-inline-metadata-statements.md).
  [What this supersedes](#what-this-supersedes) names the two passages.
- **Touches:** `src/meta/core/statements.ts`,
  `src/graph/core/analyze-cache.ts`, one fixture pin in
  `test/fixtures/statements/dita/task.dita`, the inline statements page and
  the interop guide.

## Problem

0099 cut one statement out of a pin. That was the anchoring statement, and
only from its own line. Every other `meta` statement inside the anchored
lines was hashed with the content.

DITA makes that routine. By 0099's decision 3, a first child anchors its
whole element. So a statement on `<steps>` pins every `<step>` inside it,
each step's own statement included.

Three things then broke a pin with no edit to the content.

- **A verifier's write.** Doc Detective records a pass by writing `passed`,
  `version`, `last-verified` and a pin into a step's statement. The `<steps>`
  pin changed, and `meta validate` reported `statement-changed`. `meta
  derive` pinning the inner statement did the same.
- **A move.** A first-child statement moved onto or off its own line changed
  its pin.
- **A long carrier.** The cut assumed a statement fits on one line. A `<data>`
  start tag that spans lines was cut wrongly, and its end tag was kept.

## The rule

This replaces decision 5's second paragraph. The first paragraph, the hashing
rule itself, stands.

1. **Cut every statement.** Before hashing, every `meta` statement inside the
   anchored lines is cut out, delimiters included. That covers the anchoring
   statement and every other one.
   - A comment or instruction is cut from its opener to its closer.
   - A `<data name="manni-meta">` carrier is cut whole. That is the
     self-closing tag, or the start tag through the end tag. A carrier that
     spans lines is cut across them.
2. **Drop emptied lines.** A line that held a statement, and holds only
   whitespace after the cut, is dropped. A line that was blank before the cut
   stays.
3. **The rest is unchanged.** The lines are joined with LF, normalized and
   hashed, exactly as `pinOf` does. `pinOf` hashes the lines it is given, and
   the cut happens before it.

A writer makes the same cut. The interop guide's rule 11 says so.

## What changes

- **One fixture pin moves.** `test/fixtures/statements/dita/task.dita:8` is a
  first-child instruction on its own line. Rule 2 drops that line, so its pin
  changes.
- **Every other pin holds.** In the line-rule formats a stacked statement sits
  on a marker line, and anchors already skip those. Each fixture and this
  repo's three live statements keep their pins byte for byte.
- **No interface changes.** No config key, flag or message is added. A
  `statement-changed` stops firing when the only edit was to a statement
  inside the anchor.
- **The graph cache is rebuilt.** Its entry format goes from 2 to 3, so a
  cached status from the old rule is never served.

0099 has not reached npm. 4.17.0's publish failed, so no released pin
changes. That is why this ships as a fix.

## The number

Two open pull requests, #231 and #232, each claim 0100. This proposal takes
0101. If one of them renumbers to 0101, this one takes the next free number
at merge.

## Credit

Doc Detective's draft write-back, its pull request #417, found both cases.
Its first note asked for new keys in key order in the interop guide's
examples. Its second asked the inline statements page to show both DITA
placements.

## Stress test

1. **A step passes under a `<steps>` statement.** Doc Detective rewrites the
   step's statement. The `<steps>` pin reads `current`, and `validate` exits
   `0`.
2. **`derive` pins both at once.** It hashes the outer block with the inner
   statement cut. Writing the inner pin changes nothing the outer pin covers,
   so a second run writes nothing.
3. **A statement moves from the start tag's line to its own line.** Rule 1
   cuts it from either place, and rule 2 drops the line it left. The pin is
   the same.
4. **A blank line inside a step.** No statement was on it, so it stays and is
   hashed. An edit that removes it still changes the pin.
5. **A `<data>` carrier with an end tag.** It is cut start tag through end
   tag, so no stray `</data>` reaches the hash.

## What this supersedes

- **0099, decision 5, second paragraph.** It cut only the anchoring
  statement, only from its own line, and hashed every other line as it was.
  The rule above replaces it.
- **0099, Consequences, the third deviation.** It recorded the same one-line
  cut. The cut is now every statement, and an emptied line is dropped.

## Verification

- A `<steps>` statement stays `current` after its step's statement is
  rewritten, and after that statement gains or loses a pin.
- A `<data>` carrier inside an anchor is cut whole when self-closing, with an
  end tag, and with a start tag across two lines.
- A first-child statement pins the same on its start tag's line and on its
  own line. A line blank before the cut is still hashed.
- Every fixture pin except `task.dita:8` is byte-identical.
- A graph cache entry written under format 2 is not reused.
