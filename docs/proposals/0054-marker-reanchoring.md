# 0054: re-anchoring misplaced cite markers

- **Status:** Proposed
- **Serves:** Three journeys.
  - Maya · M5, "Pin a claim and catch it going stale". She wrote her markers
    with `add --marker` before PR #43, and her pages render split.
  - Theo · T2, "Read a citation failure and fix it". He meets a
    `claim-changed` on a sentence nobody edited.
  - Devin · D5, "Gate citations in CI without blocking on prose". An upgrade
    must not turn his job red.
- **Depends on:** One open pull request and one record.
  - PR #43, on `claude/fix-cite-marker-anchoring`, must merge first. It
    places new markers above their paragraph, and makes a marker-only line
    end a paragraph. This proposal repairs the pages written before that rule.
  - [0044](0044-citations-and-drift.md) is the citation vocabulary, the
    rule table and `update`'s contract that this extends.
- **Relates to:** 0053, claim history, which is being written on its own
  branch. It gives a claim end a history from git. This proposal does not
  need it, and says in stress test 3 why the pin answers first.
- **Touches:** `src/cite/core/{statements,classify,severity}.ts`,
  `src/cite/commands/{check,update,add}.ts`, `src/cite/reporters/**`,
  `src/cite/types.ts`, `docs/src/content/docs/cite/**`,
  `test/cite/**`, `test/fixtures/cite/**`
- **Verdict:** A marker line that sits inside a paragraph is a new rule,
  `marker-misplaced`, at `warning`. `update` moves such a marker to where
  `add --marker` would have written it, with no flag. It re-pins the claim
  when the old pin still holds over the text the marker used to anchor. A
  marker whose pin does not hold stays put and is reported, and
  `update --accept` moves it and re-pins. `add` refuses to write into a
  paragraph a misplaced marker splits. For a marker, `claim-moved` now also
  means the pinned text is intact but anchored over a different span.

## Problem

### What Maya does today

Maya cites a hard-wrapped paragraph. Before PR #43 she typed the line her
sentence starts on, and `add --marker` wrote the marker directly above that
line. When the sentence started mid-paragraph, so did the marker.

```mdx
Pages are checked one at a time, in the order the crawl found them.
{/* cite one-at-a-time */}
Each URL is loaded in a fresh browser context, so no state carries over
from one page to the next.
```

MDX ends a paragraph at a `{/* */}` line. That page renders two `<p>`
elements, the first ending "found them." CommonMark treats `<!-- -->` the
same way. A `[comment]: # (cite id)` line cannot interrupt a paragraph at all,
so it renders as literal text. On this repository's a11y overview, 27
paragraphs rendered split mid-sentence. The docs build passed, and nothing
leaked, so no check noticed.

### What PR #43 fixes, and what it leaves

PR #43 fixes the writer. A new marker goes above the paragraph holding the
lines. Stacked markers share that paragraph, and a marker-only line is never
part of a pin. A marker-only line also ends a paragraph, because that is how
MDX reads it.

It cannot fix a page it did not write. Every marker the old `add` placed
mid-paragraph is still there, and every marker placed by hand is too. Under
the new reading, most of their claims read `claim-changed`. The pin was taken
over a span the tool no longer reads, often one that held a sibling marker
line. So the check reports a reworded sentence where none was reworded, and
the page still renders split.

### What the recovery cost

Recovering this repository's 35 misplaced markers took four steps.

1. A hand-written script hoisted each marker run to the start of its
   paragraph.
2. The hoist shifted the lines under every claim-lines entry below it. A plain
   `manni cite update` rewrote 118 `claim-moved` entries.
3. The claims now read `claim-changed`. Most were re-anchored, and some had
   been reworded in prose PRs. Telling them apart meant diffing each claim's
   text against an older commit.
4. `manni cite update --accept --only <id>`, repeated for 68 ids, re-pinned
   the re-anchored ones.

In an earlier pass of the same dogfood, 92 claims read `changed` and 24 had
been edited. The other 68 were marker re-anchoring. Any team that ran
`add --marker` before #43 faces the same four steps. Theo, arriving on one of
those PRs, meets a `claim-changed` annotation on a sentence nobody touched.
T2 promises him one status and one action. Here the status is wrong and the
action is a script.

## Decision

### 1. What makes a marker misplaced

A **marker run** is one or more consecutive lines that each hold one marker
and nothing else, in any of the format's forms. A run is **misplaced** when
the line directly above it and the line directly below it are both unit
text. Deleting the run would then join them into one paragraph.

A line is **unit text** when it is none of these:

- blank;
- a fence line, or a line inside a fenced block;
- a marker-only line;
- a **bound line**, defined below.

A **bound line** is one the format makes a block on its own, so no paragraph
continues across it.

| Format | Bound lines |
|---|---|
| markdown, mdx | An ATX heading, which is one to six `#` and then a space or the end of the line. |
| asciidoc | A section title, which is one to six `=` and then a space. |
| every format | A line of one punctuation character repeated three or more times, spaces allowed. That covers a setext underline, a thematic break and an rst adornment. |

