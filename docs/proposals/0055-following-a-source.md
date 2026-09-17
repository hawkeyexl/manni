# 0055: following a source across files, and inside a changed range

- **Status:** Proposed
- **Serves:** Three journeys, all of them citation journeys.
  - Maya · M5, "Pin a claim and catch it going stale". A pure code move
    currently reads as drift in her prose, and she re-adds the citation by
    hand.
  - Devin · D5, "Gate citations in CI without blocking on prose". A refactor
    that renamed a file turns every page citing it red, on a change that
    altered nothing any page said.
  - Theo · T2, "Read a citation failure and fix it". His annotation says the
    source changed and does not say where the source went.
- **Depends on:** Four earlier proposals.
  - [0044](0044-citations-and-drift.md) is the pin, the two ends, the statuses
    and the two search regimes this proposal extends.
  - [0045](0045-family-encryption-key.md) is the family key, the `cite-src`
    encryption context and the keyed pin an encrypted source carries.
  - [0041](0041-collections.md) is the `collections:` list a bare run reads,
    and the sidecar manifest an entry may live in.
  - [0034](0034-command-grammar.md) is the grammar, and the rule that a tool
    detects what it can detect rather than taking a flag for it.
- **Supersedes, in part:** [0044](0044-citations-and-drift.md) stress test 15,
  which rejected following a renamed file and fixed the move search to one
  file. 0044 keeps its text, including that stress test. Its `Status:` line
  gains "superseded in part by 0055" when this proposal is accepted, and
  nothing else in it changes.
- **Relates to:** [0001](0001-validation-baseline.md), the ratchet a changed
  severity ramps in on. The two open proposals on the same tool, 0053 on claim
  history and 0054 on re-anchoring markers, neither of which this one needs.
- **Touches:** `src/cite/core/{classify,git,sources,check-page,adapt,spell}.ts`,
  `src/cite/core/write.ts`, `src/cite/commands/update.ts`, `src/shared/pin.ts`,
  `src/cite/reporters/pretty.ts`,
  `docs/src/content/docs/cite/reference/{citations,cli}.mdx`,
  `docs/src/content/docs/cite/fix/**`, `test/cite/**`,
  `test/fixtures/cite/**`
- **Verdict:** Extend the move search in two directions, and add no rule, no
  flag and no config key. When a pin holds nowhere in its own file and git can
  show the recorded commit, search the files committed history changed since
  that commit. One hit is `source-moved` with a new path, several are
  `source-moved-ambiguous`, and `update` rewrites `source.file` beside
  `source.lines`. When a source did change, look for the old first and last
  lines in the file as it stands. When each sits once and in order, the status
  stays `source-changed` and the finding carries the span they cover, which is
  what `update --accept` re-mints at. An encrypted source follows its text, and
  its new path is written encrypted. A rename stops being `source-missing`.

## Problem

Maya pins a sentence to the lines it rests on, which is M5. Devin gates those
pins in CI, which is D5. Theo reads the annotation that turned his pull request
red, which is T2. What each of them does today, when a refactor moves the code,
is read a diff to work out where the code went. Then Maya re-adds the citation
by hand, which drops the commit the pin was minted at. Theo's page has no
citation of its own to read, and his red check stays red until someone else
does that.

`manni cite` now runs against 1,941 citations in this repository, and the
dogfooding pass turned up one shape of failure twice. Both times the tool was
right that the pin no longer held. Both times it withheld the one fact the
reader needed, which is where the pinned lines are now.

**A file gained a new home, and the finding read as drift.** Pull request #49
moved `sourceIndexFor` out of `src/cite/commands/check.ts` and into
`src/cite/core/sources.ts`, byte for byte. The reference page citing that
function reported `source-changed`, an error, exit 1. `--show-diff` printed a
deletion and nothing else, because nothing else happened in that file. The
reviewer found the function's new home by reading an import line. Then the
remedy was `manni cite add`, which mints a new entry and drops the recorded
commit of the old one.

**A guard landed inside a pinned range, and the repair re-pinned the wrong
lines.** Pull request #56 inserted an eight-line guard inside `readPage` in
`src/cite/core/page.ts`. The pinned code sat intact three lines lower. The
finding was `source-changed` with no range, so the reviewer read the diff to
work out that the cited lines had not been edited at all. `update --accept`
then re-minted `source.integrity` over the recorded `source.lines`, which now
cover the guard plus the first part of the old code. The pin holds again and
names a range the sentence does not rest on. That is worse than the red check
it cleared.

Both cases are the same gap. The tool asks one question of one file. The answer
to "did these lines move" often sits elsewhere, at another path or at another
offset. 0044 saw the first half of this and closed it deliberately:

> `git mv lib/limits.ts lib/config/limits.ts` leaves every pin pointing at a
> path that no longer exists. Following renames through git history is
> possible, costs a `git log --follow` per citation, and guesses.
>
> **Changed as a result:** a rename is `missing`, an error, and `add` is the
> remedy. The move search is within one file only. This is the honest answer: a
> pin names a path, and the path is gone.

The cost objection was about rename history, and it still holds. A
`git log --follow` per citation is a history walk per pin. Git's rename
detection is a similarity score, so a renamed and edited file is a guess. This
proposal never reads rename history. It asks the hash instead. The candidate
files come from one `git diff --name-only` per commit, and a window either
hashes to the pin or it does not. Nothing is scored and nothing is guessed.

The last sentence of that verdict is the part that turned out to be wrong. A
pin names a path **and** a hash, and the hash is the half that identifies the
lines. When the hash still holds somewhere a commit touched, the path is the
stale half of the record. Rewriting a stale path is what `update` is for.

## Summary

