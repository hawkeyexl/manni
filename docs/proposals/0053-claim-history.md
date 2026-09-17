# 0053: claim history, so `manni cite` reads the page's past as it reads the source's

- **Status:** Implemented (#73)
- **Serves:** Three journeys in `../content-strategy/cujs.md`.
  - Maya · M5, "Pin a claim and catch it going stale". She reviews the claims
    whose words changed, and no others.
  - Theo · T2, "Read a citation failure and fix it". A `claim-changed` row
    tells him since when, and `--show-diff` shows him what.
  - Devin · D5, "Gate citations in CI without blocking on prose". A layout
    change stops reading as a prose change in the PR annotations.
- **Depends on:** Two records.
  - [0044](0044-citations-and-drift.md) is the citation, the claim pin, the
    rule table and the output rule this extends.
  - PR #43 is the marker anchor rule as it will ship. Stacked markers share
    their paragraph, and `add --marker` goes above the paragraph. That rule
    change is one of the two causes of the evidence below.
- **Relates to:** Three records.
  - [0023](0023-metadata-vocabularies.md) principle 4, that a derivable fact
    lies. It decides where the baseline commit comes from.
  - [0040](0040-derived-metadata.md), which reads git for facts rather than
    storing them.
  - [0001](0001-validation-baseline.md), the baseline a reclassified finding
    has to survive.
- **Supersedes, in part, once implemented:** 0044's meaning of
  `claim-changed`. It meant "the pinned page text is gone". It comes to mean
  "the words the pin covered were edited".
- **Refined by review:** PR #46's review round, recorded in the decisions below.
- **Touches:** `src/cite/core/{claims,check-page,git,adapt,severity}.ts`,
  `src/cite/commands/update.ts`, `src/cite/reporters/{pretty,json}.ts`,
  `src/cite/types.ts`, `docs/src/content/docs/cite/**`, `test/cite/**`,
  `test/fixtures/cite/**`
- **Verdict:** Read the page's git history for a claim that no longer holds,
  as `source.commit-sha` already lets `check` do for the source. The baseline
  is derived, never stored. It is the newest commit in which the page still
  held the pinned text. No schema field is added and no text is copied. From
  that commit `check` says `changed since 3f9c2a1, 2 commits`, and
  `--show-diff` prints the claim's own diff. A claim whose words are unchanged
  and whose whitespace, markers or anchor moved is a new notice,
  `claim-reanchored`, and plain `update` re-pins it.

## Problem

Maya dogfooded `manni cite` on this repository's own a11y docs. About 300
citations went onto five pages. Then two docs PRs corrected sentences the
source contradicted (#41, #42). A cite fix changed how markers anchor (#43).
After the merges, 92 claims read `claim-changed`.

Only 24 had been reworded. The other 68 had only been re-anchored. A marker
moved to the top of its paragraph, or the anchor rule stopped counting a
sibling marker line. Not one word the pin covered had changed in those 68.

`check` could not tell the two groups apart, and it had no way to. The claim
is pinned by a hash and never copied, which 0044 chose on purpose. So all
`check` knows is that the hash no longer matches. It cannot say what the text
was, when it changed, or whether the change was whitespace and markers.

```console
$ manni cite check docs/src/content/docs/a11y/
⚠ docs/src/content/docs/a11y/index.mdx
    ↕ page-at-a-time    marker :41 changed    src/a11y/core/crawl.ts:88-97 current
    ↕ anchor-links      marker :52 changed    src/a11y/core/url.ts:19 current
    ↕ sitemap-seeds     marker :63 changed    src/a11y/core/sitemap.ts:224 current
    ...
5 files checked, 5 passed, 0 failed, 92 findings (92 warnings)
# exit 0
```

Every row reads the same. `anchor-links` is a sentence #41 rewrote, because
the source strips the fragment rather than skipping the link. `page-at-a-time`
is a paragraph whose marker was hoisted, with every word intact. The
`--show-diff` flag prints the lines the claim covers now. It cannot print what
they were.

Maya had three ways forward, and each cost something.

- **Accept all 92.** `update --accept` re-pins every one. That silently blesses
  24 claims whose meaning changed, which is what the citation existed to catch.
- **Read all 92 by hand.** For each row, open the page, find the paragraph,
  run `git log -p` on the page, and find the old paragraph. That is an
  afternoon for a docs engineer.
- **Write a script.** Maya did this. It read each claim's current text and
  diffed it against the page at the pre-merge commit, with markers stripped.
  It sorted 68 from 24 in seconds. It is also a second tool that knows the
  anchor rules, and it lives outside manni.

The source end already solves this with git. `source.commit-sha` gives
`source-changed` its `changed since 3f9c2a1, 2 commits`. It gives
`--show-diff` the commits and the diff, and it separates `source-never-true`
from a real change. The claim end has none of that, although the page sits in
a git repository too.

Theo hits the same wall one row at a time. His PR carries a `claim-changed`
warning on a sentence he did not write. T2 promises him one status, one
action, one re-run. Today that action is "confirm the citation still holds",
and nothing on the row says what changed.

## Summary

- **A derived baseline.** For a claim that no longer holds, `check` walks the
  commits that touched the page, newest first. It stops at the first commit
  whose page still holds the pinned text. Nothing is stored, so a squash, a
  rebase or an uncommitted page cannot make the baseline wrong.
- **The words test.** Strip cite marker lines and collapse whitespace on both
  sides. The claim is re-anchored when the words the pin covered are all
  still inside the anchor. Every word the anchor covers now must also have
  been on the page at the baseline.
- **One new rule.** `claim-reanchored`, a notice, and `update` re-pins it
  without `--accept`. `claim-changed` keeps its name and its warning, and
  narrows to a claim whose words were edited.
- **Richer rows.** `claim-changed since 3f9c2a1, 2 commits`, the same spelling
  the source end uses. `--show-diff` prints the commits that touched the page
  and a diff of the claim's lines.
- **No new flag, key or field.** History is read whenever git is there, as for
  the source. `--show-diff`, `severity:` and `update` carry the rest.

Replayed against the dogfood merge, the design predicts the 92 rows split into
68 notices and 24 warnings. `update` clears the 68. The verification pass
makes that a fixture rather than a prediction.

## Decision

### 1. The baseline is the newest commit where the pin held

A claim's baseline is the commit its diff is taken from. Four places it could
come from were weighed.

| Option | What it is | Verdict |
|---|---|---|
| `claim.commit-sha` | A new field, `HEAD` at mint, as `source.commit-sha` is. | Rejected. See below. |
| Reuse `source.commit-sha` | The source's commit stands in for the page's. | Rejected. It names another repository under `--root`, and `update --accept` on the claim leaves it alone. |
| Blame the entry | The commit that last wrote the `claim.integrity` line, by `git blame`. | Rejected. A YAML reformat, `meta relocate` or a manifest move rewrites that line without touching the prose. |
| The newest commit where the pin held | Walk the page's commits, newest first, and hash. | **Chosen.** |

`claim.commit-sha` looks like the parallel choice, and it is wrong at birth in
the usual case. A writer edits the sentence, runs `add`, and commits both. At
mint, `HEAD` is the commit before the sentence existed. The page at that
commit does not hold the pin, so the field points at a commit that cannot
serve as a baseline. A squash merge then removes the feature-branch commit
from `main` entirely. The source end does not have this problem as often.
A source is usually cited as committed code, often in another checkout, where
no page history could help.

The chosen rule also says what a reader means by "since". It is the last
moment the page said what the pin recorded. A claim accepted by
`update --accept` two commits ago has that commit as its baseline, and not the
day it was first added.

**The walk.** Git lists the commits that touched the page, newest first. At
each commit, the page is read once per run, however many claims it holds.

1. `HEAD` first. When `HEAD` holds the pin and the working tree does not, the
   change is uncommitted. The baseline is `HEAD`, and the row says
   `uncommitted` where it would say a count.
2. When the page at a commit holds the pinned text, that commit is the
   baseline. The count is the commits that touched the page after it.
3. At each commit, the walk reads the manifest at the path the current config
   declares. A manifest that does not hold the pin string there, or is not
   there at all, is the entry's birth. The walk stops, and the claim has no
   baseline.
4. A page that does not hold the pin string is the entry's birth too, but the
   walk does not stop there. It records that it saw one and reads on.
5. When git has no parent to walk to, as in a shallow clone, the history is
   unavailable.
6. The walk stops after 256 commits that touched the page, and the history is
   unavailable.

A moved or renamed manifest therefore reads as "no baseline". That falls back
to today's `claim-changed` message, and never to a wrong verdict.

Step 4 is a correction, found by replaying the dogfood merge. The commits that
touched a page across a merge come from two lineages, and the entry's pins
only ever reached one of them. Stopping at the first page without the pin
therefore read a merge's other parent as the entry's birth. Git's default date
order made that worse by interleaving the two, so `--topo-order` is asked for
as well. The cap still bounds the walk. A walk that saw a page born without
the entry still says "no baseline" once it runs out of commits.

A page that was renamed is not followed. The page at its old path is not the
page at this path as git lists it, and following renames would guess. Before
the rename, the walk reads nothing, and step 3 ends it.

### 2. Finding the pinned text at a commit

The page at the baseline need not follow today's anchor rule. The a11y pins
were minted under the rule #43 replaced. So the search at an old commit is
rule-independent, and it only asks whether some span hashes to the pin.

- **A claim-lines entry.** Windows of the pinned width anywhere in that
  commit's body, the move search `claim-moved` already runs.
- **A marker-anchored entry.** Find the marker naming the entry's id in that
  commit's body. The window runs from the marker to the next blank line or
  fence. Try every span that starts on the marker's line, or on any non-blank,
  non-marker body line inside that window. Every span ends at or before the
  same boundary. That window is the add rule's own anchor window, so both
  limits are explicit.

A marker entry whose marker is absent at a commit is looked for no further
back. It was a claim-lines entry then, or it did not exist. That bounds the
search to spans a marker could have anchored under any rule it has had.

**The anchor is asked first, and the window only if no anchor held.** The walk
runs twice over the commits it read. The first pass asks the classifier
itself, `claimEnd`, which already knows today's anchor rule, the rule #43
replaced and 0054's joined unit. A commit where that says `current` or `moved`
is the baseline. Only where no commit says either does the second pass run the
window search above.

This ordering is a correction, found while implementing. The window search
alone takes too new a commit as the baseline. A sentence added beside a cited
one leaves the pinned sentence inside the widened anchor. The window search
then matches at `HEAD`, and `P0` holds the added sentence. Condition 2 passes,
and stress test 5's case reads reanchored. Asking the anchor first fixes that.
The baseline has to be the last moment the page *said* what the pin recorded.
A commit whose paragraph merely contained those words is not that moment.
The window search keeps its place as the fallback for a pin minted under an
anchor rule the tool no longer models.

### 3. The words test

With a baseline, `check` knows the text the pin covered then. It compares
three strings, each with the same normalization.

- **Strip markers.** Remove every line that holds only a cite marker, in any
  form the format allows, naming any id.
- **Collapse whitespace.** Every run of whitespace, line breaks included,
  becomes one space. Trim both ends.
- **Keep everything else.** Punctuation, emphasis and inline markup are words
  here. 0044 stress test 18 already holds that a comma is not whitespace.

The three strings are `W0`, the pinned text at the baseline. `W1` is the text
the anchor covers now. `P0` is the whole page body at the baseline.

The claim is **re-anchored** when both hold, compared at word boundaries.

1. `W0` occurs inside `W1`. Every word the pin covered is still in the claim,
   in order, unchanged.
2. `W1` occurs inside `P0`. Every word the claim covers now was already on the
   page, in that order, at the baseline.

Otherwise the claim is **changed**. The first condition catches a word edited,
removed or reordered inside the claim. The second catches a sentence added
beside it, or a marker now anchoring a different paragraph.

For a claim-lines entry, "the text the anchor covers now" has to be found.
It is the shortest run of whole body lines whose stripped text contains `W0`.
One run found is the reanchored case above. The verbatim search already found
the pinned text at no single place, which is why the claim read changed. The
normalized search may then find the claim's words at several runs. That state
reports `claim-moved-ambiguous`, and the reporter names the runs. None found
is `claim-changed`.

### 4. A rule of its own, not a switch on `--accept`

The question was whether telling a layout change from an edit belongs to
`check` or to `update --accept`. It belongs to `check`, as a rule.

| Option | Verdict |
|---|---|
| `update --accept` accepts only layout changes by default, and a second spelling accepts edits too. | Rejected. It is a switch for what the tool can detect, and it changes what `--accept` means today. |
| A qualifier on `claim-changed`, such as `"words": "unchanged"` in JSON. | Rejected. Severity is per rule, so both kinds stay warnings. GitHub annotations and SARIF cannot filter a qualifier. |
| `claim-changed` stays, and `update` quietly re-pins claims whose words match. | Rejected. `check` would report as work what `update` treats as none. |
| A second pin at mint over normalized text, `claim.words-integrity`. | Rejected. See stress test 4. |
| **A new rule, `claim-reanchored`, a notice, repaired by plain `update`.** | Chosen. |

The new rule follows the shape the claim end already has. `claim-moved` is a
notice because the text is found verbatim, and `update` rewrites it without
being told. `claim-reanchored` is a notice because the words are found
unchanged, and `update` re-pins it without being told. `--accept` keeps
meaning "a person read this and it still holds".

### 5. What `update` does

- **`claim-reanchored`, marker anchor.** `claim.integrity` is re-minted over
  the text the marker anchors now.
- **`claim-reanchored`, claim lines.** `claim.lines` becomes the run the words
  test found, and `claim.integrity` is re-minted over it.
- **`claim-changed`.** Skipped and reported, as today. With `--accept`,
  re-pinned as today. The report line gains the baseline. Section 7 records
  the one claim `--accept` refuses.

### 6. Without history

History is read whenever git is available, and never asked for. Where it is
not there, the claim end reads as it does today.

- **No git.** `claim-changed`, with no baseline. The run warns once.
- **A shallow clone.** `claim-changed (history unavailable; fetch-depth: 0)`,
  and one notice for the run.
- **No commit held the pin.** `claim-changed`, with today's message. This is
  a pin minted over text that was edited again before it was committed.

No claim reads `claim-reanchored` without a baseline. The words test needs
`W0`, and only history supplies it.

### 7. What `update --accept` refuses

Three decisions bound the re-pin.

- **The `reason` value keeps one spelling.** A rewrite row's `reason` stays
  `re-anchored`, proposal 0054's spelling, for both kinds of re-pin. `status`
  is what tells them apart. It reads `moved` where the pin held over another
  span, and `reanchored` where the words held. One word with two spellings in
  one enum would be worse than one value with two statuses.
- **A claim that shares no sentence with its baseline is refused.** With
  `--accept`, take the claim at its baseline and the text the stored first
  line holds now. Split both into sentences, normalize whitespace and case,
  and intersect. An empty intersection means the claim is skipped and
  reported, and the run exits 1. A word-overlap threshold was rejected,
  because a threshold is a number nobody can defend. With no baseline
  available, the accept behaves as it does today.
- **A re-pin over a wider unit still happens.** The report names both spans,
  as `claim lines 9 -> 9-12 re-pinned`. The widening is then in the log as
  well as in the diff.

## The interface

### The vocabulary

`manni:citations:1.0.0-proposal.4` is unchanged. The baseline is derived, so
there is no field to add. An entry before this proposal and after it is the
same YAML.

```yaml
# before and after: no change
citations:
  - id: fetch-timeout
    claim:
      lines: 3                      # body lines; required unless a marker names the entry
      integrity: sha256-c41f09aa…   # required inside claim
    source:
      file: lib/limits.ts           # required
      lines: 2                      # optional; absent pins the whole file
      integrity: sha256-78af1d33…   # required
      commit-sha: 3f9c2a1e7b0d4c5a6f8e9d0b1a2c3d4e5f607182   # optional
```

### Config

No key is added. `cite.severity` gains one rule name, `claim-reanchored`, and
takes the same levels.

Before:

```yaml
cite:
  severity:                         # optional mapping; rule name to level
    claim-moved: notice             # default notice
    claim-moved-ambiguous: warning  # default warning
    claim-changed: warning          # default warning
```

After:

```yaml
cite:
  severity:                         # optional mapping; rule name to level
    claim-moved: notice             # default notice
    claim-moved-ambiguous: warning  # default warning
    claim-reanchored: notice        # new; default notice; error | warning | notice | off
    claim-changed: warning          # default warning; now means the words were edited
```

| Key | Type | Default | Required | Meaning |
|---|---|---|---|---|
| `cite.severity.claim-reanchored` | `error \| warning \| notice \| off` | `notice` | no | How a claim whose words are unchanged since its baseline is reported. `off` drops the finding, and `update` still re-pins it. |

`severity:` takes sixteen rule names, where it took fifteen.

### Commands

No command, argument or option is added or removed. Two behave differently.

| Command | Option | Change |
|---|---|---|
| `check` | none | A `claim-changed` claim reads its history when git is available. It is reported `claim-changed` with a baseline, or `claim-reanchored`. |
| `check` | `--show-diff` | Under a `claim-changed` or `claim-reanchored` row, prints the commit subjects that touched the page since the baseline. Then a unified diff of the claim's lines, from the baseline to now. Replaces printing the current lines alone. |
| `update` | none | Re-pins a `claim-reanchored` claim, and rewrites its lines when it has lines. |
| `update` | `--accept` | Re-pins as today, except a claim that shares no sentence with its baseline, which it refuses. A re-pin over a wider unit names both spans. |

The option rows for `--show-diff` on the CLI reference change to this.

| Option | Argument | Default | Description |
|---|---|---|---|
| `--show-diff` | n/a | off | In `pretty` output, print the commit subjects and the diff since the baseline under each `source-changed`, `claim-changed` and `claim-reanchored` row. A source's baseline is its `commit-sha`. A claim's is the newest commit whose page held the pin. Both are capped at 60 lines, and the row says how many were left out. |

### Messages

A finding never moves the exit code by itself. Its severity does, and only
`error` does. The exit column is the default severity's.

| When | Output | Severity | Exit |
|---|---|---|---|
| Words edited, baseline found | `fetch-timeout: the claim at line 9 has changed since 3f9c2a1, 2 commits.` | warning | 0 |
| Words edited, change uncommitted | `fetch-timeout: the claim at line 9 has changed since 3f9c2a1, uncommitted.` | warning | 0 |
| Shallow clone, or walk cap reached | `fetch-timeout: the claim at line 9 has changed since it was pinned (history unavailable; fetch-depth: 0).` | warning | 0 |
| No git, or no commit held the pin | `fetch-timeout: the claim at line 9 has changed since it was pinned.` (unchanged) | warning | 0 |
| Words unchanged, marker anchor | `retries: the claim at lines 15-17 was reanchored since 3f9c2a1. Its words are unchanged.` | notice | 0 |
| Words unchanged, claim lines | `page-size: the claim at lines 21-22 was reanchored since 5d1e0b7, to lines 21-23. Its words are unchanged.` | notice | 0 |
| Words unchanged, several runs | `page-size: the claim at lines 21-22 now appears at lines 21-23 and 40-42.` (the `claim-moved-ambiguous` message) | warning | 0 |
| Any of the above, `severity: error` | the same message | error | 1 |

An entry without an id drops the `<id>: ` prefix, as today.

A reader would read `0 commits` as "just now", so the working-tree state names
itself instead. The pretty column for that case is
`:9 changed since 3f9c2a1, uncommitted`.

Run notices, on stderr and said once per run.

| When | stderr | Exit |
|---|---|---|
| A claim or a source wanted history and git is not available | `manni: git is not available here, so citations are checked without history: no never-true, no reanchored claims, no diffs, no commit subjects.` | unchanged |
| A claim's walk reached a shallow boundary or the 256-commit cap | `manni: the page history ends before the pin held; use fetch-depth: 0 to tell reanchored claims from changed ones` | unchanged |

The first replaces today's text, which leaves out reanchored claims. It is now
also said when a claim reads changed, not only when a source carries a commit.

`update` report lines, on stdout.

| When | stdout | Exit |
|---|---|---|
| A marker claim re-pinned | `docs/limits.md: retries claim at lines 15-17 re-pinned (reanchored; words unchanged since 3f9c2a1)` | 0 |
| A lines claim rewritten and re-pinned | `docs/limits.md: page-size claim lines 21-22 -> 21-23 re-pinned (reanchored; words unchanged since 5d1e0b7)` | 0 |
| A changed claim accepted | `docs/limits.md: fetch-timeout claim at line 9 re-pinned (changed; now "The fetch timeout is 30 seconds.")` (unchanged) | 0 |
| A changed claim skipped | `docs/limits.md: fetch-timeout  ↕ skipped: fetch-timeout: the claim at line 9 has changed since 3f9c2a1, 2 commits.` | 0 at warning, 1 at error |
| A changed claim `--accept` refused | ``docs/limits.md: fetch-timeout claim at line 9 skipped: that line now holds different text than the claim at 3f9c2a1. Re-add it with cite add.`` | 1 |
| A changed claim accepted over a wider unit | ``docs/limits.md: fetch-timeout claim lines 9 -> 9-12 re-pinned (changed; now "The fetch timeout is 30 seconds.")`` | 0 |

The `now "…"` quote covers the re-pinned lines only, capped at 200 characters
with `…`. A refused claim carries `reason: "replaced"` in the update JSON, on
a new `refused` list beside `rewritten`.

### Output shapes

**pretty.** The claim column carries the baseline, as the source column does.

```
⚠ docs/limits.md
    ↕ fetch-timeout   :9 changed since 3f9c2a1, 2 commits      lib/limits.ts:2 current
    ℹ retries         marker :14 reanchored since 3f9c2a1      lib/limits.ts:3 current
    ℹ page-size       :21-22 reanchored since 5d1e0b7 -> :21-23   lib/limits.ts:5 current

1 file checked, 1 passed, 0 failed, 3 findings (1 warning) (2 notices)
```

Under `--show-diff`, a claim row gains the page's commit subjects and the
claim's diff. The diff labels name the page at the baseline and the page now,
with file lines.

```
    ↕ fetch-timeout   :9 changed since 3f9c2a1, 2 commits      lib/limits.ts:2 current
        docs(limits): the timeout is thirty seconds
        docs: rewrap limits.md
        --- docs/limits.md@3f9c2a1:9
        +++ docs/limits.md:9
        -The fetch timeout is 10 seconds.
        +The fetch timeout is 30 seconds.
    ℹ retries         marker :14 reanchored since 3f9c2a1      lib/limits.ts:3 current
        docs(limits): hoist markers to paragraph starts
        --- docs/limits.md@3f9c2a1:17-18
        +++ docs/limits.md:15-17
        +Requests retry on a 5xx.
         A request is retried three times,
         then fails.
```

**json.** A claim end gains two members the source end already has, and one
value. `commitSha` is the baseline, as the full hash. `historyAvailable` is
`false` when the walk hit a shallow boundary or its cap. `status` may be
`reanchored`, and a reanchored claim-lines end carries `newLines`, as a moved
one does. The diff, the subjects and the text stay out.

```json
{
  "id": "page-size",
  "origin": { "kind": "frontmatter", "line": 14 },
  "anchor": "claim",
  "claim": {
    "lines": "15-16",
    "fileLines": "21-22",
    "status": "reanchored",
    "newLines": "15-17",
    "commitSha": "5d1e0b7c2a9f41e08b6d3a5c7e9f1b2d4a6c8e0f",
    "historyAvailable": true
  },
  "source": { "src": "lib/limits.ts:5", "status": "current" }
}
```

`findings[]` is unchanged in shape. A reanchored claim adds a finding with
`"rule": "claim-reanchored"`, `"ruleId": "manni:cite/claim-reanchored"` and
`"severity": "notice"`.

**github.**

```
::warning file=docs/limits.md,line=9,title=manni%3Acite/claim-changed::fetch-timeout: the claim at line 9 has changed since 3f9c2a1, 2 commits.
::notice file=docs/limits.md,line=15,title=manni%3Acite/claim-reanchored::retries: the claim at lines 15-17 was reanchored since 3f9c2a1. Its words are unchanged.
```

**sarif.** The driver's `rules` gain `manni:cite/claim-reanchored`. A result,
abridged:

```json
{
  "ruleId": "manni:cite/claim-reanchored",
  "level": "note",
  "message": { "text": "retries: the claim at lines 15-17 was reanchored since 3f9c2a1. Its words are unchanged." },
  "locations": [{ "physicalLocation": { "artifactLocation": { "uri": "docs/limits.md" }, "region": { "startLine": 15 } } }],
  "partialFingerprints": { "docmetaViolation/v1": "…" }
}
```

**junit.** At default severities neither claim rule is a `<failure>`, so a
page with both is a passing testcase. At `severity: {claim-changed: error}`, abridged:

```xml
<testcase name="docs/limits.md" classname="manni.cite">
  <failure type="manni:cite/claim-changed" message="fetch-timeout: the claim at line 9 has changed since 3f9c2a1, 2 commits. (line 9)"/>
</testcase>
```

**update json.** A rewrite's `status` gains `"reanchored"`, and its `reason`
reads `"re-anchored"` for a re-pin of either kind. For a reanchored claim,
`from` and `to` are the pins, and `commitSha` is the baseline. `at` is the
file line of the claim's first body line, the same thing the source end's `at`
names. It is that line whether a marker or the claim's own lines anchor the
claim. `fileLines` is where a claim-lines entry now sits.

```json
{
  "id": "page-size",
  "index": 2,
  "end": "claim",
  "reason": "re-anchored",
  "status": "reanchored",
  "from": "sha256-0b7e41d2…",
  "to": "sha256-9c41aa07…",
  "at": 21,
  "fileLines": "21-23",
  "commitSha": "5d1e0b7c2a9f41e08b6d3a5c7e9f1b2d4a6c8e0f"
}
```

### The ladder

Each rung is run from the root of a docs repository with full history.

**1. The bare minimum.** Two docs PRs landed, and one sentence was reworded.

```console
$ manni cite check docs/limits.md
⚠ docs/limits.md
    ↕ fetch-timeout   :9 changed since 3f9c2a1, 2 commits   lib/limits.ts:2 current

1 file checked, 1 passed, 0 failed, 1 finding (1 warning)
# exit 0
```

**2. The dogfood case, from config.** No paths, so every collection.

```console
$ manni cite check
ℹ docs/src/content/docs/a11y/ci/index.mdx
    ℹ progress-lines    marker :33 reanchored since 9d4cdd8   src/a11y/core/progress.ts:67-96 current
    ...
⚠ docs/src/content/docs/a11y/index.mdx
    ↕ anchor-links      marker :52 changed since 9d4cdd8, 1 commit   src/a11y/core/url.ts:19 current
    ℹ page-at-a-time    marker :41 reanchored since 9d4cdd8          src/a11y/core/crawl.ts:88-97 current
    ...

5 files checked, 5 passed, 0 failed, 92 findings (24 warnings) (68 notices)
# exit 0
```

**3. Clear the mechanical ones.**

```console
$ manni cite update
docs/src/content/docs/a11y/index.mdx: page-at-a-time claim at lines 42-45 re-pinned (reanchored; words unchanged since 9d4cdd8)
...
docs/src/content/docs/a11y/index.mdx: anchor-links  ↕ skipped: anchor-links: the claim at line 52 has changed since 9d4cdd8, 1 commit.
...
68 citations rewritten in 5 files, 24 skipped
# exit 0
```

**4. Read the rest.**

```console
$ manni cite check --show-diff docs/src/content/docs/a11y/index.mdx
⚠ docs/src/content/docs/a11y/index.mdx
    ↕ anchor-links   marker :52 changed since 9d4cdd8, 1 commit   src/a11y/core/url.ts:19 current
        docs(a11y): correct six claims the source contradicts
        --- docs/src/content/docs/a11y/index.mdx@9d4cdd8:53
        +++ docs/src/content/docs/a11y/index.mdx:53
        -Anchor links are skipped.
        +A link's fragment is dropped, and the link is checked as its page.
    ...
# exit 0
```

**5. Accept one, after reading it.** The paragraph was edited, and it still
says one of the things it said at the baseline, so the accept stands.

```console
$ manni cite update --accept --only fetch-timeout docs/limits.md
docs/limits.md: fetch-timeout claim lines 9 -> 9-12 re-pinned (changed; now "The fetch timeout is 30 seconds. It is not configurable.")
1 citation rewritten in 1 file, 0 skipped
# exit 0
```

**5b. The one it refuses.** `anchor-links` was not edited, it was replaced. Its
line now shares no sentence with what the claim said at `9d4cdd8`, so section 7
sends it back to `add`.

```console
$ manni cite update --accept --only anchor-links docs/src/content/docs/a11y/index.mdx
docs/src/content/docs/a11y/index.mdx: anchor-links claim at line 53 skipped: that line now holds different text than the claim at 9d4cdd8. Re-add it with cite add.
0 citations rewritten in 0 files, 1 skipped
# exit 1
```

**6. The CI form.** A shallow checkout, then a full one.

```console
$ manni cite check -f github                      # actions/checkout, depth 1
manni: the page history ends before the pin held; use fetch-depth: 0 to tell reanchored claims from changed ones
::warning file=docs/limits.md,line=9,title=manni%3Acite/claim-changed::fetch-timeout: the claim at line 9 has changed since it was pinned (history unavailable; fetch-depth: 0).
# exit 0

$ manni cite check -f github                      # fetch-depth: 0
::warning file=docs/limits.md,line=9,title=manni%3Acite/claim-changed::fetch-timeout: the claim at line 9 has changed since 3f9c2a1, 2 commits.
::notice file=docs/limits.md,line=15,title=manni%3Acite/claim-reanchored::retries: the claim at lines 15-17 was reanchored since 3f9c2a1. Its words are unchanged.
# exit 0
```

**7. A team that reviews every edit.** `severity: {claim-changed: error}` in
config.

```console
$ manni cite check -f junit > cite.xml; echo $?
1
```

**8. The scripting form.** What `update` would do, as data.

```console
$ manni cite update --dry-run -f json docs/limits.md | jq '.pages[0].rewritten[] | {id, reason, commitSha}'
{ "id": "retries", "reason": "re-anchored", "commitSha": "3f9c2a1e7b0d4c5a6f8e9d0b1a2c3d4e5f607182" }
{ "id": "page-size", "reason": "re-anchored", "commitSha": "5d1e0b7c2a9f41e08b6d3a5c7e9f1b2d4a6c8e0f" }
# exit 0
```

**9. The public docs job.** Claims are page-side, so their history runs with
the sources off.

```console
$ manni cite check --no-check-sources docs/limits.md
⚠ docs/limits.md
    ↕ fetch-timeout   :9 changed since 3f9c2a1, 2 commits   ~AQm4…:2 skipped
    ℹ retries         marker :14 reanchored since 3f9c2a1   ~AQm4…:3 skipped

1 file checked, 1 passed, 0 failed, 2 findings (1 warning) (1 notice)
# exit 0
```

**10. Every option at once.**

```console
$ MANNI_ENCRYPTION_KEY=$SECRET manni cite check --collection site --ext md,mdx \
    --exclude "**/drafts/**" -c manni.config.yaml --no-gitignore \
    --baseline .manni-cite-baseline.json --root ../code --show-diff --reveal -q
⚠ docs/limits.md
    ↕ fetch-timeout   :9 changed since 3f9c2a1, 2 commits   ~AQm4…:2 (lib/limits.ts) current
        docs(limits): the timeout is thirty seconds
        docs: rewrap limits.md
        --- docs/limits.md@3f9c2a1:9
        +++ docs/limits.md:9
        -The fetch timeout is 10 seconds.
        +The fetch timeout is 30 seconds.
    ℹ retries         marker :14 reanchored since 3f9c2a1   ~AQm4…:3 (lib/limits.ts) current
        docs(limits): hoist markers to paragraph starts
        --- docs/limits.md@3f9c2a1:17-18
        +++ docs/limits.md:15-17
        +Requests retry on a 5xx.
         A request is retried three times,
         then fails.

1 file checked, 1 passed, 0 failed, 2 findings (1 warning) (1 notice)
# exit 0
```

### The usage errors

No flag is added, so no usage error is new. Two config errors gain the new
rule name, and they are shown in full.

| Invocation | stderr | Exit |
|---|---|---|
| `severity: {claim-re-anchored: notice}` | `manni: Unknown key "claim-re-anchored" under cite.severity: in manni.config.yaml. Supported keys: source-moved, source-moved-ambiguous, source-changed, source-never-true, source-missing, claim-moved, claim-moved-ambiguous, claim-reanchored, claim-changed, marker-orphan, marker-invalid, marker-repeated, marker-misplaced, anchor-invalid, entry-invalid, quote-drift.` | 2 |
| `severity: {claim-reanchored: quiet}` | `manni: cite.severity.claim-reanchored in manni.config.yaml must be one of error, warning, notice, off, not "quiet".` | 2 |
| `update --no-check-sources` | ``manni: update needs the sources: drop --no-check-sources (or `checkSources: false`).`` (unchanged) | 2 |
| `check -` with no `--as` | ``manni: Reading from stdin (`-`) requires --as <format> to choose an extractor.`` (unchanged) | 2 |

A page read from stdin has no history, because it has no path in the
repository. Its claims read as today, with no baseline and no notice.

### The programmatic API

`src/index.ts` is unchanged. The `cite` namespace it re-exports changes as
follows.

| Export | Kind | Change |
|---|---|---|
| `CITE_RULES` | const | Gains `"claim-reanchored"`, after `"claim-moved-ambiguous"`. |
| `CiteRule` | type | Gains `"claim-reanchored"`. |
| `DEFAULT_SEVERITY` | const | Gains `"claim-reanchored": "notice"`. |
| `ClaimStatus` | type | Gains `"reanchored"`. |
| `ClaimEnd` | interface | Gains `commitSha`, `historyAvailable`, and the pretty-only `commitsSince` and `diff`, as `SourceEnd` has them. |
| `UpdateRewrite` | interface | `status` gains `"reanchored"` and `reason` gains `"re-anchored"`. Gains `fileLines`. `commitSha` also carries a claim's baseline. |
| `GitClient` | interface | Gains an optional `pageCommits(path, cap)`, answering `{ commits: { sha, subject }[], shallow: boolean, truncated: boolean }`, newest first. A client without it reads no claim history. |
| `PageCommit`, `PageHistory` | type | New. One commit, and the answer `pageCommits` gives. `truncated` is a list the cap cut short, which the walk cannot read as a history that ended. |
| `claimHistory` | function | New. `claimHistory(input: ClaimHistoryInput): Promise<ClaimHistory>`. Finds a changed claim's baseline in the page's history. |
| `refineClaim` | function | New. `refineClaim(input: RefineClaimInput): ClaimEnd`. Applies the words test to a claim end and the history it was read against. |
| `ClaimHistoryInput` | type | New. Carries the page, the entry, the classified claim end, the page's path, its manifest, a `GitClient` and an optional commit cap. |
| `RefineClaimInput` | type | New. `ClaimHistoryInput` without the client, plus the page's lines now and the `ClaimHistory`. |
| `ClaimHistory` | type | New. `{ kind: "unavailable" } \| { kind: "none" } \| { kind: "baseline"; commit: string; commitsSince: string[]; words: string; pageWords: string; lines: string[]; at: string }`. |
| `MAX_PAGE_COMMITS` | const | New. The walk's cap, `256`. |
| `claimWords`, `holdsWords`, `runsHolding`, `stripMarkers` | function | New. The words test's four steps, each testable on its own. |
| `sentencesOf`, `sharesSentence` | function | New. The sentence intersection `update --accept` refuses on. |
| `claimDiff` | function | New. The claim's unified diff, from the baseline to now, with file-line labels. |
| `CheckOptions`, `CheckPageOptions` | interface | Gain `pageGitClient`, the client the page's own history is read through. `CheckPageOptions` also gains `pageRoot` and `pageCommitCap`. |
| `PAGE_HISTORY_UNAVAILABLE` | const | New text, given in the messages table above. |
| `UpdatePage` | interface | Gains `refused`, the claims `--accept` would not re-pin. |
| `refusalLine` | function | New. What one refused claim's report line says. |
| `claimEnd` | function | Unchanged. It still classifies against the page as it is now. |
| `GIT_UNAVAILABLE_HISTORY` | const | New text, given in the messages table above. |

## Stress test

What was tried against this design, and what each attempt changed.

### 1. The 92 rows, replayed on paper

The dogfood merge was walked through the rules. Two kinds of re-anchor made up
the 68. The first was a marker hoisted from mid-paragraph to its top. The old
pin covered the second half of a paragraph, and the anchor now covers all of
it. `W0` sits inside `W1`, and the first half was on the page already, so the
claim is reanchored. The second was a stacked marker. The old pin included a
sibling marker line that #43 stopped counting, and stripping marker lines
makes `W0` and `W1` equal.

The 24 rewrites each changed a word inside a pinned paragraph. `W0` is no
longer inside `W1`, so each stays `claim-changed`.

**Changed as a result:** the first draft compared `W0` and `W1` for equality
only. That called every hoisted marker changed. Containment
replaced equality, and condition 2 was added to keep it safe.

### 2. A marker left above a different paragraph

Delete a cited paragraph and its marker stays behind. The marker now anchors
the next paragraph, which was already on the page. Condition 2 alone would
call that reanchored, because every word of it existed at the baseline. Plain
`update` would then re-pin a claim to a sentence nobody cited.

**Changed as a result:** condition 1 is required too. The deleted paragraph's
words are not inside the new anchor, so it is `claim-changed`. The ladder
fixture holds this case, and it is the one this proposal most needs to get
right.

### 3. `claim.commit-sha` was the first draft

It mirrored the source end exactly, and the plan was one field and one lookup.
Three failures killed it. `HEAD` at mint predates the sentence in the usual
edit-then-cite-then-commit flow. A squash merge removes the recorded commit
from `main`. And `update --accept` would have to re-record it, which is a
second write for one act.

**Changed as a result:** the baseline is derived. The schema is untouched, and
proposal 0023's principle 4 is kept, that a derivable fact lies when stored.
The source end keeps `commit-sha`, because a source may live in another
checkout, where no page history can find it.

### 4. A second pin over normalized text

`claim.words-integrity` at mint would hash the stripped, collapsed text. Then
`check` could tell a layout change from an edit with no git at all, even in a
shallow clone. It was a serious alternative.

**Changed as a result:** rejected, for three reasons. It only proves equality,
so it cannot see a hoisted marker whose anchor widened. It still
cannot say since when or show a diff, so history is needed anyway. And it is
two pins over one range, which 0044 stress test 1 rejected for the source. The
existing 300 pins would also carry nothing until re-minted.

### 5. A sentence added beside the cited one

A writer adds "This applies to HTTPS only." to the pinned paragraph. `W0` is
still inside `W1`. A check on condition 1 alone would call that reanchored, and
`update` would bless a qualification of the claim without anyone reading it.

**Changed as a result:** condition 2 catches it. The added sentence is not in
`P0`, so the claim is `claim-changed`. This is what 0044 meant by "a typo fix
beside the cited sentence" being a warning, and that meaning is kept.

Implementing this found a second thing. Condition 2 only holds if `P0` is the
page before the sentence was added, and the window search of section 2 made
`HEAD` the baseline instead. The fix is the two-pass walk recorded there. The
test for this case is in `test/cite/history.test.ts`, and it failed before that
change, which is how the hole came to light.

### 6. Output never says more than the page did

`--show-diff` now prints page text from an older commit. That text is not on
the page today. It was on the page at the baseline, in the same repository's
history, and `check` reads nothing that `git log -p` on the page would not.

The rule's two edges were checked. Only the claim's span is printed, never
the rest of the page's history. The diff, the subjects and the old text reach
`pretty` alone, under `--show-diff`, as the source's do. `json`, `github`,
`sarif` and `junit` carry the baseline hash and the commit count, which the
page's own history already publishes. Nothing about an encrypted source moves.

**Changed as a result:** the sentinel test gains a claim whose old text holds
a known string, removed in a later commit. Every machine format is asserted
free of it.

### 7. A baselined `claim-changed` that becomes `claim-reanchored`

A repository recorded its 92 warnings with `--write-baseline`. After upgrade,
68 rows carry a different rule, and the fingerprint includes the rule. So 68
baselined findings go stale, and 68 new notices appear.

**Changed as a result:** nothing. A notice never fails a run, so the ratchet
still passes. The stale entries are what `--write-baseline` exists to clear.
The CI page says so, once, beside the upgrade note.

### 8. A shallow clone that looks deep enough

`actions/checkout` at depth 1 has `HEAD` and nothing else. If the claim was
edited in `HEAD`, the walk reads `HEAD`, finds no pin, and has no parent. The
first draft read that as "no commit held the pin" and printed today's message.
That hides the fact that history would have answered.

**Changed as a result:** a missing parent at a shallow boundary is
`historyAvailable: false`, with the `fetch-depth: 0` notice. Only a walk that
reaches the entry's birth says no commit held the pin. D5 already tells Devin
to set `fetch-depth: 0` for the source end, so the advice is one setting.

### 9. A page with a thousand commits

The walk is bounded twice. It stops at the entry's birth, and it stops at 256
commits that touched the page. A page is read once per commit per run, however
many claims it holds.

**Changed as a result:** the cap was added, with a notice when it is reached.
The walk runs only for a claim that is not current and not moved, so a clean
corpus costs no git at all.

### 10. `update --accept` over everything, after this lands

Maya's first instinct was to accept all 92. With this proposal, `update` alone
clears 68, and `--accept` without `--only` still re-pins the 24. The design
could refuse `--accept` without `--only` when claims changed.

**Changed as a result:** nothing, and decision 3 below records that. Refusing
would break the documented `update --accept --dry-run -f json docs/` form. The
report line now names each baseline, so a blanket accept is at least legible.
Section 7 above records what `--accept` does refuse.

### 11. Whitespace inside a code span

Collapsing whitespace would make `` `a  b` `` equal to `` `a b` ``. Inside a
fenced block, where `quote: true` pins source code, that is a real change.

**Changed as a result:** a `quote: true` claim never reads reanchored. Its
words test is equality on the lines as the hashing rule reads them, with only
marker lines stripped. An inline code span in prose is still collapsed, and
that is accepted.

## Verification

```bash
npx vitest run test/cite                      # the words test, the walk, and each message
node dist/cli.js cite check --root test/fixtures/cite test/fixtures/cite/pages/claim-reanchored.md   # exit 0, one notice
node dist/cli.js cite check --root test/fixtures/cite test/fixtures/cite/pages/claim-reworded.md     # exit 0, one warning with a baseline
node dist/cli.js cite check                    # the repo's own config; exit 0
node dist/cli.js meta validate                 # the dogfood gate; exit 0
```

The fixtures need history, so each is a temporary repository built by
`test/helpers/temp-repo.ts`. The a11y replay is a fixture of its own. It holds
the pages at `9d4cdd8` and after the merges, and asserts 68 notices and 24
warnings. Until that fixture passes, the split in the Summary is a prediction.

## Not breaking

Additive in the interface. No flag, key or schema field is removed or renamed.
A config that sets the fifteen existing rules still loads.

Four things change behaviour, and each is a `feat(cite):`.

- A `claim-changed` warning can become a `claim-reanchored` notice. A job that
  failed on `claim-changed` at `error` fails on fewer claims, never more.
- A baseline recorded before the upgrade goes stale for those claims, as
  stress test 7 says.
- `update --accept` refuses a claim that shares no sentence with its baseline,
  and exits 1 where it exited 0. Section 7 records why.
- `GitClient` gains an optional member, so a hand-written client still
  compiles. A `switch` over `ClaimStatus` or `CiteRule` that is exhaustive
  gains a case, which TypeScript reports.

One `feat:` commit, so one demo video. It shows the 92-row check, `update`
clearing 68, and `--show-diff` on one of the 24.

## Consequences

- `docs/src/content/docs/cite/reference/citations.mdx` gains a
  `claim-reanchored` row and the words test. The fix page gains a section,
  and T2 gains one sentence.
- `docs/src/content/docs/cite/reference/cli.mdx` changes the `--show-diff`
  row as shown above.
- 0044's Status line gains "superseded in part by 0053" when this is
  implemented, and nothing else in 0044 changes.
- The dogfood log's B9 and B11 are answered by this. B11's legacy
  mid-paragraph markers still need hoisting by hand, and then plain `update`
  finishes the job.

The review's decisions, in the order they were debated.

1. **A widened anchor counts as reanchored.** Condition 1 lets the anchor now
   cover words the old pin did not. Condition 2 guards it, because those words
   were on the page at the baseline. Equality alone would leave every hoisted
   marker a warning.
2. **The cap stays at 256 commits, with no config key.** It bounds a page with
   a long history, and a key would be one more dial to explain. The notice
   steers a shallow checkout to `fetch-depth: 0`.
3. **`update --accept` without `--only` is not refused.** Refusing would break
   the documented `--accept --dry-run -f json` form. The report now names each
   baseline, so a blanket accept is legible.
4. **The walk does not follow a renamed page.** `git log --follow` is
   heuristic, and it costs a call per page. A silently wrong baseline is worse
   than a correct "no baseline".
5. **`reanchored` keeps its name.** The rule name names the common cause. A
   rewrapped paragraph with no marker in sight is also reanchored here. The
   reference page's description carries that nuance.