Bound lines join the paragraph reading PR #43 introduced, in `check`, `add`
and `update` alike. So `add --marker` on the line under a heading writes the
marker below the heading, not above it. Stress test 8 is why.

Three things are never misplaced.

- A marker whose own line carries text after its close. It sits inside the
  line it anchors, and it does not end a paragraph.
- A marker inside a fenced block or a backtick span. The scanner reads code
  as code, so it is not a marker.
- A run with a bound line, a blank line, a fence or the body's first line
  directly above it. That run is where `add` writes markers.

The rule applies to every format the tool reads. In HTML and XML a comment
inside an element does not split it when rendered. The tool's own reading
still ends the paragraph there, so the lines above the run are anchored by
nothing. Stress test 12 records that choice.

### 2. Where a misplaced marker belongs

A misplaced marker belongs where `add --marker` would write it today. There
is one placement rule, and `update` does not get a second.

| The marker's entry | Its place |
|---|---|
| Not `quote` | Directly above the first line of the unit holding the line below the run. Any markers already stacked there stay above it. |
| `quote: true` | Directly above the fenced block it anchors, below any markers already there. |

A moved marker takes the leading whitespace of the line it now sits above. A
run moves in its own order, so two markers that were stacked stay stacked.

### 3. What `check` reports

`check` adds one rule, and gives `claim-moved` a second meaning for a marker.

**`marker-misplaced`**, default `warning`, reported at the marker's line.
Each misplaced marker is one finding, so a run of three is three. An orphan
marker in a run is reported too, with no id, beside its `marker-orphan`.

The claim end of a misplaced marker's entry is read against three spans, in
this order. A span **holds** when it hashes to `claim.integrity`.

1. **The unit it belongs to.** The whole paragraph, markers skipped, as it
   will read once the marker moves. If this holds, the claim is `current`.
   Someone moved a correct marker by hand, and nothing else changed.
2. **The tail.** The text lines below the run through the end of the unit,
   markers skipped. That is PR #43's reading at the marker's current place.
3. **The pre-#43 span.** From the line below the marker through the next
   blank line or fence, marker lines included. That is how every marker
   before PR #43 was pinned, by `add` and by `update --accept` alike.

If span 2 or 3 holds, the claim is `claim-moved`. The pinned text is on the
page, and the marker now anchors a different span. If none holds, the claim
is `claim-changed`, as today.

A correctly placed marker is read against its current span, then the pre-#43
span. The second holding is `claim-moved` too. That covers pins taken over a
sibling marker line under stacked markers, which render fine and read
`claim-changed` today.

Span 3 costs one hash, and only when the current span did not hold. No git is
read, so a shallow clone gets the same answer.

`claim-moved` keeps its severity, `notice`. Its meaning row gains a sentence.

| Rule | Meaning | Default |
|---|---|---|
| `claim-moved` | The pinned page text is found verbatim at other lines, so nothing drifted. `update` rewrites `claim.lines`. For a marker, the pinned text is intact but the marker now anchors a different span, and `update` re-pins it there. | `notice` |
| `marker-misplaced` | A marker line sits inside a paragraph, between two lines of text. It splits the paragraph for the renderer and for the tool. `update` moves it to where `add --marker` writes markers. | `warning` |

`anchor-invalid` is unchanged. Stress test 1 is why the new case is not a
fourth branch of it.

### 4. What `update` does

`update` repairs a misplaced marker without a flag, as it repairs a moved
end. Every decision is taken against the page as it was read, before any
write.

| The entry's evidence | Without `--accept` | With `--accept` |
|---|---|---|
| No `claim` block | The marker moves. | The same. |
| `quote: true` | The marker moves. The block's pin does not change, so nothing is re-pinned. | The same. |
| Span 1 holds | The marker moves. The pin already covers its unit. | The same. |
| Span 2 or 3 holds | The marker moves, and `claim.integrity` is re-pinned over the unit. | The same. |
| No span holds | Skipped. The marker stays, and both findings are reported. | The marker moves, and `claim.integrity` is re-pinned over the unit. |
| A correctly placed marker whose pre-#43 span holds | `claim.integrity` is re-pinned over its current span. | The same. |

A re-pin over the unit can cover more lines than the old pin did. The report
names the lines newly pinned, so the widening is in the log as well as the
diff.

Four cases stay put without regard to `--accept`, and each is reported as
skipped.

- **An orphan, repeated or invalid marker.** It names no entry that can be
  checked, and `update` already never rewrites an anchoring finding.
- **An entry that is `anchor-invalid`.** It has both claim lines and a
  marker, and neither anchor can be trusted.
- **A claim-lines entry across the move.** An entry's `claim.lines` range
  holds a line of the run, or starts above the unit and reaches into it.
  Moving the marker would change that entry's pinned text.