- **Across files.** A pin that holds nowhere in its file is searched for in the
  files committed history changed since the pin's commit. The candidate list is
  `git diff --name-only <commit> HEAD`, intersected with the run's tracked-file
  index. One hit is `source-moved` with a path in it, several are
  `source-moved-ambiguous`. Both rules already exist, at their current
  severities.
- **Inside a range.** A `source-changed` end whose original text git can show
  gains a span. It covers where the old first and last lines now sit, when each
  sits exactly once and in order. The status stays `source-changed`, because the content did
  change. `update --accept` re-mints at the span rather than at the stale range.
- **An encrypted source** follows its text, because the keyed pin covers the
  text and never the path. The new path is written encrypted in the `cite-src`
  context. Output spells it as a ciphertext prefix, and `--reveal` stays the
  only way to read the path.
- **`source-missing` narrows.** A path that is gone whose content moved is
  `source-moved`, a warning. A path that is gone and whose content is nowhere a
  commit touched is still `source-missing`, an error.
- **No new surface.** No rule, no flag, no config key, no JSON field. Three
  messages carry something they could not carry before, `update` gains two
  report lines it already spells, and the git client gains one memoized call.

## Decision

### 1. Where the new work sits in the ladder

`classifyCitation` today settles a source end in five steps. An unresolvable
path returns `source-missing` at step 1, and the move search at step 4 covers
one file. Two steps are added, and one return is deferred:

| Step | Today | With this proposal |
|---|---|---|
| 1 | The path does not resolve, so `missing`, and return. | The reason is recorded, and the verdict waits for step 5. |
| 2 | The pinned range hashes to the pin, so `current`. | Unchanged. |
| 3 | With a commit and git, read history for the original text. | Unchanged. |
| 4 | Search the rest of the file for a window that hashes to the pin. | Unchanged. |
| 5 | Settle `never-true` or `changed`. | The cross-file search runs first (both branches), then the in-range search (a resolved path only), then this. |

A path that does not resolve skips steps 2 and 4, since there is no file to
hash or to search. Step 3 still runs, because `git show` reads the file at the
recorded commit rather than from disk. That is what makes a rename answerable
at all. The in-range search is skipped too, for the same reason: it looks at a
file that is not there.

Two preconditions gate every bit of the new work, and they are the same two:
git is available, and `git show <commit>:./<path>` produced the original text.
So the entry records a `source.commit-sha`, and the commit is in history. With
either missing, an end is classified exactly as it is today. The existing run
notices already say why, and this proposal adds none:

```
git is not available here, so citations are checked without history: no never-true, no diffs, no commit subjects.
commit 9121f1f not found in history; use fetch-depth: 0 to enable never-true and diffs
```

The original text is what both searches need. The cross-file search needs it
for the first-line filter, and the in-range search needs its first and last
lines. A blind cross-file search over every candidate file is the thing this
design refuses, and stress test 9 records the size of it.

### 2. Across files

**The candidate list.** One new call on the git client of `src/cite/core/git.ts`,
memoized per commit beside the six already there:

```ts
changedSince: ["diff", "--name-only", "--end-of-options", commit, "HEAD"]
```

`HEAD` is written out on purpose. `git diff --name-only <commit>` with no
second revision compares the commit to the working tree, and this list is
**committed changes only**. A move that is staged or merely saved is not
followed, so `update` cannot rewrite `source.file` to a path the next commit
may not carry. A run in CI and a run on a colleague's dirty tree then agree on
the candidate list.

The list is then narrowed three ways, all of them already in the tool:

1. The entry's own file is dropped, because step 4 searched it.
2. Every path the tracked-file index does not hold is dropped. That index is
   `git ls-files` under a realpath containment check. So a symlink out of the
   root and an untracked file are both out, exactly as they are for a cited
   path today.
3. A path that no longer exists on disk is dropped, since the diff names
   deletions too.

Candidates are visited in the order git prints them, which is sorted by path.
So a search that stops early stops at the same place twice.

**There is no fallback to the whole index.** A diff that names nothing, or
whose named files hold no window, ends the search. The tracked-file list is not
searched in its place. A pin whose commit predates a repository import is the
case that tempts one. It fails the preconditions anyway, since git cannot show
that commit. Searching every tracked file would also mean searching blind,
without the first-line filter, which is the cost stress test 9 declined to
bound.

**What is compared.** The candidate list comes from committed history, and the
bytes come from the working tree, as every other source read does. Each
candidate is read once, normalized and split under the hashing rule of 0044,
and handed to `findWindows` from `src/shared/pin.ts` with the original lines
set:

```ts
findWindows(lines, length, source.integrity, key, { original })
```

`original` enables the **first-line filter**. A start line whose text differs
from the pinned range's old first line is skipped without a hash. A start line
that matches is compared line by line, and only a full lexical match is hashed.
A candidate file with no line equal to that first line therefore costs one read
and zero hashes.

A whole-file pin joins this search, with the whole candidate file as the
window. 0044 stress test 4 stands as written: a whole-file pin has nowhere to
move to **inside** its file, and it never reports `moved` there. It can move to
another path, and a `git mv` with no edit is the case the pin settles outright.

**The budget.** `MOVE_BUDGET_BYTES` is 64 MiB, in `src/shared/pin.ts`, and it
is **one counter per citation**, spent in ladder order by every search that
classifies that end. It is not one budget per search. So 64 MiB is the whole
cost of settling one citation, whichever search does the reading. The cap on a
run is that, times the citations whose pins do not hold. There is no separate
file count and no timeout.

Two searches can spend it, and they count different units.
`findWindows` spends it on its blind path, where the unit is the bytes of each
window it hashes. The cross-file search accounts its own bytes, where the unit
is the bytes of each candidate file it reads. Its call into `findWindows`
passes `original`, which takes the filtered path and hashes almost nothing, so
it spends nothing there.

