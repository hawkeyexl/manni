# 0069: merge-safe stamps by default

- **Status:** Implemented (#132)
- **Serves:** Devin · D5, whose docs gate runs `validate` on the base branch
  after every merge, and Maya · M2, who stamps pages in a pull request.
- **Depends on:** [0040](0040-derived-metadata.md), which made derive and its
  decision 2. [0046](0046-provenance-pins.md), for provenance's evidence
  rules. [0068](0068-a-manifest-owns-what-the-marks-say.md), which puts a
  page's stamps in a manifest beside it.
- **Supersedes, in part:** [0040](0040-derived-metadata.md), for "`fields`
  absent manages nothing" and for decision 2 reading only the page.
  [0046](0046-provenance-pins.md), for rule 4 over a commit that stamped the
  page. In each the Status line is the only edit.
- **Touches:** `src/meta/core/config.ts`, `src/meta/core/derive/**`,
  `src/meta/commands/{derive,validate}.ts`, `test/**`,
  `docs/src/content/docs/meta/reference/{configuration,cli,api}.mdx`,
  `docs/src/content/docs/meta/set-up/derived-metadata.mdx`
- **Verdict:** A `derive:` block without `fields` manages the merge-safe
  fields, and on each page only the ones its schemas claim. Two evidence
  rules change so that a merge-safe value stamped in a pull request still
  reads current after a squash merge. One hole remains, and is recorded.

## Problem

A stamp is written on a branch and judged on the base branch after the merge.
Whether it is still current there depends on the field and on the merge.

This repository squash-merges. A squash commit is authored by the person who
merged, and dated at the merge. GitHub appends a `Co-authored-by` trailer
for every author of the branch's commits. Each field was traced through that
commit, a rebase and a merge commit.

| Field | Current after a squash? | Why |
|---|---|---|
| `owner` | yes | It comes from CODEOWNERS, and no commit is involved |
| `created`, `last-updated`, on the page | yes, with one hole | Decision 2 reads the stamp the fact commit carries. The hole is an edit whose stamp value did not change, which falls back to the merge date |
| `created`, `last-updated`, in a manifest | no | Decision 2 reads the page at the commit and never its manifest |
| `provenance`, stamped ranges | yes | 0046's rule 2 reads the manifest at the commit |
| `provenance`, unstamped lines | no | 0046's rule 4 matches the appended machine trailer, so a human line becomes a machine range |
| `authors` | no | The merger and the appended trailers join the list |
| `reviewed-by`, `last-reviewed` | no | They derive from merged pull requests only, so a branch has nothing to stamp |
| `verified-against`, and any command field | no | The release commit after the merge changes the evidence |

A docs gate that runs on the base branch fails after every merge when it
manages an unsafe field. So a team has to know this table to write a working
`fields` list, and nothing tells it.

## Decision

### The default set

`meta.derive.fields` absent now means the merge-safe fields. Those are
`owner`, `created`, `last-updated` and `provenance`. Each is managed only on
a page whose resolved schema set claims it as a top-level property. A page
without the stewardship vocabulary is never held to an owner.

| `fields` | Before | After |
|---|---|---|
| absent | nothing is managed | the merge-safe fields each page's schemas claim |
| `[]` | refused | nothing is managed |
| a list | exactly these | exactly these, safe or not |

This is a breaking change. A config with a `derive:` block and no `fields`
managed nothing, and now `validate` compares the safe fields its pages
claim. Such a config writes `fields: []` to keep the old behaviour. A config
with no `derive:` block still spawns nothing.

`manni meta derive` with no `--fields` derives the default set. When no page
claims any of the four, it exits 2:

```text
manni: nothing to derive: no page's schemas claim a merge-safe field (owner, created, last-updated, provenance); set derive.fields or pass --fields
```

### Two evidence rules

1. **Decision 2 reads the owning manifest.** The fact commit's stamp for
   `created` or `last-updated` is read from the page at that commit. It is
   also read from the manifest that owns the field, as 0046's rule 2 already
   reads provenance. A date kept in `{page}.meta.yaml` is then as
   squash-proof as one on the page.
2. **A stamped commit is the whole account of its lines.** When the commit
   that last touched a line carries the page's provenance stamp, a line
   outside every stamped range has no evidence. 0046's trailer rules do not
   reach it. A human line the branch left unstamped stays human after the
   squash appends a machine trailer.

### The hole that remains

An edit made on a day the page already carries that day's `last-updated`
leaves the stamp unchanged. Squashed on a later day, the fact commit did not
change the stamp, so decision 2 falls back to the merge date. The base branch
reads the page stale once, and `manni meta derive` there clears it.

A third rule was drafted to close it. It accepted an unchanged stamp that
lies between the previous body change and the fact commit's date, and it was
rejected. To git, that squash is the same as a page edited later without a
restamp, which is the stale stamp 0040 exists to catch. Missing that is worse
than one stale finding after a same-day re-edit.

Nothing else changes. `get` and `query` still derive every derivable field
at read time, and a `derived:stale` finding reads as before.

## Stress test

1. **A new page, squashed a day later.** Its `created` and `last-updated`
   live in its manifest. The squash commit adds the page and the manifest
   together, so rule 1 reads the stamps there, and both stay current.
2. **An edit on a day the page was already stamped.** The stamp does not
   change, and the squash lands tomorrow. The base reads it stale once. This
   is the hole above, and a test pins it.
3. **A human line in a Claude-co-authored pull request.** The branch stamps
   the machine ranges and leaves the human line out. The squash carries the
   stamp, so rule 2 keeps the line human.
4. **A page with only the core vocabulary.** It claims none of the four, so
   nothing is managed on it, and `validate` reports no stale stamp for it.
5. **A team that stamps authors after merge.** It lists `authors` in
   `fields`, as today, and runs derive on its base branch.

## Open questions

None.