- **A marker outside `--only`.** `--only <id>` selects entries, so it
  selects their markers. A run can move in part.

**Other entries shift with the text.** Moving a run of k lines up to line s
from line m moves lines s to m-1 down by k. Every claim-lines entry wholly
inside that range has its `claim.lines` rewritten, in frontmatter or in a
manifest. A quote marker moving down shifts the lines it passes up by k. No
`claim-moved` is left behind for the next run.

**Sidecar entries.** The marker is in the page and the entry is in the
manifest. `update` writes both, each once per run, as it already writes
manifests. A run that moves markers keeps every file's original text until
all writes land. If one write fails, the files already written are restored,
and the run exits 2. A file that cannot be restored is named.

**A page on stdin** is printed with its markers moved, as `update -` prints
every rewrite today. A manifest it names is still written.

### 5. What `add` refuses

`add` does not move a marker it did not write. It refuses, exit 2, to write
where a misplaced marker would make its entry wrong.

- **`--marker` into a split paragraph.** PR #43 would read the run as the
  paragraph's start. The new marker would join the misplaced run and pin only
  the tail.
- **Claim lines that hold a misplaced marker line.** The next `update` moves
  that line, which would change the pin `add` just wrote.

The refusal names the marker and the command that fixes it. A misplaced
marker anywhere else on the page does not stop `add`.

## The interface

### Config

No key is added. `severity:` accepts one more rule name, and its value set is
unchanged.

Before:

```yaml
cite:
  severity:
    claim-changed: error
```

After:

```yaml
cite:
  severity:
    claim-changed: error
    marker-misplaced: error   # optional; default warning
```

| Key | Type | Default | Required | Meaning |
|---|---|---|---|---|
| `cite.severity.marker-misplaced` | `error \| warning \| notice \| off` | `warning` | no | The severity of a marker line inside a paragraph. `off` stops the finding. `update` still moves the marker, because a move is repair and not a report. |

The rule list `severity:` validates against grows from fourteen names to
fifteen.

### Commands

No command, argument or option is added or removed. What changes is what
existing commands do.

| Command | Change |
|---|---|
| `manni cite check` | Reports `marker-misplaced`. Reads a marker's claim against the spans in Decision 3. |
| `manni cite update` | Moves misplaced markers, re-pins where a span holds, shifts claim lines, and reports each. |
| `manni cite add` | Refuses two writes, Decision 5. Reads bound lines when placing a marker. |

### Output of `check`

Every example below reads one page, `docs/a11y/index.mdx`, as the old
`add --marker` left it. Lines 40-46 are one paragraph, with a run of two
markers at lines 42 and 43.

`pretty`. A misplaced marker's claim column reads `marker :<line> -> :<place>`,
then the claim status. The row's mark is its worst finding, in the marks
`pretty` already uses: `↕` a warning, `ℹ` a notice.

```
⚠ docs/a11y/index.mdx
    ↕ one-at-a-time   marker :42 -> :40 current     src/a11y/core/crawl.ts:88-94 current
    ↕ fresh-context   marker :43 -> :41 moved       src/a11y/core/analyzer.ts:31 current
    ℹ host-scope      marker :57 moved              src/a11y/core/scope.ts:9-12 current
    ✓ host-list       marker :58 current            src/a11y/core/scope.ts:14 current
    ↕ robots          marker :70 -> :66 changed     src/a11y/core/sitemap.ts:12-19 current
    ↕ timeouts        marker :80 -> :77 current     src/a11y/core/crawl.ts:40 current
    ✓ retries         :77-81 current                src/a11y/core/crawl.ts:41-44 current

1 file checked, 1 passed, 0 failed, 7 findings (5 warnings, 2 notices)
```

`one-at-a-time` holds over its unit, so only the marker is wrong.
`fresh-context` holds over its tail, lines 44-46. `host-scope` is placed
correctly, above a sibling marker at line 58, and its pin held over that
sibling line. `robots` holds nowhere. `timeouts` holds over its unit, but
the claim-lines entry `retries` covers its marker line.

`json`. A marker-anchored citation gains a `marker` object. `misplaced` is
present only when the marker is. A marker claim at `claim-moved` carries the
span that held as `fileLines`, and the span it will anchor as `newLines`.

```json
{
  "id": "fresh-context",
  "origin": { "kind": "frontmatter", "file": "docs/a11y/index.mdx", "line": 9 },
  "anchor": "marker",
  "marker": { "line": 43, "misplaced": { "unit": "40-46", "to": 41 } },
  "claim": { "fileLines": "44-46", "newLines": "42-46", "status": "moved" },
  "source": { "src": "src/a11y/core/analyzer.ts:31", "status": "current" }
}
```

The finding has the shape every cite finding has.

```json
{
  "rule": "marker-misplaced",
  "ruleId": "manni:cite/marker-misplaced",
  "severity": "warning",
  "message": "fresh-context: the marker at line 43 splits the paragraph at lines 40-46. Its place is above line 40.",
  "line": 43,
  "id": "fresh-context",
  "src": "src/a11y/core/analyzer.ts:31"
}
```