**What the reader should expect when the first search spends it all.** The
counter is what is left, so the cross-file search never starts, and the in-range
search never runs either. The end keeps the verdict it would have had without
any of this work. That is `source-changed` for a file that is there, and
`source-missing` for a path that is gone. `truncatedSearch` is set and the run
says so once. The citation is not reported as `moved` on partial evidence, and
the notice is what says the evidence was partial.

That contention is narrow, because the blind path and the cross-file search
have nearly opposite preconditions. A blind `findWindows` runs when the
original text is unknown, and the cross-file search needs it known. The one
overlap is `historyOf`'s own blind scan over the file as it was at the commit.
It runs when the recorded lines there do not hash to the pin. That scan can
spend the counter and still end up knowing the original text.

**The notice** takes one of two forms, because "the file" is the wrong noun for
a scan across candidate files. The first is today's, unchanged, for a search
that ran out inside one file. The second is new, for one that ran out across
the files a commit touched:

```
a move search hit its 64 MiB budget before covering the file; a citation may read changed rather than moved
a move search hit its 64 MiB budget before covering the files changed since the pin's commit; a citation may read changed or missing rather than moved
```

A run raises each form at most once, and raises both when it hit both. Which
form a truncation takes is decided where the search stopped, and it is not
recorded on the citation. `truncatedSearch` stays the boolean it is today in
`json`, so no output field is added.

**The verdicts.** Exactly one start line across all candidates is
`source-moved`, a warning, with `newSrc` naming the new path and range.
Two or more are `source-moved-ambiguous`, an error, listing the candidates with
their paths. Neither rule is new, and neither changes severity. A move wins
over `changed`, `never-true` and `missing` alike. That is the rule 0044 already
applies inside one file. A pin whose bytes sit somewhere a commit touched
moved, whatever else is true of its old range.

**A cross-file move stays a warning**, at 0044's severity for
`source-moved`. The case for an error is that `source.file` is the one field a
reader of the page can check by eye. Four things answer it. The pin holds byte
for byte, so the evidence the sentence rests on is intact, and only the path
is stale. `update` repairs it with no judgement to make, which is what a
warning with a one-command fix is for. A team that wants sign-off on a path
rewrite sets `severity: { source-moved: error }`, which is the documented
path. And an error by default would block CI on any rename in a cited
repository, until someone ran `update`. That is the D5 journey this proposal
serves.

### 3. Inside a changed range

A source end that reaches step 5 as `changed` has an original text, and the
question left is which lines the old range now covers. The search for it is the
narrowest one that answers the two dogfood cases:

- Take the original range's first line and its last line, as text.
- Find each in the **working-tree** file, read from disk as decision 2 reads a
  candidate.
- Each must occur **exactly once**, the last must sit at or after the first,
  and the span must be no wider than `MAX_RANGE_LINES`, 5,000 lines.

With all four holding, the finding carries that span. Anything else, including
a first line that occurs twice or a span 5,001 lines wide, leaves the finding
as it is today. A one-line pin is covered, since its first and last lines are
the same line, and its span is then that one line.

The status stays `source-changed`, an error. The content between those lines
did change, and calling it anything softer would be a lie about the pin. What
the span buys is the next two actions. The finding names it, `--show-diff`
diffs it rather than the stale range, and `update --accept` re-mints there.

This search costs no git call. History supplies the two lines it looks for, and
the working tree supplies the file it looks in. The old text is the one
`git show` already fetched for step 3, memoized per commit and path, so nothing
is read from history twice.

**No span on `source-never-true`.** A never-true end has no canonical first and
last line to look for. The pin did not hold at the recorded commit, so the
lines git can show there are not the lines the citation was minted over.
Bracketing by them would search for text the pin never covered.

### 4. An encrypted source

A keyed pin is an HMAC over the **text** of the cited lines, under a subkey of
the family key. It covers nothing about the path. So an encrypted source moves
on exactly the terms a plain one does, and the same pin recognizes it at its
new path. Three rules make that safe.

**The new path is written encrypted.** `update` writes `source.file` as a
`cite-src` ciphertext under the current key, in the family's one token format.
Encryption is deterministic. The page that cited the file under its old
ciphertext cites it under one new ciphertext. A second page citing that new
path writes the same value. That is the accepted residue 0044 recorded, and
this proposal neither widens nor closes it.

**The form never changes.** An encrypted entry stays encrypted and a plain
entry stays plain, whatever key the run holds. `update` rewriting a path is not
an occasion to encrypt one that was public, or to publish one that was not.

**Output never names a decrypted path.** `newSrc` carries the ciphertext, not
the path, so every reporter spells a moved encrypted source as the page spells
it. The pretty row reads `moved -> ~AQ9f…:4`. `messageFor` in
`src/cite/core/adapt.ts` spells `newSrc` through `shortSrc`, which abbreviates
a `~` token to five characters and leaves a plain path whole. So the same
message reads `moved -> lib/config/limits.ts:4` for a public source, and the
JSON, GitHub, SARIF and JUnit renderings carry the ciphertext. `--reveal`
stays the only way to see the path, in pretty output only, as
`~AQ9f…:4 (lib/config/limits.ts)`. 0044's sentinel test gains a moved
encrypted source. So a run that decrypted a private path, then followed it
across a rename, is proven not to print it.

Without a key nothing changes. The end is
`missing (no encryption key is available to decrypt it)`, and no search runs,
because there is no path to search from.

### 5. What `source-missing` still means

A path that is gone is now asked one more question before it is called missing.

