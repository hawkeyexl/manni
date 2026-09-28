# 0071: blank lines carry no authorship

- **Status:** Implemented (#135)
- **Serves:** Maya · M8, who reads a page's provenance to see which lines a
  machine wrote, and Devin · D4, whose gate compares the stamp.
- **Depends on:** [0046](0046-provenance-pins.md), which made provenance
  ranges and their pins. [0069](0069-merge-safe-stamps.md), whose rule 2
  reads a stamped commit as the whole account of its lines.
- **Supersedes, in part:** [0046](0046-provenance-pins.md), for how a range's
  ends are drawn, which kept entries a write replaces, and duplicates. The
  Status line is the only edit.
- **Touches:** `src/meta/core/derive/**`, `test/**`,
  `docs/src/content/docs/**/*.meta.yaml`
- **Verdict:** A blank line belongs to no author. It never starts or ends a
  provenance range, and a range of only blank lines is not written. A stamp
  drawn the old way reads stale once, and derive redraws it.

## Problem

0046 attributes every body line to whoever blame names. A blank line is
blamed like any other, so a paragraph break a model inserted becomes a range
of its own.

This repository's manifests held 202 such entries. Each covers blank lines
only, and each carries the hash of the empty string. They say a model wrote
nothing, and a reader counting machine-written lines counts them.

## Decision

A blank line is one that is empty or holds only whitespace.

1. **Ranges are trimmed.** No range starts or ends on a blank line.
2. **A blank-only range is dropped.** It is not stamped, and it is not
   expected when the stamp is compared.
3. **Blank lines inside one author's text bridge it.** Two paragraphs with
   the same attribution and a blank line between them form one range. The
   blank line sits inside it, and the hash covers it as before.
4. **A blank line is never unset.** `validate` does not report a blank line
   as missing its provenance.
5. **An entry drawn the old way is stale.** A stamped entry that starts or
   ends on a blank line is not a well-formed range, so `validate` reports it
   stale. `derive` rewrites it trimmed, or drops it when it holds only blank
   lines.
6. **A derived range replaces what it contains.** When derive writes a
   range, every kept entry that lies inside it is dropped. The derived range
   is the newer account of those lines. This also covers a machine that
   extends its own range, whose old shorter entry used to stay beside the new
   one.
7. **An entry is written once.** When derive writes provenance, an entry
   identical to one already kept is not written again. Trimming can make two
   old overlapping entries identical, and a list must not hold both.

The rule holds wherever provenance is derived or compared. That covers
`derive`, the stale check in `validate`, the derived values `get` and
`query` read, and `--generated-by`, which trims a range it is given in the
same way.

## Stress test

1. **A model's two paragraphs.** They form one range with the blank line
   between them.
2. **A model's paragraph after a person's.** Two ranges, and the blank line
   between them is in neither.
3. **A page stamped before this change.** Its blank-only and blank-edged
   entries read stale once. `manni meta derive` rewrites them, and the page
   is current after that.
4. **A split stamp.** A page stamped `1-3` and `5-7` for one model, with a
   blank line 4, derives `1-7`. The old pair differs from it only by a
   bridged blank line, so it compares current and no write is forced. The
   next write for that page keeps `1-7` alone, because it contains both old
   entries.
5. **A blank line added inside a machine range.** The range's text changes,
   so its hash does too. The pinned text is found nowhere, so the entry reads
   changed, a `derived:stale` finding. A person editing inside a
   machine's range is what the stale check exists to catch.
6. **A blank line in a stamped commit, outside every range.** 0069's rule 2
   leaves it with no evidence. It needs none, because a blank line carries no
   author, so no finding follows.

## Open questions

None.