`github`.

```
::warning file=docs/a11y/index.mdx,line=43,title=manni%3Acite/marker-misplaced::fresh-context: the marker at line 43 splits the paragraph at lines 40-46. Its place is above line 40.
::notice file=docs/a11y/index.mdx,line=44,title=manni%3Acite/claim-moved::fresh-context: the claim moved from lines 44-46 to lines 42-46.
```

`sarif`. One result per finding, `ruleId` `manni:cite/marker-misplaced`,
`level` `warning`, at the marker's line. The run's rule descriptors gain the
rule, with the meaning row above as its short description.
`partialFingerprints` match the baseline.

`junit`. A passing testcase with classname `manni.cite`, as every warning is.
Set to `error`, it is a `failure` of type `manni:cite/marker-misplaced`.

The messages, in every format:

| Case | Message |
|---|---|
| A misplaced marker | `<id>: the marker at line 43 splits the paragraph at lines 40-46. Its place is above line 40.` |
| A misplaced quote marker | `<id>: the marker at line 43 splits the paragraph at lines 40-46. Its place is above the block at line 52.` |
| An orphan in a run | `the marker at line 43 splits the paragraph at lines 40-46. Its place is above line 40.` |
| A marker's claim, moved | `<id>: the claim moved from lines 44-46 to lines 42-46.` |

The baseline fingerprint is the family's. The subject is the entry's `id`, so
moving the marker resolves the finding and re-pinning does not reopen one.

### Exit codes of `check`

Unchanged. `marker-misplaced` at its default never moves the exit code. Set
to `error`, an unbaselined one is exit 1.

### Output of `update`

`pretty`. Each rewrite is one line, in the order the page reads. Skipped
findings keep today's form. Over the same page:

```
docs/a11y/index.mdx: one-at-a-time marker line 42 -> 40 (misplaced)
docs/a11y/index.mdx: fresh-context marker line 43 -> 41 (misplaced)
docs/a11y/index.mdx: fresh-context claim re-pinned over lines 42-46 (moved; was lines 44-46, lines 42-43 newly pinned)
docs/a11y/index.mdx: page-order claim lines 40-41 -> 42-43 (shifted by a marker)
docs/a11y/index.mdx: host-scope claim re-pinned over lines 59-61 (moved; was lines 58-61, which held a marker line)
docs/a11y/index.mdx: robots  ↕ skipped: robots: the marker at line 70 stays, because its claim changed since it was pinned. update --accept moves it and re-pins.
docs/a11y/index.mdx: robots  ↕ skipped: robots: the claim at line 71 has changed since it was pinned.
docs/a11y/index.mdx: timeouts  ↕ skipped: timeouts: the marker at line 80 stays, because moving it would change the claim of retries (lines 77-81).
4 citations rewritten in 1 file, 3 skipped
```

The summary counts citations, so an entry whose marker moved and whose claim
was re-pinned counts once. A shifted entry counts once too.

With `--accept`, a skipped marker whose claim holds nowhere moves, and its
claim line reads as today's acceptance does.

```
docs/a11y/index.mdx: robots marker line 70 -> 66 (misplaced)
docs/a11y/index.mdx: robots claim at line 67 re-pinned (changed; now "The sitemap is read from robots.txt first, then /sitemap.xml.")
```

The skip messages:

| Case | Severity | Message |
|---|---|---|
| The claim holds nowhere | `marker-misplaced`'s | `<id>: the marker at line 70 stays, because its claim changed since it was pinned. update --accept moves it and re-pins.` |
| A claim-lines entry across the move | `marker-misplaced`'s | `<id>: the marker at line 80 stays, because moving it would change the claim of retries (lines 77-81).` |
| The same, when that entry has no id | `marker-misplaced`'s | `<id>: the marker at line 80 stays, because moving it would change the claim at lines 77-81.` |
| An orphan or repeated marker | its own rule's | `the marker at line 43 stays, because it names no entry update can check.` |
| An `anchor-invalid` entry | `anchor-invalid`'s | `<id>: the marker at line 43 stays, because the entry also has claim lines. Keep one.` |

A marker outside `--only` is not reported, as an entry outside `--only` is
not today.

`json`. `rewritten` entries gain values and two fields.

| Field | New values |
|---|---|
| `end` | `"marker"`, beside `"claim"` and `"source"`. |
| `reason` | `"re-anchored"` for a marker move or its re-pin. `"shifted"` for claim lines a move pushed. |
| `status` | `"misplaced"` for a marker move. `"current"` for a shift. |
| `from`, `to` | The file lines of a marker or a shifted claim. The pins of a re-anchored claim. |
| `lines`, `newLines` | The span that held and the span now pinned, on a re-anchored claim only. |