| The path is gone, and | Status | Severity | Exit |
|---|---|---|---|
| the pin holds in exactly one file a commit touched | `source-moved` | warning | 0 |
| the pin holds in several of them | `source-moved-ambiguous` | error | 1 |
| the pin holds in none of them | `source-missing` | error | 1 |
| git cannot show the commit, or the entry records none | `source-missing` | error | 1 |
| the content moved into an **untracked** file | `source-missing` | error | 1 |
| the content moved, and the budget ran out first | `source-missing` | error | 1 |

The budget row carries the rest of decision 2 with it. `truncatedSearch` is
set, and the run raises the cross-file form of the notice once.

The untracked row is the honest limit, and it matches what `add` already
refuses. Sources resolve through `git ls-files` under a realpath containment
check. So an untracked destination is not a file this tool reads. That holds
whether a pin reached it or someone typed it. The message says the same thing
it says today, `missing`, and the remedy is to commit the file or to re-add
the citation.

A destination whose path the operator keeps private is a different case and
needs nothing new. The entry's own form decides how the path is written, per
decision 4. An encrypted entry that follows its text into another private file
stays encrypted. A plain entry's destination is a tracked file under the same
root its plain path came from. Following it publishes no path the repository
does not publish.

`source-missing` keeps its severity and its message. What changes is how often
it is reached, and 0044's sentence about it stays true of every row above that
says `missing`.

### 6. What `update` writes

`update` gains one field and one range to splice, and no flag.

| End and status | Without `--accept` | With `--accept` |
|---|---|---|
| `source-moved`, same file | `source.lines` rewritten. | The same. |
| `source-moved`, new path | `source.file` **and** `source.lines` rewritten. `commit-sha` is left alone (the pin was minted at that commit and still holds, so `HEAD` would record a mint that never happened). | The same. |
| `source-moved`, new path, whole-file pin | `source.file` rewritten; the entry has no `lines`. | The same. |
| `source-changed` with a span | Skipped, and reported. | `source.integrity` re-minted **at the span**, `source.lines` rewritten to it, and `commit-sha` set to `HEAD` where the entry has one. |
| `source-changed` with no span | Skipped, and reported. | Re-minted at the recorded range, as today. |
| `source-moved-ambiguous` | Skipped. | The same. |
| `source-missing` | Skipped. | The same. |

The splice stays textual, so comments and quoting in the frontmatter survive,
and an entry in a sidecar manifest is spliced there. `commit-sha` is untouched
by a move, because the pin was minted at that commit and still holds. The
existing history search already handles a moved `src` under an old commit.

## The interface

### Config

No key changes, and no key is added. The `cite:` section keeps its six keys and
their defaults, and `severity:` keeps its fourteen rule names. This repository's
own config file is unchanged, before and after:

```yaml title="manni.config.yaml (before and after, abridged)"
collections:
  - name: site
    paths:
      - "docs/src/content/docs/**/*.{md,mdx}"
    url: http://127.0.0.1:4321/manni/

tools:
  vale:
    config: .vale.ini

meta:
  overrides:
    - collection: site
      schemas:
        - ./docs/doc-frontmatter.schema.json
        - astro:starlight:0.41

a11y:
  severity: notice
```

There is no key for how far the search reaches, and no flag either. Whether
history is readable is a fact the tool finds out, per 0034 and 0044 stress test
24. The budget is a constant rather than a setting. A team that wants a
rename reported louder or quieter already has `severity:`:

```yaml
cite:
  severity:
    source-moved: error          # a rename must be reviewed, not just repaired
    source-moved-ambiguous: off  # or: never fail on one
```

### Rules and messages

No rule is added, removed or re-levelled, and no message changes shape. Two of
them carry a value they could not carry before, one gains a clause, and one is
reached less often:

| Rule | Severity | Exit | Message today | Message with this proposal |
|---|---|---|---|---|
| `source-moved` | warning | 0 | `moved -> lib/limits.ts:4` | `moved -> lib/config/limits.ts:112`, and `moved -> ~AQ9f…:4` for an encrypted source |
| `source-moved-ambiguous` | error | 1 | `moved, 2 candidates (lib/limits.ts:4, lib/limits.ts:11); widen the range` | `moved, 2 candidates (src/cite/core/sources.ts:112, src/cite/legacy/sources.ts:112); widen the range` |
| `source-changed` | error | 1 | `changed since 9121f1f, 3 commits` | `changed since 9121f1f, 3 commits; now at lines 200-215` |
| `source-missing` | error | 1 | `missing` | `missing`, reached only when no commit-touched file holds the pin |

The span clause is offered on `source-changed` alone. A `source-never-true` end
has no span to offer, because the pinned lines did not hash to the pin at the
recorded commit either. Its message is unchanged.

Severities, exit codes and the baseline are 0044's. A warning and a notice
never move the exit code. A repository whose refactor renamed twenty cited
files exits 0, and one `manni cite update` repairs it. The baseline
fingerprint survives a cross-file move for the reason 0044 stress test 19 gave.
Its subject is `id ?? source.integrity`, and a move changes neither. A
baselined `source-missing` does not forgive the `source-moved` that replaces
it, because the rule is a fingerprint input. That finding is a warning, so it
cannot fail a run.

### Output shapes

