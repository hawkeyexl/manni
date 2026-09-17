# 0056: several ids per marker

- **Status:** Proposed
- **Serves:** Three journeys, all downstream of one page edit.
  - Maya · M5, "Pin a claim and catch it going stale". A paragraph that
    supports four claims carries one comment instead of four.
  - Theo · T2, "Read a citation failure and fix it". The marker he reads names
    every entry anchored to the text under it.
  - Maya · M6, "Keep citations out of the page". The body keeps one line of
    bookkeeping per paragraph, whether the entries sit in frontmatter or in a
    manifest.
- **Depends on:** [0044](0044-citations-and-drift.md), which defines the
  marker, the anchor rule, the four marker rules and the hashing rule this
  proposal leaves alone. [0034](0034-command-grammar.md), for one separator per
  list, which is what picks the space.
- **Supersedes, in part:** [0044](0044-citations-and-drift.md). Its § Markers
  fixes the payload at one id, and its stress test 11 is the reasoning that put
  it there. Both are answered below. 0044's own text stays exactly as written,
  and its README row records the partial supersession.
- **Relates to:** [0041](0041-collections.md) and
  [0037](0037-sidecar-metadata.md), for a page whose entries live in a
  manifest. A sibling plan proposes a `remove` verb, and § 6 says what that
  verb owes this grammar without waiting on it.
- **Touches:** `src/cite/core/{statements,page,check-page}.ts`,
  `src/cite/commands/add.ts`, `src/cite/cli.ts`,
  `docs/src/content/docs/cite/reference/{citations,cli}.mdx`,
  `docs/src/content/docs/cite/set-up/require-citations.mdx`,
  `docs/proposals/README.md`, `test/cite/**`, `test/fixtures/cite/**`
- **Verdict:** A marker's payload becomes one or more ids, separated by spaces.
  `{/* cite fetch-timeout retries */}` is one marker naming two entries, and
  both anchor the text the marker anchors. A one-id marker is unchanged, so
  nothing on any page today means anything different. `add --marker` joins the
  paragraph's marker instead of stacking a second line. Findings stay one per
  citation. No new rule id, no new config key, no new flag, and no schema
  change.

## Problem