```json
{
  "id": "fresh-context",
  "index": 3,
  "line": 14,
  "end": "claim",
  "reason": "re-anchored",
  "status": "moved",
  "from": "sha256-5f0e21c4…",
  "to": "sha256-9a7d33b0…",
  "lines": "44-46",
  "newLines": "42-46"
}
```

### Exit codes of `update`

Unchanged. A skipped `marker-misplaced` is a warning and never exit 1. A
failed write that was restored is exit 2.

### The ladder

Rung 1 runs on its own page. Rungs 2 to 9 run in order over the repository
the Output sections read.

**1. The bare minimum.** One page written by the old `add --marker`.

```console
$ manni cite check docs/a11y/fix/index.mdx
⚠ docs/a11y/fix/index.mdx
    ↕ fix-order       marker :24 -> :22 current     src/a11y/commands/fix.ts:12-18 current

1 file checked, 1 passed, 0 failed, 1 finding (1 warning)
# exit 0

$ manni cite update docs/a11y/fix/index.mdx
docs/a11y/fix/index.mdx: fix-order marker line 24 -> 22 (misplaced)
1 citation rewritten in 1 file, 0 skipped
# exit 0
```

**2. Preview first, from config.** `update` writes by default, so a legacy
repository starts here. No paths, so every configured collection.

```console
$ manni cite update --dry-run
--- docs/a11y/index.mdx
+++ docs/a11y/index.mdx
@@ -40,7 +40,7 @@
+{/* cite one-at-a-time */}
+{/* cite fresh-context */}
 Pages are checked one at a time, in the order the crawl found them.
 A page that fails to load is reported, and the crawl moves on.
-{/* cite one-at-a-time */}
-{/* cite fresh-context */}
 Each URL is loaded in a fresh browser context, so no state carries over
…
4 citations rewritten in 1 file, 3 skipped
# exit 0
```

**3. The write.**

```console
$ manni cite update
docs/a11y/index.mdx: one-at-a-time marker line 42 -> 40 (misplaced)
docs/a11y/index.mdx: fresh-context marker line 43 -> 41 (misplaced)
docs/a11y/index.mdx: fresh-context claim re-pinned over lines 42-46 (moved; was lines 44-46, lines 42-43 newly pinned)
docs/a11y/index.mdx: page-order claim lines 40-41 -> 42-43 (shifted by a marker)
docs/a11y/index.mdx: host-scope claim re-pinned over lines 59-61 (moved; was lines 58-61, which held a marker line)
docs/a11y/index.mdx: robots  ↕ skipped: robots: the marker at line 70 stays, because its claim changed since it was pinned. update --accept moves it and re-pins.
docs/a11y/index.mdx: robots  ↕ skipped: robots: the claim at line 71 has changed since it was pinned.
docs/a11y/index.mdx: timeouts  ↕ skipped: timeouts: the marker at line 80 stays, because moving it would change the claim of retries (lines 77-81).
4 citations rewritten in 1 file, 3 skipped
# exit 0
```

**4. The CI format.** What is left, as PR annotations.

```console
$ manni cite check -f github
::warning file=docs/a11y/index.mdx,line=70,title=manni%3Acite/marker-misplaced::robots: the marker at line 70 splits the paragraph at lines 66-72. Its place is above line 66.
::warning file=docs/a11y/index.mdx,line=71,title=manni%3Acite/claim-changed::robots: the claim at line 71 has changed since it was pinned.
::warning file=docs/a11y/index.mdx,line=80,title=manni%3Acite/marker-misplaced::timeouts: the marker at line 80 splits the paragraph at lines 77-83. Its place is above line 77.
# exit 0
```

**5. The reworded remainder.** Read the text, then accept one id.

```console
$ manni cite check --show-diff docs/a11y/index.mdx
⚠ docs/a11y/index.mdx
    ↕ robots          marker :70 -> :66 changed     src/a11y/core/sitemap.ts:12-19 current
        The sitemap is read from robots.txt first, then /sitemap.xml.
    ↕ timeouts        marker :80 -> :77 current     src/a11y/core/crawl.ts:40 current

1 file checked, 1 passed, 0 failed, 3 findings (3 warnings)
# exit 0

$ manni cite update --accept --only robots docs/a11y/index.mdx
docs/a11y/index.mdx: robots marker line 70 -> 66 (misplaced)
docs/a11y/index.mdx: robots claim at line 67 re-pinned (changed; now "The sitemap is read from robots.txt first, then /sitemap.xml.")
1 citation rewritten in 1 file, 0 skipped
# exit 0
```

`--show-diff` prints the lines the claim covers now, as it does today, and
`pretty` hides current rows only under `-q`. The `retries` row is left out
here for length.

**6. The scripting form.**

```console
$ manni cite check -f json docs/a11y/index.mdx | jq '[.pages[].findings[] | select(.rule == "marker-misplaced")] | length'
1
# exit 0
```

**7. A team that wants it to fail.** Config sets `marker-misplaced: error`.

```console
$ manni cite check -f sarif > cite.sarif
# exit 1
```