| Format | What changes |
|---|---|
| `pretty` | The source column reads `moved -> <path>:<lines>` with the new path in it, and a changed row gains `; now at lines 200-215`. `--show-diff` diffs the span when one is known, under the same 60-line cap. `--reveal` prints the decrypted new path beside a moved encrypted source. |
| `json` | No new field. A cross-file move sets `source.newSrc`, which already carries a path, and `source.newLines`. A changed end with a span sets `source.newLines`. `resolvedPath`, the diff and the commit subjects stay out, as the allowlist keeps them out. |
| `github` | `::warning file=docs/limits.md,line=9,title=manni%3Acite/source-moved::fetch-timeout (lib/limits.ts:2): moved -> lib/config/limits.ts:112` |
| `sarif` | Meta's renderer over the same findings. Rule id `manni:cite/source-moved`, level `warning`, `partialFingerprints` unchanged. The new path is in the message. |
| `junit` | Meta's renderer, classname `manni.cite`. A `source-moved` stays a passing testcase, and a `source-changed` failure's text carries the span. |

The output rule of 0044 is unchanged and now covers one more value. `newSrc` is
spelled as the page spelled the source, so a private path reaches no format.

### The `update` report

Two lines, both in the shapes `update` prints today. A pin is abbreviated to
eight hex digits and a commit to seven:

```
docs/cite/reference/cli.mdx: index source src/cite/commands/check.ts:206 -> src/cite/core/sources.ts:112 (moved)
docs/cite/reference/cli.mdx: read-page source src/cite/core/page.ts:200-212 -> src/cite/core/page.ts:200-215 re-pinned at 04ef174 (changed; sha256-11aa22bb… -> sha256-33cc44dd…)
```

The first is the existing moved line, whose `from` and `to` are already whole
sources rather than ranges. The second is the existing re-pinned line, with the
`from -> to` of the span in front of it, so the acceptance names the range it
accepted. In `-f json` the rewrite's `from` and `to` carry the same values, and
`UpdateRewrite` gains no field.

### The ladder

**1. The bare minimum.** Every citation in every collection, against this
checkout. Nothing is configured beyond `collections:`.

```console
$ manni cite check -q
63 files checked, 63 passed, 0 failed, 0 findings
# exit 0
```

`-q` hides the clean files, which is every one of them here. The 1,941
citations cost one hash each and no git call beyond the run's single
`git ls-files`.

**2. A file moved, and nothing else changed.** The #49 case.

```console
$ manni cite check docs/src/content/docs/cite/reference/cli.mdx
⚠ docs/src/content/docs/cite/reference/cli.mdx
    ↕ index            :118 current   src/cite/commands/check.ts:206 moved -> src/cite/core/sources.ts:112

1 file checked, 1 passed, 0 failed, 1 finding (1 warning)
# exit 0
```

**3. Repair it.**

```console
$ manni cite update docs/src/content/docs/cite/reference/cli.mdx
docs/src/content/docs/cite/reference/cli.mdx: index source src/cite/commands/check.ts:206 -> src/cite/core/sources.ts:112 (moved)
1 citation rewritten in 1 file, 0 skipped
# exit 0
```

**4. Something landed inside the range.** The #56 case.

```console
$ manni cite check --show-diff docs/src/content/docs/cite/reference/citations.mdx
✗ docs/src/content/docs/cite/reference/citations.mdx
    ✗ read-page        :204 current   src/cite/core/page.ts:200-212 changed since 94f017a, 1 commit; now at lines 200-215
        refuse a page whose frontmatter fence never closes
        +  if (FENCE_ONLY.has(format) && hasFrontmatterFence(content) && locateFrontmatter(content) === null) {
        +    throw new CiteError(

1 file checked, 0 passed, 1 failed, 1 finding
# exit 1
```

**5. Accept it at the span.** The re-mint covers the lines the sentence rests
on, and the entry's range follows.

```console
$ manni cite update --accept --only read-page docs/src/content/docs/cite/reference/citations.mdx
docs/src/content/docs/cite/reference/citations.mdx: read-page source src/cite/core/page.ts:200-212 -> src/cite/core/page.ts:200-215 re-pinned at 04ef174 (changed; sha256-11aa22bb… -> sha256-33cc44dd…)
1 citation rewritten in 1 file, 0 skipped
# exit 0
```

**6. Two copies of the moved code.** The tool refuses to pick one.

```console
$ manni cite check docs/limits.md
✗ docs/limits.md
    ✗ retries          :14 current   lib/limits.ts:3 moved, 2 candidates (lib/config/limits.ts:3, vendor/limits.ts:3); widen the range

1 file checked, 0 passed, 1 failed, 1 finding
# exit 1
```

**7. The CI forms.** The same findings, in the shapes a pipeline reads.

```console
$ manni cite check -f github
::warning file=docs/limits.md,line=9,title=manni%3Acite/source-moved::fetch-timeout (lib/limits.ts:2): moved -> lib/config/limits.ts:4
# exit 0

$ manni cite check -f sarif > cite.sarif
# exit 0

$ manni cite check -q --baseline
63 files checked, 63 passed, 0 failed, 2 findings (2 baselined)
# exit 0
```

**8. A private source that moved.** The two-checkout layout, with the key in a
secret and the path never printed.

```console
$ MANNI_ENCRYPTION_KEY=$SECRET manni cite check --root ../code docs/
⚠ docs/limits.md
    ↕ fetch-timeout    :9 current   ~AQm4…:2 moved -> ~AQ9f…:4
# exit 0

$ MANNI_ENCRYPTION_KEY=$SECRET manni cite check --root ../code --reveal docs/
⚠ docs/limits.md
    ↕ fetch-timeout    :9 current   ~AQm4…:2 (lib/limits.ts) moved -> ~AQ9f…:4 (lib/config/limits.ts)
# exit 0
```

**9. The public job, which never reaches a source at all.** Unchanged by this
proposal, and listed so the ladder covers it.

```console
$ manni cite check --no-check-sources docs/
✓ docs/limits.md
    ✓ fetch-timeout    :9 current   ~AQm4…:2 skipped
# exit 0
```

**10. Every option at once.** `check`, with the flags that compose:

```console
$ MANNI_ENCRYPTION_KEY=$SECRET manni cite check --collection site \
    --ext md,mdx --exclude "**/drafts/**" -c manni.config.yaml \
    --root ../code -f pretty -q --show-diff --reveal --baseline \
    --no-gitignore --allow-empty
⚠ docs/src/content/docs/cite/reference/cli.mdx
    ↕ index            :118 current   ~AQm4…:206 moved -> ~AQ9f…:112 (src/cite/core/sources.ts)

63 files checked, 63 passed, 0 failed, 1 finding (1 warning) (2 baselined)
# exit 0
```

Six options are left out of that rung because each contradicts one that is in
it. `[paths...]` and `-` cannot join `--collection`, `--as` belongs to stdin,
`--no-config` contradicts `-c`, `--write-baseline` wins over `--baseline`, and
`--no-check-sources` turns off everything this proposal is about.

And `update`, with every flag that composes:

```console
$ MANNI_ENCRYPTION_KEY=$SECRET manni cite update --collection site \
    --ext md,mdx --exclude "**/drafts/**" -c manni.config.yaml \
    --root ../code --accept --only index --only read-page \
    --dry-run -f json --no-gitignore --allow-empty
{
  "pages": [
    {
      "file": "docs/src/content/docs/cite/reference/cli.mdx",
      "rewritten": [
        {
          "id": "index",
          "index": 0,
          "end": "source",
          "reason": "moved",
          "status": "moved",
          "from": "~AQm4…:206",
          "to": "~AQ9f…:112"
        }
      ],
      "skipped": [],
      "written": false
    }
  ],
  "rewritten": 1,
  "skipped": 0,
  "exitCode": 0
}
# exit 0
```

### The usage errors

This proposal adds no flag, no config key and no argument, so it adds no usage
error. Every refusal the ladder above can reach is one the tool prints today.
Each is listed here, because the ladder is where a reader meets them:

| Invocation | stderr | Exit |
|---|---|---|
| `cite update --no-check-sources docs/` | ``manni: update needs the sources: drop --no-check-sources (or `checkSources: false`).`` | 2 |
| `cite check --collection site docs/` | `manni: --collection selects a configured collection; it cannot be combined with paths.` | 2 |
| `cite check --collection site --no-config` | `manni: --collection needs a config file to select from.` | 2 |
| `cite check --root no-such-dir` | `manni: Root directory not found: no-such-dir.` | 2 |
| `cite check --baseline missing.json` | ``manni: Baseline "missing.json" not found. Record one with `manni cite check --write-baseline`, or drop --baseline.`` | 2 |
| `cite check -f moved` | `manni: Unknown --format "moved". Use pretty, json, github, sarif, or junit.` | 2 |
| `cite update -f github` | `manni: Unknown --format "github". Use pretty or json.` | 2 |
| `cite check -` with no `--as` | ``manni: Reading from stdin (`-`) requires --as <format> to choose an extractor.`` | 2 |
| `cite check` with no paths and no collections | ``manni: No files to check. Pass paths/globs, or declare a collection under `collections:` in manni.config.yaml.`` | 2 |
| `severity: {source-moved: fatal}` | `manni: cite.severity.source-moved in manni.config.yaml must be one of error, warning, notice, off, not "fatal".` | 2 |

One finding rather than a refusal is worth listing beside them, because the
in-range search shares its constant. A range wider than 5,000 lines is
`entry-invalid`, an error, exit 1, and the entry is not classified:

```
fetch-timeout: source.lines "1-6000" spans 6000 lines, more than 5000
```

### The programmatic API

`src/index.ts` is unchanged, and so is `src/cite/index.ts`. The changes are
internal, and listed because two of them are shared:

| Export | Kind | Change |
|---|---|---|
| `GitClient.changedSince(commit)` | method | New, on the family-private client. `git diff --name-only <commit> HEAD`, memoized per commit. |
| `findWindows` | function | Unchanged. The cross-file search calls it once per candidate with `original` set. |
| `MOVE_BUDGET_BYTES` | const | Unchanged, 64 MiB. It is one counter per citation, and it now also bounds the candidate bytes a cross-file search reads. |
| `SourceEnd.newSrc` | field | Unchanged shape. It may now name another file, and carries a ciphertext for an encrypted source. |
| `SourceEnd.newLines` | field | Unchanged shape. It is now set on a `changed` end that found its span. |
| `UpdateRewrite` | interface | Unchanged. |

## Cost

**A clean run costs nothing new.** Zero extra git calls, zero extra reads and
zero extra hashes. Both searches run only after a pin has failed to hash at its
range and failed to hash anywhere in its file. This repository's 1,941
citations are clean today, so the cost of this proposal there is nil.

**A dirty run costs one git call per commit, not per citation.** That is the
whole difference from the `git log --follow` per citation 0044 priced and
refused. The added work, per entry whose pin holds nowhere in its own file:

| Work | Cost |
|---|---|
| `git diff --name-only <commit> HEAD` | One call per distinct `commit-sha`, memoized for the run. Twenty stale pins minted in one sitting cost one call. |
| Reading candidates | One read per candidate the index holds and the diff names, bounded by what is left of that citation's counter. |
| Hashing candidates | One hash per start line whose text equals the pinned range's old first line. Usually zero per file. |
| The in-range search | No git call and no hash. Two line scans of a text `git show` already fetched. |
| `git show <commit>:./<path>` | Unchanged. It already runs on a non-match, memoized per commit and path. |

The refactor that prompted this proposal is the worst realistic case. One
commit moved one function, the diff named nine files, and the search read nine
files and hashed one window.

## Stress test

What was tried against this design, and what each attempt changed.

### 1. `git log --follow`, which 0044 priced and refused