Maya's M5 loop works. A sentence rests on a few lines of code, `manni cite
check` classifies both ends from git alone, and a finding names the sentence.
Her pages are now paying for it in the body.

A marker names one id, and an entry carries one source. A paragraph that rests
on four files therefore collects four markers, stacked above it, each differing
from the next by one word. Dogfooding `manni cite` over 1,941 real citations in
this repository turned three of those up on one branch:

| Page | Paragraph | Markers |
|---|---|---|
| `cite/reference/citations.mdx` | the move-search paragraph | 6 |
| `cite/set-up/require-citations.mdx` | the vocabulary paragraph | 5 |
| `term/reference/configuration.mdx` | one paragraph | 4 |

Six comment lines above one paragraph, read in a diff, look like six different
instructions. They are one. Every marker in the stack anchors the same text and
pins the same bytes, so every `claim.integrity` in the stack holds the same
hash. A reviewer has to read all six to learn that only the last word differs.

The finding count is honest and stays. A typo fix in that paragraph really does
change six pinned claims, and each one rests on a different source. What is not
honest is the page source. It carries a column of near-identical comments to
say one thing, which is that this paragraph is cited six times.

`add --marker` makes the column grow. It refuses to touch a marker that is
already there:

```console
$ manni cite add docs/limits.md:30 lib/limits.ts:9 --id backoff --marker
manni: docs/limits.md:30 already has a marker retries at line 29.
# exit 2
```

The way past that refusal is to write the marker by hand on a new line. So the
tool's own happy path is the one that stacks.

## Decision

### 1. The grammar

A marker's payload is one or more ids, separated by spaces:

```
{/* cite fetch-timeout retries backoff */}
```

The keyword stays `cite`. The delimiters stay the format's own. The ids stay
under the entry grammar, `^[a-z0-9][a-z0-9-]*$`. A payload holding one id is
what it is today, with the same meaning and the same bytes.

**The separator is a space, and only a space.** 0034 gives the rule and the
reason. A list that arrives as separate words is space-separated, because argv
is. A marker's payload reads as words rather than as one value. A comma is
never a separator here. `cite fetch-timeout,retries` is one token,
that token is not an id, and the marker is `marker-invalid`. A run of spaces
separates as one, which is what a soft-wrapped editor and a shell both do.

There is no second spelling. A marker that took both commas and spaces would
need both in the docs, both in the tests, and both in the writer. One of the
two would be the form nobody meant.

### 2. Scanning

The scanner keeps its shape. `indexOf` over the open and close delimiters, over
the body only, with code read as code. What changes is one function. The
payload is trimmed, then split on spaces, and each word is checked as an id.

The checks run in a stated order, and the first defect is the finding:

1. An empty payload.
2. A line break inside the payload.
3. A word starting with `{`.
4. More than 25 ids.
5. A word that is not an id, leftmost first.
6. An id named twice, leftmost repeat first.

Checks 3 and 5 overlap on purpose. A word starting with `{` is also a word
that is not an id, and 3 runs first so the more actionable message fires. A
person who pasted an entry into the body needs to hear where the entry belongs,
rather than that the paste is not an id.

A defective marker anchors nothing, exactly as today. One marker raises one
`marker-invalid`, so a marker with two bad words does not print twice. The fix
is to rewrite the line, and one message is enough to make it.

The messages are in § The rules and their messages. Three of the six cases are
new, one message changes, and the other two are the strings 0044 shipped. That
table carries a fourth new case, the quote mix from § 3, which is not a scanner
check.

### 3. Anchoring

The anchor rule does not change. A marker anchors the rest of its own line when
that line carries text, else the paragraph or block that follows. Every entry
the marker names anchors that same text. Every `claim.integrity` in the list
therefore pins the same bytes and holds the same hash, which is expected rather
than a finding.

One property makes this safe, and it is 0044's. A line holding only a marker is
never part of a pin. So adding a word to a marker cannot change any claim hash,
on that paragraph or anywhere else. Joining an id into an existing marker is a
zero-risk edit to every pin already on the page.

`marker-repeated` keeps its job. One id named by two markers is
`marker-repeated`, and the first marker anchors. One id named twice inside one
marker is `marker-invalid` instead, because that is one line and one fix. Two
markers above one paragraph, each naming its own ids, stay legal and each
anchors the paragraph. That is what keeps every page written under 0044 valid.

`anchor-invalid` grows one case. A `quote` entry anchors the next fenced block,
and a plain entry anchors the paragraph. A marker whose list mixes the two
would mean two spans on one line, and a reader could not see which id got
which. That mix is `anchor-invalid`. A list of quote entries is legal, and so
is a list of plain entries.

### 4. `add --marker` joins

When the paragraph already carries a marker, `add --marker` appends the new id
to that marker's list. It does not write a second line. The refusal quoted in
§ Problem is removed.

**Which marker.** The one nearest the anchored text. That is the marker on the
text's own line when there is one, else the last marker line above it. A
reader associates the nearest comment with the prose, and appending there needs
no other line to move.

**Where in the list.** Last. The order records the order the citations were
minted, and an append never renumbers or reorders a word somebody else wrote.

**What it does not do.** It joins one marker and rewrites no other. A page that
already carries a stack of six keeps the stack, and the seventh citation joins
the sixth marker. Collapsing an existing stack is an edit to somebody's prose
file, and § Consequences records it as an open question rather than doing it
here.

`--id` stays one id. `add` mints one entry per run, each with its own source
range and its own pin. A list there would have nothing to pair the second id
with.

### 5. Findings stay one per citation

Each named entry reports on its own. A reader sees one row per citation,
whichever marker named it. Nothing about the pretty, json, github, sarif or
junit shape changes, and no baseline fingerprint moves.

This is the part that does not get cheaper, and saying so is the point. Six
citations over one paragraph produce six findings when that paragraph changes.
Each one rests on a different source, and `update --only <id>` repairs them one
at a time. Collapsing them would hide which source each claim rests on, which
is the whole value of pinning a sentence rather than a page.

`marker-orphan` is the one rule that reports per id. A marker naming three ids
where two have no entry raises two `marker-orphan` findings. An orphan is a
well-formed id with a missing entry, so each id is its own subject and its own
fix. `marker-invalid` is about the marker's text, which is one fix.

### 6. The line budget

**A marker is one line.** The open and close delimiters must sit on the same
line. A payload holding a line break is `marker-invalid`. The rule exists
because `isMarkerLine` decides whether a line is only a marker, and a
marker-only line is never part of a pin. A marker wrapped onto a second line
would put half of itself inside the text it anchors, and that half would land
in the hash.

**A marker holds at most 25 ids.** Past that it is `marker-invalid`, with the
count. There is no character limit, because a character limit would depend on
how long the ids happen to be. The cap counts the thing that has meaning, on
the same grounds as 0044's cap of 500 markers per page. The worst real
paragraph found in 1,941 citations names six sources. A paragraph naming
twenty-six is a paragraph to split.

The 500-markers-per-page cap counts markers and does not change. A page may
hold 500 markers of 25 ids each.

**A `remove` verb**, proposed separately, owes this grammar two behaviours.
Removing an id drops that word from the list, and drops the whole marker line
when it was the last id. This proposal does not add the verb and does not wait
on it.

### 7. The forms, per format

Every form 0044 lists takes a list. The table below is the published one, with
a second id added:

| Format | Forms |
|---|---|
| markdown, mdx | `<!-- cite fetch-timeout retries -->`, `{/* cite fetch-timeout retries */}`, `[comment]: # (cite fetch-timeout retries)` |
| html, xml | `<!-- cite fetch-timeout retries -->` |
| asciidoc | `// (cite fetch-timeout retries)` |
| rst | `.. (cite fetch-timeout retries)` |

The parenthesised forms take the list safely, and the reason answers 0044's
stress test 11 directly. An id cannot hold `(`, `)`, `{`, `}`, `<`, `>` or `-`
as a leading character, so no list of ids can close a comment early or late.
That guarantee is what JSON could not give.

`formatStatement` writes the first form for the format, with one space between
words. `[comment]: # (`, `// (` and `.. (` keep hugging their parentheses, and
the comment forms keep their inner spaces.

### Answering 0044

0044 § Markers says:

> A marker names an entry by its id. One keyword, `cite`, one payload, in the
> format's own comment syntax

and:

> The payload must match the id grammar.

Its stress test 11 is where the second sentence comes from. The test found that
a JSON payload broke the parenthesised forms, because `{"a": ")"}` closes a
`(…)` comment early and nested parentheses close it late. Its remedy was
this, under the heading "Changed as a result":

> the parenthesised forms (`[comment]: # (…)`, asciidoc's `// (…)`, rst's
> `.. (…)`) accept an id only; a `{` there is `statement-invalid`.

The conclusion is right and stays. The rule written from it is wider than the
evidence. What stress test 11 proved is that a payload may not carry delimiters
of its own. It did not test whether a payload may carry more than one name.
Those are different properties, and the id grammar already settles the first
one for any number of ids. Every character that could close a comment sits
outside the grammar. So a list of ten ids is as safe in `// (…)` as one id is.

The narrow rule also had no cost when it was written. 0044 shipped with no
corpus behind it. The cost showed up at 1,941 citations, as the stacks in
§ Problem.

## The interface

### Before and after, on the page

Before, on `docs/limits.md`:

```markdown
{/* cite fetch-timeout */}
{/* cite retries */}
{/* cite backoff */}
The client waits two seconds for a response, retries three times, and
backs off exponentially between attempts.
```

After:

```markdown
{/* cite fetch-timeout retries backoff */}
The client waits two seconds for a response, retries three times, and
backs off exponentially between attempts.
```

The frontmatter is byte for byte the same. Three entries, three sources, three
claim hashes, and all three hashes hold the same value, because all three pin
the same two lines of prose.

### Config

No key changes. The before and after config document is the same document:

```yaml
# manni.config.yaml, before and after this proposal
collections:
  - name: site
    paths: ["docs/**/*.{md,mdx}"]

cite:
  root: ../code
  severity:
    marker-invalid: error
    marker-orphan: error
    marker-repeated: warning
    anchor-invalid: error
```

Nothing switches this grammar on. The scanner reads what the page says, and a
payload of one word is one id while a payload of three is three. A key here
would ask an operator to declare a fact the tool can see.

### The rules and their messages

Every message below carries its rule's configured severity, which defaults to
`error` for `marker-invalid`, `marker-orphan` and `anchor-invalid`, and
`warning` for `marker-repeated`. An error-severity finding the baseline does
not hold exits `1`. A warning or a notice exits `0`.

| Case | Rule | Message | Severity | Exit |
|---|---|---|---|---|
| `cite` with nothing after it | `marker-invalid` | `invalid marker: empty payload` | error | 1 |
| a line break in the payload | `marker-invalid` | `invalid marker: a marker is one line; write two markers` | error | 1 |
| a word starting with `{` | `marker-invalid` | `A marker names an entry by id. Write the entry in frontmatter or the sidecar.` | error | 1 |
| more than 25 ids | `marker-invalid` | `invalid marker: more than 25 ids in one marker (31); write a second marker` | error | 1 |
| a word that is not an id | `marker-invalid` | `invalid marker: "fetch-timeout,retries" is not an id` | error | 1 |
| an id named twice in one marker | `marker-invalid` | `invalid marker: "retries" is named twice in one marker` | error | 1 |
| an id with no entry | `marker-orphan` | `no entry has id "retries"` | error | 1 |
| one id in two markers | `marker-repeated` | `retries is named by markers at lines 29 and 34; the first anchors it.` | warning | 0 |
| a quote id beside a plain id | `anchor-invalid` | `quoted-limits: a quote entry shares a marker with a non-quote entry. Give the quote its own marker.` | error | 1 |
| more than 500 markers on a page | `marker-invalid` | `more than 500 markers on one page (512); the rest are not read` | error | 1 |

Rows two, four, six and nine are new cases. Row five changes one shipped
string. It read `invalid marker: payload is not an id`, and it now names the
word that failed, because a list has several words and only one of them is
wrong. Naming it costs nothing when there is only one word either way. Rows
one, three, seven, eight and ten are the strings 0044 shipped, unchanged.

Row two follows the `invalid marker: <phrase>` shape the rest of the table
uses, with a semicolon before the advice, as row four does. Row three keeps
0044's unprefixed pair of sentences. It is the one row that says where an entry
belongs rather than what is wrong with a word. Rewording it would move a string
this proposal has no reason to touch.

A marker finding sits on the marker's line, whichever file the entry lives in.

### The `add` report line

`add` gains one variant. When it joins an existing marker:

```
docs/limits.md: added backoff to frontmatter; joined the marker at line 29, claim pinned at lines 30-31
```

When it writes a new marker, which is every case where the paragraph has none,
the line is the one 0044 ships:

```
docs/limits.md: added retries to frontmatter; marker at line 29, claim pinned at line 30
```

With `--dry-run` the diff shows one changed line and no new line:

```diff
-{/* cite fetch-timeout retries */}
+{/* cite fetch-timeout retries backoff */}
```

Every other `add` report line is unchanged, including the manifest form,
`added retries to docs-citations.yaml:59; joined the marker at line 6`.

### The output shapes

**pretty.** One row per citation, as today. Three entries named by one marker
print three rows, and all three carry the same marker line in the claim
column:

```console
$ manni cite check docs/limits.md
✓ docs/limits.md
    ✓ fetch-timeout   marker :29 current   lib/limits.ts:2 current
    ✓ retries         marker :29 current   lib/limits.ts:5 current
    ✓ backoff         marker :29 current   lib/limits.ts:9 current

1 file checked, 1 passed, 0 failed, 0 findings
```

**json.** Unchanged keys and unchanged order. Each citation is its own object
under `pages[].citations[]`, with `anchor` naming the marker and its line. Two
citations sharing a marker carry the same `anchor`.

**github.** One annotation per finding, on the marker's line. Three changed
claims under one marker are three annotations with the same `line=29` and three
different `title=` rule ids and subjects.

**sarif and junit.** Unchanged. Meta's renderer builds the envelope, the
repository-relative uris and the fingerprints the baseline shares. cite
supplies the rule description, the help link into the citations reference, and
the message the github annotation carries. JUnit is the same shape, under the
`manni.cite` classname. A message is no part of a fingerprint, so 0044's stress
test 19 still governs. It fixed the fingerprint subject at `id ?? integrity`,
so ids sharing a marker line stay distinct. A recorded baseline keeps matching
after a stack is collapsed into one marker.

### The ladder

**1. The bare minimum.** One paragraph, three entries, one marker.

```console
$ manni cite check docs/limits.md
✓ docs/limits.md
    ✓ fetch-timeout   marker :29 current   lib/limits.ts:2 current
    ✓ retries         marker :29 current   lib/limits.ts:5 current
    ✓ backoff         marker :29 current   lib/limits.ts:9 current

1 file checked, 1 passed, 0 failed, 0 findings
$ echo $?
0
```

**2. Mint the third citation into the marker that is already there.**

```console
$ manni cite add docs/limits.md:30 lib/limits.ts:9 --id backoff --marker
docs/limits.md: added backoff to frontmatter; joined the marker at line 29, claim pinned at lines 30-31
$ echo $?
0
```

**3. See the edit before it lands.**

```console
$ manni cite add docs/limits.md:30 lib/limits.ts:9 --id backoff --marker --dry-run
--- docs/limits.md
+++ docs/limits.md
@@ -12,0 +13,8 @@
+  - id: backoff
+    claim:
+      integrity: sha256-0b7e…
+    source:
+      file: lib/limits.ts
+      lines: 9
+      integrity: sha256-a41c…
+      commit-sha: 3f9c2a1e7b0d4c5a6f8e9d0b1a2c3d4e5f607182
@@ -29 +37 @@
-{/* cite fetch-timeout retries */}
+{/* cite fetch-timeout retries backoff */}
docs/limits.md: added backoff to frontmatter; joined the marker at line 29, claim pinned at lines 30-31
$ echo $?
0
```

**4. The config fallback, over the whole collection.**

```console
$ manni cite check
Using manni.config.yaml (.)
✓ 214 files checked, 214 passed, 0 failed, 0 findings
$ echo $?
0
```

**5. The paragraph changed, so every citation on it reports.**

```console
$ manni cite check docs/limits.md
✗ docs/limits.md
    ↕ fetch-timeout   marker :29 changed   lib/limits.ts:2 current
    ↕ retries         marker :29 changed   lib/limits.ts:5 current
    ↕ backoff         marker :29 changed   lib/limits.ts:9 current

1 file checked, 1 passed, 0 failed, 3 findings (3 warnings)
$ echo $?
0
```

**6. The CI format.**

```console
$ manni cite check "docs/**/*.mdx" -f github
::warning file=docs/limits.md,line=29,title=manni:cite/claim-changed::fetch-timeout: the claim at lines 30-31 has changed since it was pinned.
::warning file=docs/limits.md,line=29,title=manni:cite/claim-changed::retries: the claim at lines 30-31 has changed since it was pinned.
::warning file=docs/limits.md,line=29,title=manni:cite/claim-changed::backoff: the claim at lines 30-31 has changed since it was pinned.
$ echo $?
0
```

**7. A bad word in a list.**

```console
$ manni cite check docs/limits.md
✗ docs/limits.md
    ✗ page   invalid marker: "fetch-timeout,retries" is not an id   (line 29)

1 file checked, 0 passed, 1 failed, 1 finding
$ echo $?
1
```

**8. Every option at once, for scripting.**

```console
$ manni cite check "docs/**/*.mdx" --collection site --ext mdx,md \
    --exclude "docs/vendor/**" --as mdx -f sarif -c manni.config.yaml \
    --root ../code --baseline .manni-cite-baseline.json --no-gitignore \
    --allow-empty --no-check-sources --show-diff --reveal -q > cite.sarif
$ echo $?
0
```

`--collection` cannot be combined with paths, so the maximal `check` above is
the maximal set minus one. The rung that pairs them is a usage error, and it is
the first row of the next table.

**9. Every `add` option at once.**

```console
$ manni cite add docs/limits.md:30 lib/limits.ts:9 --id backoff --marker \
    --encrypt --no-commit-sha --dry-run --as mdx --root ../code \
    -c manni.config.yaml
--- docs/limits.md
+++ docs/limits.md
@@ -12,0 +13,7 @@
+  - id: backoff
+    claim:
+      integrity: sha256-0b7e…
+    source:
+      file: ~AQx7Vb2…
+      lines: 9
+      integrity: hmac-sha256-5e0c…
@@ -29 +36 @@
-{/* cite fetch-timeout retries */}
+{/* cite fetch-timeout retries backoff */}
docs/limits.md: added backoff to frontmatter; joined the marker at line 29, claim pinned at lines 30-31
$ echo $?
0
```

The entry hunk is rung 3's hunk, one line shorter and with two values changed.
`--encrypt` writes `source.file` as a ciphertext and pins it with
`hmac-sha256-`, and `--no-commit-sha` drops the `commit-sha` line. Neither flag
suppresses a hunk. A `--dry-run` join always prints two, one for the entry and
one for the marker's line.

### The usage errors

| Invocation | stderr | Exit |
|---|---|---|
| `cite check --collection site docs/` | `manni: --collection selects a configured collection; it cannot be combined with paths.` | 2 |
| `cite add docs/limits.md lib/limits.ts --id backoff --marker` | `manni: --marker needs the page lines to anchor: docs/limits.md:L.` | 2 |
| `cite add docs/limits.md:30 lib/limits.ts:9 --marker` | `manni: --marker needs --id: the marker names the entry.` | 2 |
| `cite add docs/limits.md:30 lib/limits.ts:9 --id retries --marker`, where `retries` is already an entry | `manni: docs/limits.md already has an entry retries.` | 2 |
| `cite add docs/limits.md:30 lib/limits.ts:9 --id Backoff --marker` | `manni: Invalid id "Backoff": use lowercase letters, digits and hyphens, starting with a letter or digit.` | 2 |
| `cite add docs/limits.md:40 lib/limits.ts:9 --id backoff --marker`, over a blank line | `manni: docs/limits.md:40 has no paragraph or block for a marker to anchor.` | 2 |
| `cite add docs/limits.md:29 lib/limits.ts:9 --id backoff --marker`, over the marker's own line | `manni: docs/limits.md:29 is a marker line. A marker there would change its pin.` | 2 |
| `cite check -f yaml` | `manni: Unknown --format "yaml". Use pretty, json, github, sarif, or junit.` | 2 |
| `cite check -` with no `--as` | ``manni: Reading from stdin (`-`) requires --as <format> to choose an extractor.`` | 2 |

The refusal this proposal removes is
`manni: docs/limits.md:30 already has a marker retries at line 29.` That
invocation now joins and exits `0`.

Exit codes are the family's, and 0044's table stands. `0` is clean or
warnings only, `1` is an unbaselined error-severity finding, and `2` is
operational or usage.

### The programmatic API

`src/index.ts` is unchanged, and so is the `src/cite/index.ts` barrel's list of
exports. One exported type widens:

| Export | Change |
|---|---|
| `InlineStatement["payload"]` | the `ref` variant carries `ids: string[]` in place of `id: string` |
| `formatStatement` | takes `{ kind: "ref"; ids: string[] }` |
| `CITE_RULES` | unchanged, all fourteen |
| `CiteError` | unchanged |
| `buildProgram()` | unchanged |

`InlineStatement` is exported for the seam the a11y and term domains use, and
no published example constructs one. The widening lands in the same minor
release as the grammar.

## Stress test

**1. A one-id marker.** `{/* cite fetch-timeout */}` over a paragraph. It
parses to a list of one, anchors the paragraph, and reports one row. The
finding text, the line, the fingerprint and the baseline entry are identical to
today's. The regression suite for 0044's marker cases runs unchanged, which is
the acceptance bar for this proposal. Nothing in a page written under 0044
means anything new.

**2. A list naming an id no entry has.** `{/* cite fetch-timeout retires */}`,
with the second word misspelled. `fetch-timeout` anchors and checks normally.
`retires` is a well-formed id with no entry. So it is one `marker-orphan` on
line 29, `no entry has id "retires"`, error, exit 1. The first draft made the
whole marker invalid in that case. Its grounds were that a marker is one line
and one fix.

**Changed as a result:** a typo in one word does not stop the other three
citations from being checked. An orphan is per id, and a malformed marker is
per marker. The boundary is whether the word is an id at all, which is the
boundary the scanner can see.

**3. A list naming one id twice.** `{/* cite retries retries */}`. This could
be `marker-repeated`, which is the rule for one id named twice. It is
`marker-invalid` instead, and the distinction is load-bearing.
`marker-repeated` describes two markers, has a defined winner, and is a warning
because the page still checks. A word repeated inside one marker has no second
anchor and no winner to pick. It is a typo in one line, so it is an error and
the marker anchors nothing. The message names the word, so the fix is visible
without counting.

**4. Two markers on one paragraph, each naming ids.**

```markdown
{/* cite fetch-timeout retries */}
{/* cite backoff jitter */}
The client waits two seconds for a response, retries three times, and
backs off exponentially between attempts.
```

Legal, and it has to be. Every page written under 0044 is this shape with lists
of one. Both markers anchor the paragraph, all four entries pin the same two
lines, and all four claim hashes are equal. No finding fires, because equal
hashes over one anchor are the expected outcome rather than a duplicate. A
`marker-repeated` fires only if an id appears in both lists. `add --marker`
joins the second marker, because it is the one nearest the text.

**5. A list on a page whose entries live in a sidecar.** The marker sits in the
body and the entries sit in the collection's manifest. Nothing changes.
Resolution goes through meta's merge, so the ids in the list are looked up in
the same entry set either way. Where findings sit is 0044's rule, unchanged. A
marker finding sits on the page line, and a finding about an entry sits on the
manifest and the entry's own line. So a misspelled word in the list reports on
the page, and a bad `integrity` on one of the entries it names reports on the
manifest. That split is the reason `marker-orphan` reports on the page rather
than on the manifest that lacks the entry.

**6. A very long list.** Thirty-one ids on one line, from a generated page. The
first design had no cap at all, on the grounds that the number of entries the
page carries is already the limit. That was wrong for the same reason 0044
capped markers per page. An unbounded list is an unbounded allocation from a
file the tool did not write. The error it produces without a cap is a wall of
`marker-orphan` findings rather than a sentence about the line.

**Changed as a result:** 25 ids per marker, then `marker-invalid` with the
count. The cap counts ids and not characters, because a character cap moves
with how long the ids happen to be. Twenty-five is four times the worst
paragraph in 1,941 citations.

**7. A marker whose list includes a `quote` entry's id.**
`{/* cite quoted-limits fetch-timeout */}`, where `quoted-limits` has
`quote: true`. A quote entry anchors the next fenced block, and a plain entry
anchors the paragraph. One line would then mean two spans, and the page would
not say which id got which. The first design allowed it, because the anchor
rule is already a function of each entry's own `quote` value.

**Changed as a result:** the mix is `anchor-invalid`, error, on the marker's
line, and it names the quote entry. A list of quote entries is legal, and every
member anchors the same block. A list of plain entries is legal. Refusing only
the mix reuses a rule that already exists for two anchors on one entry, and
adds no rule id.

**8. A marker wrapped onto a second line.** A long list soft-wrapped by an
editor, so the close delimiter lands on line 30 while the text it anchors
starts on line 31. The scanner would match it, because `indexOf` crosses lines.
`isMarkerLine` would not, because it tests one line. The two would then
disagree about whether line 30 is prose, and line 30 would land inside the
claim hash. So a payload holding a line break is `marker-invalid`, and the
message says to split the list into two markers. Two markers on one paragraph
are already legal, per stress test 4, so the advice is reachable.

**9. A comma, typed by somebody who expected `--ext`.**
`{/* cite fetch-timeout,retries */}`. The scanner splits on spaces only, so
this is one word. That word fails the id grammar, and the message quotes it
back. Accepting the comma was considered and refused under 0034's one
separator per list. The payload is a list of words rather than one value, which
is the space case. A flag that took both would put two spellings of one thing
in the docs and the writer.

**10. Collapsing a stack by hand, with a baseline in place.** Six markers
become one, and the paragraph is untouched. Every claim hash is unchanged,
because a marker-only line is never part of a pin. Every fingerprint is
unchanged, because 0044's stress test 19 made the subject `id ?? integrity`.
So a recorded baseline still forgives exactly what it forgave before the edit,
and a collapse never shows up as a new finding. That property is what makes
this a change somebody can make on a large corpus in one commit.

**11. The 500-marker page.** The page cap counts markers, and it still does.
A page of 500 markers naming 25 ids each holds 12,500 citations and is legal.
The cap that would bite first is the entry count the page or the manifest can
hold, which nothing bounds today. That is left where 0044 left it, since the
list grammar lowers the number of markers a page needs rather than raising it.

## Verification

```bash
npx vitest run test/cite                                # the 0044 marker suites pass unchanged
node dist/cli.js cite check                              # the repo's own citations; exit 0
node dist/cli.js meta validate                           # the dogfood gate; exit 0
npm run docs:check-cli                                   # cite's reference page against its program
vale docs/proposals/0056-several-ids-per-marker.md        # 0 alerts
```

The bar for stress test 1 is mechanical. Every existing `test/cite` case that
exercises a marker runs without edits, because every one of them writes a list
of one. The new cases are the six scanner defects, the join, the quote mix and
the collapse-with-a-baseline case.

## Not breaking

Additive to a grammar, and a `feat(cite):` minor release.

**Every page keeps working.** A payload of one id is legal today and legal
after, with the same meaning, the same anchor, the same hash and the same
fingerprint. Nothing that parses today stops parsing, and nothing that parses
today parses differently. A payload that fails today still fails, with one
message reworded.

**The schema needs no change.** A marker is body text, and the citations
vocabulary describes entries. `id` is already required when a marker names the
entry. Being named from a list rather than from a line changes nothing about
the entry's shape. No draft moves, and
`manni:citations:1.0.0-proposal.3` is untouched.

**No config key changes**, and no flag is added or removed. One `add` refusal
becomes a success, which is the only exit-code change on any invocation.

Three strings move, and all three ship in the same commit as the docs-as-tests
that match them. `invalid marker: payload is not an id` gains the offending
word. The `--marker` report line gains a `joined the marker` variant. And the
refusal over a marker's own line loses its id clause. A marker there may name
several ids, and the refusal is keyed to the line. It reads
`docs/limits.md:29 is a marker line. A marker there would change its pin.`

## Consequences

- `docs/src/content/docs/cite/reference/citations.mdx` owns the markers table
  and the payload paragraph. Both change, and the anchoring table gains the
  line about several ids sharing one anchor. The doc comment at the head of
  `statements.ts` carries the same table and changes with it.
- One `feat:` commit ships one demo video, per the house rule. The demo is
  § Problem. A column of six markers above one paragraph, one `cite add
  --marker` joining the seventh, then `cite check` printing seven rows against
  one line. The accent stays blue, since the product output owns red, green,
  yellow and cyan.
- The stacks this repository already carries are not collapsed by this
  proposal. Doing it is a prose edit to eleven pages, and the safety argument
  is stress test 10.
- Open questions for the review, in the order debate is expected:
  1. Should a verb collapse an existing stack, and if so which one? `update`
     repairs pins and touches no prose today. A `cite tidy` would be a new
     verb for a one-time migration, which is a poor trade.
  2. Is 25 the right cap, or should the cap be the page's entry count?
  3. Should `add --id` take a list after all, minting one entry per id against
     one source range? That is a different feature, and it would break the one
     entry per run rule the report line is built on.
  4. Should a marker naming ids in two different manifests be a finding? It is
     legal under § 5, and no collection in this repository produces one.