**8. Every option at once.** `timeouts` stays, whatever `--accept` says.

```console
$ manni cite update --collection site --ext md,mdx --exclude "**/drafts/**" \
    -c manni.config.yaml --no-gitignore --allow-empty --root . \
    --accept --only timeouts --only robots --dry-run -f json
{ "pages": [ … ], "rewritten": 0, "skipped": 1, "exitCode": 0 }
# exit 0
```

**9. `add` into the paragraph that is still split.**

```console
$ manni cite add docs/a11y/index.mdx:82 src/a11y/core/crawl.ts:46 --id retry-once --marker
manni: docs/a11y/index.mdx:82 is in the paragraph at lines 77-83, which the marker at line 80 splits. Run manni cite update first.
# exit 2
```

### The usage errors

| Invocation | stderr | Exit |
|---|---|---|
| `add docs/a11y/index.mdx:82 <src> --id retry-once --marker`, into a split paragraph | `manni: docs/a11y/index.mdx:82 is in the paragraph at lines 77-83, which the marker at line 80 splits. Run manni cite update first.` | 2 |
| `add docs/a11y/index.mdx:78-82 <src>`, lines holding a misplaced marker | `manni: docs/a11y/index.mdx:78-82 holds the marker at line 80, which splits its paragraph. Run manni cite update first.` | 2 |
| `update --reanchor` | `error: unknown option '--reanchor'` | 2 |
| `severity: {marker-mispaced: error}` | `manni: Unknown key "marker-mispaced" under cite.severity: in manni.config.yaml. Supported keys: …, marker-misplaced, ….` | 2 |
| `severity: {marker-misplaced: fatal}` | `manni: cite.severity.marker-misplaced in manni.config.yaml must be one of error, warning, notice, off, not "fatal".` | 2 |
| `update`, a manifest write fails after its page was written | `manni: docs-citations.yaml could not be written (EACCES). docs/a11y/index.mdx was restored.` | 2 |
| `update`, a restore fails too | `manni: docs-citations.yaml could not be written (EACCES). docs/a11y/index.mdx could not be restored, and holds the moved markers.` | 2 |

Every other usage error is `update`'s and `check`'s today, with the same text.

### The programmatic API

The `cite` namespace of `src/index.ts` changes in five places. Nothing is
removed.

| Export | Kind | Change |
|---|---|---|
| `cite.CiteRule` | type | Gains `"marker-misplaced"`. |
| `cite.DEFAULT_SEVERITY` | const | Gains `"marker-misplaced": "warning"`. |
| `cite.UpdateRewrite` | type | `end` gains `"marker"`. `reason` gains `"re-anchored"` and `"shifted"`. `status` gains `"misplaced"` and `"current"`. Gains optional `lines` and `newLines`. |
| `cite.CitationResult` | type | Gains optional `marker`, with `line` and optional `misplaced: { unit, to }`. |
| `cite.paragraphAfter`, `cite.anchoredLines` | function | Stop at a bound line, as Decision 1 says. |

## Stress test

What was tried against this design, and what each attempt changed.

### 1. Fold it into `anchor-invalid`

`anchor-invalid` already names anchors that cannot work, and a fourth case
would add no rule name. But it defaults to `error`, and it means the anchor
is broken. A misplaced marker still anchors something, just less than the
author meant. Folding would also tie two severities together. A team could not
turn misplacement off without turning off real anchoring errors.

**Changed as a result:** a rule of its own, `marker-misplaced`, at `warning`.
The fourteen rule names become fifteen.

### 2. A `--reanchor` flag

The dogfood notes asked for `cite update --reanchor`. The tool can tell a
misplaced marker from a placed one by reading two lines. "Detect, don't
switch" rules out a flag for that. The flag would also be a second repair
verb beside `update`'s own, which already repairs what it can prove.

The real objection to no flag is that `update` writes by default. A legacy
repo's first `update` after upgrading moves markers nobody asked it to move.
That risk is bounded three ways. A move happens only when the pin proves the
text is intact. A moved comment line changes no rendered text except to
rejoin a paragraph. And `--dry-run` shows every diff, as the caution on the
reference page already says.

**Changed as a result:** no flag. The repair rides `update`, gated by the
pin. The claim-changed case waits for `--accept`, as every changed end does.

### 3. Evidence from the pin, or from git

The claim is not copied, so "otherwise unchanged" needs evidence. Two
sources exist. Git could show the page at the commit the entry was added in,
which is 0053's ground. The pin can be recomputed over the span the marker
used to anchor.

Git alone does not answer the question. Knowing the old page still leaves
which span the pin was taken over, and that is a reading, not a fact in
history. The pin answers exactly that, in one hash, with no history. It also
works in a shallow clone, which `actions/checkout` gives by default. Git
answers the next question better: what changed in the reworded remainder.

**Changed as a result:** the pin decides. 0053, when it lands, shows the
remainder's diff under `--show-diff`. Neither proposal waits on the other.