The obvious way to follow a rename is to ask git. It costs a history walk per
citation. Git's rename detection is a similarity score, so a file renamed and
edited in one commit is a guess. 0044 refused it on both counts, and it was
right to.

**Changed as a result:** nothing in that reasoning is disputed, and the design
does not use it. Rename history is never read. The candidate list is one
`git diff --name-only` per commit, and the pin decides. A window hashes to the
pin or it does not, so a similarity score never enters. The verdict 0044 drew
from that cost is what this proposal supersedes, not the cost.

### 2. A file split in two

`sources.ts` was split into `sources.ts` and `source-index.ts`, and half the
cited lines went to each. A search that reported the first hit it found would
have rebound the pin to whichever file sorted first, and `update` would have
written it in.

**Changed as a result:** the pin is over one range, so a split leaves at most
one file holding it. The half that holds the pinned lines is the hit, and the
other half is irrelevant to that entry. A pin spanning the seam is in neither
file, so it is `source-changed` or `source-missing` as it is today. Two entries
on one page can therefore follow one split into two different files, which is
the outcome a reader wants.

### 3. A file renamed and edited in the same commit

`git mv` plus an edit is the common refactor, and it is where rename detection
guesses. The pin then holds nowhere, so the cross-file search finds nothing,
and the finding is `source-missing` at the old path with no hint at all.

**Changed as a result:** this stays outside the design, and the record says so
rather than implying otherwise. The pin is the only evidence this tool trusts,
and a renamed and edited file has destroyed it. `add` is still the remedy, and
0044's sentence about that case stands. What shrank is how often it is reached,
because a rename with no edit and an edit with no rename are both answered now.

### 4. Two identical copies of the pinned code

`export const RETRIES = 3;` is the case 0044 stress test 3 caught inside one
file, and vendoring makes it worse. A refactor that copies a helper into two
packages leaves two windows that hash to the pin, in two files.

**Changed as a result:** the count is taken across every candidate, not per
file. Two hits in two files are `source-moved-ambiguous`, exactly as two hits
in one file are. The candidates list their paths, so the message says which two
files, and `update` never touches an ambiguous entry. Widening the range is
still the fix, and it now disambiguates across files as well.

### 5. A move into a file the run cannot read

The diff names a path the index holds, and reading it fails. A permission
error, a file deleted between the diff and the read, or 300 MB of minified
vendor bundle.

**Changed as a result:** an unreadable candidate is skipped, and the search
carries on with the next one. A failed read is not an operational error, which
would turn one bad file into an exit 2 on an otherwise clean corpus. The bundle
answers differently. It reads, it costs its bytes against the budget, and its
first-line filter rejects every start line at once. Stress test 9 covers what
happens when several of those arrive together.

### 6. A commit git cannot show

`actions/checkout` defaults to depth 1, which is the case 0044 stress test 9
handled. A shallow clone cannot show the file at the pin's commit, so there is
no original text. Without it there is no first-line filter, and no first and
last line.

**Changed as a result:** both searches are gated on the original text, and
neither runs without it. The end reads
`changed (history unavailable: commit 9121f1f not found; fetch-depth: 0)`,
which is the message 0044 designed, and the run repeats its existing notice
about `fetch-depth: 0`. A rename under a shallow clone is `source-missing`,
exactly as today. No new message says the search was skipped, because the two
notices already name the reason.

### 7. A repository without git

The pages and the sources are in a tarball, or git is off `PATH`. The tool
already runs there: the index comes from a directory walk, no history is read,
and a non-matching pin is `changed` rather than `never-true`.

**Changed as a result:** nothing runs, and nothing new is said. Both searches
need a commit that git can show, which needs git. The existing run notice
covers it:

```
git is not available here, so citations are checked without history: no never-true, no diffs, no commit subjects.
```

A directory walk over an arbitrary tree is also the probe 0044 stress test 16
closed. A cross-file search with no tracked-file list is the wrong thing to
want.

### 8. The move is in the working tree and nothing is committed

The first draft ran `git diff --name-only <commit>`, with no second revision.
That compares the commit to the working tree, so a `git mv` that is merely
saved was followed. `update` then wrote a path that a colleague's checkout did
not have, and the next `check` in CI reported `source-missing` at a path
nothing ever committed.

**Changed as a result:** the call is `git diff --name-only <commit> HEAD`, and
committed changes only. An uncommitted move is `source-missing` until it is
committed, which is the same answer the tool gives an uncommitted file today.
The candidate list is then the same on every checkout at that commit, which is
what makes a `-f sarif` upload reproducible.

### 9. The diff named 4,000 files

A pin minted eighteen months ago, against a repository with 900 commits since.
`git diff --name-only <that commit> HEAD` names most of the tree. A file count
cap was drafted, then a wall-clock timeout.

**Changed as a result:** both were dropped, and the 64 MiB budget is the only
cap. A count cap is arbitrary in the unit that matters, since 4,000 source
files are cheaper than one vendored bundle. A timeout makes a check's verdict
depend on the machine, so CI and a laptop would disagree about whether a pin
moved. The budget is in bytes, the candidates are visited in git's sorted
order, and a truncated search is therefore the same on both. When it truncates,
the end keeps its old verdict, `truncatedSearch` is set, and the run raises the
cross-file form of the notice from decision 2.

### 10. The old last line occurred twice

The in-range search brackets the pinned lines by their first and last line. A
range whose last line is `}` brackets nothing, because `}` occurs three hundred
times. An earlier draft took the nearest one after the first line.