### 4. A re-pin that covers lines nobody reviewed

A marker mid-paragraph was pinned over its tail. After the move it anchors
the whole paragraph, so the new pin covers head lines the old one never did.
Those lines were never checked against the source.

Refusing to widen would leave no repair at all, because a marker cannot
anchor half a paragraph. Requiring `--accept` would put the 68 re-anchored
claims back into the review queue they were never in. The head lines are what
`add --marker` pins for a new citation today. Pinning them now also makes a
later edit to them visible, where before it was not.

**Changed as a result:** the re-pin widens without `--accept`. The report
names the newly pinned lines. Open question 1 asks whether that is right.

### 5. A stacked run where one pin holds and one does not

Two markers sit mid-paragraph together. One claim is intact and one was
reworded. Moving the run as a block would move the reworded one without
review. Holding the run back would leave the intact one split.

**Changed as a result:** each marker moves on its own evidence. The run can
split, and the page then carries a smaller misplaced run until
`update --accept` settles it.

### 6. A quote marker mid-paragraph

A quote marker anchors the next fenced block after it, wherever that is.
Moving it to the paragraph start keeps the same block, and so does moving it
down to the block. PR #43's `add --quote --marker` writes it directly above
the block.

**Changed as a result:** a quote marker's place is above its block. Its pin
covers the block, which the move does not touch, so it is never re-pinned. The
lines it passes shift up, and claim-lines entries there are rewritten.

### 7. A marker between list items, or between table rows

The tool reads a paragraph as consecutive non-blank lines. So a list with no
blank lines between items is one unit, and so is a table. A marker-only line
between two items ends the list in MDX and in CommonMark. Between two table
rows it ends the table.

**Changed as a result:** nothing in the rule. Both are misplaced, and both
move to the top of the unit. The claim widens to the whole list or table,
which is what `add --marker` pins on those lines today.

### 8. A heading directly above the marker

`## Crawl scope`, then a marker line, then text, with no blank lines. The
line-based reading joins the heading to the text, so the first draft called
the marker misplaced. It would have hoisted the marker above the heading and
pinned the heading. PR #43's `add --marker` has the same flaw on such a page.

**Changed as a result:** bound lines. A heading, a setext underline, a
thematic break or an rst adornment ends a unit in every reading. `add`,
`check` and `update` read the same units, so a heading is never inside a
claim's paragraph.

### 9. A marker inside JSX, or indented under a list item

An MDX `<Aside>` whose children follow the opening tag with no blank line
makes the tag line part of the unit. The marker's place is then above
`<Aside>`, which is valid MDX, and the tag line is pinned. With a blank line
after the tag, the place is inside the element, above the text, which is
valid too. An indented marker under a list item keeps the indentation of the
line it moves above.

**Changed as a result:** leading whitespace follows the line below the new
place. JSX gets no reading of its own. Open question 3 asks whether the tag
line belongs in a pin.

### 10. A sidecar entry, and a write that fails halfway

The marker is in the page and the pin is in the manifest. If the page is
written and the manifest is not, the marker anchors the unit while the pin
still covers the tail. The claim then reads `claim-changed`, and no span
holds any more. The evidence that the text was intact is gone.

**Changed as a result:** a run that moves markers keeps each file's original
text. A failed write restores the files already written, and exits 2. A file
that cannot be restored is named, with what it now holds.

### 11. A claim-lines entry that covers the marker line

An entry pinned by `claim.lines` over lines 40-45 includes a marker-only line
at 43. Moving that line changes the entry's pinned text, so its own check
would turn `claim-changed`.

**Changed as a result:** the marker stays, and the skip names the entry.
`add` refuses to write such a range in the first place, Decision 5. An entry
already written that way is settled by re-adding it after the move.

### 12. HTML, where a comment never splits a paragraph

A `<!-- cite id -->` line inside a `<p>` renders as one paragraph. The first
draft left HTML and XML out of the rule for that reason. But the tool's own
reading ends the paragraph at a marker-only line in every format. The lines
above the marker are then anchored by nothing, and a later `add --marker`
there would stack onto it.

**Changed as a result:** the rule applies to every format. The message says
the marker splits the paragraph, which is true of the tool's reading
everywhere and of the renderer in most formats.

### 13. Stacked markers whose pins include a sibling line

`add --marker` before PR #43 put a second marker between the first and its
paragraph. Agents then ran `update --accept`, which re-pinned the first over
the second's marker line and the paragraph. Those markers are placed
correctly and render fine. PR #43 skips marker lines, so they read
`claim-changed`.

**Changed as a result:** the pre-#43 span is read for every marker, not only
misplaced ones. When it holds, the claim is `claim-moved`, and `update`
re-pins it over the current span with no flag. The skipped lines are marker
lines only, so no text enters or leaves the pin.

### 14. `add` could move the marker instead of refusing