**Changed as a result:** each end line must occur **exactly once** in the file.
Nearest-match is a guess, and a guess here is worse than no answer, because
`update --accept` would re-mint over it. With no span the finding is exactly
what it is today, so the search can only add information. The 5,000-line span
limit is `MAX_RANGE_LINES`, the constant the entry grammar uses. So an accepted
span can never be a range the schema refuses.

### 11. A moved encrypted source almost printed its new path

The cross-file search works over plain paths internally, because it has the key
and needs the bytes. The first draft set `newSrc` from that plain path, and
`newSrc` reaches `json`, `github`, `sarif` and `junit`. A public CI job would
have uploaded a SARIF file naming a private path. That is the leak 0044 stress
test 16 closed for the source itself.

**Changed as a result:** `newSrc` carries the new path encrypted in the
`cite-src` context, so it is a ciphertext in every format. `messageFor` spells
it through `shortSrc`, so a row reads `moved -> ~AQ9f…:4` and a plain path
still reads whole. `--reveal` prints the decrypted new path in pretty output
only. 0044's sentinel test gains a moved encrypted source, and asserts that
neither the path nor the key appears in any format.

### 12. The baseline forgave a missing source and then saw a warning

A repository ratcheting in with `--baseline` had a `source-missing` recorded
for a file deleted last year. After this change the same entry reports
`source-moved`, which the baseline does not hold, so it is a new finding.

**Changed as a result:** nothing, and the record says why. The fingerprint's
subject is unchanged, and the rule is one of its inputs, so a different rule is
a different finding on purpose. `source-moved` is a warning, so the new finding
cannot fail a run, and one `manni cite update` clears it. A team that wants the
warning gone without the rewrite has `severity:` and `--write-baseline`.

### 13. An entry with no `commit-sha`

`add --no-commit-sha` exists, and a hand-written entry may omit the field. The
pin then holds nowhere and there is no commit to diff against.

**Changed as a result:** the gate is the original text, which needs the
commit, so neither search runs. The entry is `changed` or `missing` as it is
today. This is the one case where nothing in the run says why. The entry chose
not to record a commit, and no notice can usefully repeat that every run.
The `add` reference already says what `--no-commit-sha` costs, and
this proposal adds a sentence there naming the move search as one more thing
the field buys.

### 14. A whole-file pin that moved

0044 stress test 4 established that a whole-file pin never reports `moved`. A
range of 1 to N can only be found at line 1. A `git mv` of an unedited file is
exactly the case where its pin still holds.

**Changed as a result:** the rule is now stated per direction rather than
absolutely. A whole-file pin never moves inside its file, which is 0044's
finding and stays true. It can move to another path, where the whole candidate
file is the window, and `update` rewrites `source.file` with no `lines` to
touch. That is the cheapest possible verdict in the whole design, and it covers
`source-of-truth` at file grain, which is what a bare pin is for.

## Verification

```bash
npx vitest run test/cite                       # the new searches, with their fixtures
node dist/cli.js cite check                    # this repo's 1,941 citations; exit 0
npm run docs:check-cli                         # the CLI reference still matches the program
node dist/cli.js meta validate                 # the dogfood gate; exit 0
vale docs/proposals/0055-following-a-source.md # zero alerts
```

Four fixtures are added under `test/fixtures/cite/`, each named for what it
exercises:

- a source moved whole to a new path,
- a source moved into two files,
- a guard inserted inside a pinned range,
- a renamed file whose content was edited.

The first three are built with real commits in a temp repository
through `test/helpers/temp-repo.ts`, because the design turns on what git can
show.

## Not breaking

Additive in the surface and narrowing in one verdict. No flag, no config key,
no rule, no JSON field and no message removed. A run that reported
`source-missing` for a renamed file now reports `source-moved`, which is a
warning where the old finding was an error. So a pipeline can go from exit 1 to
exit 0 on a corpus nobody touched, and no pipeline goes the other way. That is
a `fix(cite):` by the release rules, since the tool is reporting the wrong thing
today, and the commit says which verdict changed.

Two things are worth a reviewer's attention before this lands. `update` now
rewrites `source.file`, which is the first time a path in a page is edited by a
tool rather than a person. And an accepted span rewrites `source.lines` on a
`changed` end, where `--accept` previously left the range alone. Both are
visible in the diff `--dry-run` prints, and both are named in the report line.

## Consequences

- The fix page for `source-missing` in `docs/src/content/docs/cite/fix/` needs
  rewriting. A rename is no longer its headline case. What is left is an
  untracked destination, a shallow clone, and a file that is gone.
- The `add` reference's `--no-commit-sha` row gains the move search to the list
  of what the field buys.
- `manni key rotate` re-encrypts cite's sources, and it skips an entry whose
  pin no longer holds with
  ``changed; run `manni cite update --accept` before rotating``. A moved source
  now re-keys cleanly, so that skip is reached less often. The message is
  unchanged.
- One `feat:` commit or one `fix:` commit is the last question below, and the
  house rule ties the demo video to the answer. The demo is the #49 transcript.
  A red check shows a deletion and no destination, then the same check names
  the function's new home, then one `update` fixes it.
- Three questions the review raised are decided, and each is a decision in the
  section it belongs to. A cross-file `source-moved` stays a **warning**, in
  decision 2, and that record carries the four grounds. The span is not
  offered on `source-never-true`, in decision 3. A never-true end has no
  canonical first and last line to look for. The candidate list does not fall
  back to the whole tracked-file index, in decision 2. That search is blind,
  and stress test 9 declined to bound it.
- One question is left, and it is a release decision rather than a design one.
  Is `fix:` right, given that the verdict for a renamed file changes? The
  alternative reading is `feat:`, since following a source across files is new
  behaviour with a demo attached. "Not breaking" above states the `fix(cite):`
  reading, and the commit type is what semantic-release acts on, so the
  maintainer settles it.