`add` already shifts other entries' claim lines when it writes a marker. It
could also move a misplaced marker it meets. But moving needs the evidence in
Decision 3, and a claim that holds nowhere needs a review `add` cannot ask
for. Two writers would then carry one repair.

**Changed as a result:** `add` refuses, and the message names
`manni cite update`. The refusal covers only the paragraph `add` writes into.

### 15. The severity on upgrade

At `error`, the first CI run after upgrading would fail every repo with a
legacy marker, for a page that was fine yesterday. D5 promises a gate that
does not block on prose. At `notice`, a split rendered paragraph would be
easy to miss. It is a visible defect on a published page.

**Changed as a result:** `warning`. It annotates the PR, and `update` clears
it in one command. A team that wants it to fail sets `error`.

### 16. The pre-#43 span as permanent code

The third span exists only for pins minted before PR #43. Once every legacy
pin is re-pinned, it never holds again. It costs one hash, and only on a claim
whose current span did not hold, so it is cheap. But it is a reading the tool
carries for a history most repositories do not have.

**Changed as a result:** it stays, with a test that names the PR it serves.
Retiring it is a later decision, and it would change what `claim-changed`
means for any page not yet updated. Open question 2.

### 17. A baselined finding

A team ramps in with `--write-baseline`, recording 35 `marker-misplaced`
findings. `update` moves the markers. The fingerprint subject is the `id`,
so the recorded findings no longer occur, and the re-pin reopens nothing.

**Changed as a result:** nothing. The family fingerprint already behaves.

### 18. A marker that carries its text on its own line

`{/* cite one-at-a-time */} Each URL is loaded in a fresh browser context.`
sits inside the paragraph, and MDX reads it as an inline expression. It does
not end the paragraph for the renderer or for the tool.

**Changed as a result:** never misplaced, Decision 1. Only a marker-only line
can split a paragraph.

### 19. What the dogfood recovery would have been

This was worked through on paper against the four steps in the Problem. It
was not run, because nothing here is built. A plain `update` moves each marker
whose pin holds. It shifts the claim-lines entries below in the same write,
and re-pins the re-anchored claims. No `claim-moved` is left for a second
run. The reworded remainder reads `claim-changed` beside `marker-misplaced`.
`check --show-diff` shows each one, and `update --accept --only <id>` settles
it.

**Changed as a result:** the Verification section replays the a11y overview
from its pre-#43 commit, so the count is measured rather than argued.

## Verification

- `test/cite/statements.test.ts` covers bound lines per format, marker runs,
  and the three spans.
- `test/cite/check.test.ts` covers `marker-misplaced` per format, a quote
  marker, an orphan in a run, and each claim outcome in Decision 3.
- `test/cite/update.test.ts` covers each row of Decision 4's table, a split
  run and `--only`. It also covers a shifted claim-lines entry, one across the
  move, a sidecar entry, and a restored failed write.
- `test/cite/add.test.ts` covers both refusals, and a marker written under a
  heading.
- Fixtures under `test/fixtures/cite/misplaced/` hold one page per case,
  named for it: `mid-paragraph.mdx`, `stacked-run.mdx`, `quote-mid.md`,
  `list-items.md`, `under-heading.md`, `pre-43-sibling-pin.mdx`.
- A replay test checks out the a11y overview as it stood before PR #43. One
  `update` leaves no `marker-misplaced`, no `claim-moved`, and only the
  reworded claims as `claim-changed`.
- `node dist/cli.js cite check` stays clean on the repository's own docs.
- Every reporter's sentinel test runs over a misplaced marker with an
  encrypted source.

## Not breaking

- No key, flag or command is added or removed.
- The new rule is a warning, so no exit code moves by default.
- A correctly placed marker whose pin holds reads exactly as before.
- A claim that read `claim-changed` may now read `claim-moved`, a notice.
  That lowers a severity, and only where the pinned text is intact.
- `add` refuses two writes that would have written a pin the next `update`
  breaks.
- Bound lines change where `add --marker` writes under a heading with no
  blank line. The old place pinned the heading.

The commit is `feat(cite):`, a minor release. It ships a demo video, per the
house rule. The demo is the a11y overview, split, then `cite update`, then
rendered whole.

## Consequences

- PR #43's reference pages gain the rule row, the widened `claim-moved`
  meaning, bound lines, and the two `add` refusals.
- T2's fix page gains `marker-misplaced`: one status, one command.
- The set-up page for markers says where a marker goes and why, so a
  hand-written one lands in place.
- Open questions for the review, in the order debate is expected:
  1. Should a re-pin that widens the pin need `--accept`, given the widened
     lines were never checked against the source?
  2. Should the pre-#43 span expire, for example at the next major release?
  3. Should a JSX tag line that opens a unit be excluded from a pin, or is
     that a reading MDX alone needs?
  4. Should `update` move a marker whose claim holds nowhere, leaving the
     `claim-changed` for review? It fixes the rendering sooner. It also loses
     the tail, the one span a later reviewer could compare.
