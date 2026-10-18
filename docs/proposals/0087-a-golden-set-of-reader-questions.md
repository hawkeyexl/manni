# 0087: A golden set of reader questions, pinned to their answers

- **Status:** Proposed
- **Serves:** Three groups of readers.
  - Maya · M18 and M20. She wants a golden set of the questions readers ask,
    so a search or a docs bot can be held to it.
  - Devin · D12, "Gate the graph in CI". A golden set has to stay true to gate
    anything.
  - Teams with their own docs bot, such as Kapa, Inkeep or a homegrown RAG.
    They evaluate with Ragas, DeepEval or promptfoo, and build that dataset by
    hand.
- **Depends on:** Two earlier proposals.
  - [0086](0086-one-concept-scheme-from-termbase-to-graph.md) § 7 made each
    page's `sample-questions` a findability check in `graph check`.
  - [0044](0044-citations-and-drift.md) is cite's pin: lines, a hash over them, and a
    search that finds them again when they move.
- **Relates to:** Two records.
  - [ADR 01016](docevals/01016-golden-cases-are-seeded-from-reviews-and-gated-on-human-confirmation.md) says a generated set is
    "a candidate list, not a golden set" until a person confirms it.
  - [0046](0046-provenance-pins.md) keeps machine attribution in `meta-provenance`.
- **Supersedes, in part:** [0086](0086-one-concept-scheme-from-termbase-to-graph.md)
  § 7, in one mechanism only. `graph check` read the questions from the graph's
  derived literals, and now reads them from the page sources. Its Status line
  is the only edit.
- **Touches:** `src/meta/schemas/ai-context/1.1.0.json` (new),
  `src/meta/core/` (`schema-registry.ts`, `resolve-schema.ts`),
  `src/shared/pin.ts`, `src/graph/core/` (`questions.ts` new, `derive.ts`,
  `analyze.ts`, `config-schema.json`, `config.ts`, `coverage.ts`),
  `src/graph/runtime/resolve.ts`, `src/graph/commands/` (`questions.ts`,
  `check.ts`, `stats.ts`, `fill.ts`, `fill-questions.ts` new, `export.ts`),
  `src/graph/llm/` (`prompt.ts`, `cache.ts`, `provider.ts`),
  `src/graph/cli.ts`, `docs/src/content/docs/`, `test/`
- **Verdict:** A sample question can pin the lines that answer it, with cite's
  pin, so it fails when the answer changes. A golden-set file holds questions
  that span pages or have no answer. `graph fill` drafts questions and pairs
  existing ones with their answers, marked unreviewed. `graph check` reports
  the set's health and can gate on a found rate. `graph export questions` hands
  the set to outside eval tools. manni judges no answers.

## Problem

### Nobody writes the questions

The docs site has hand-written questions on about 184 pages. A new corpus has
none, and three questions on each of 200 pages is a week of typing. No manni
verb drafts them.

### Found the page is a weak claim

A 4,000-word reference page that ranks first for every question proves nothing
about the paragraph that answers it. Search indexes sections, not just pages,
and so do RAG chunkers.

### Some questions span pages, and some have no answer

"After rotating the key, how do I check nothing broke?" needs two pages. "Does
manni run on Windows on ARM?" needs none. Neither fits in one page's
frontmatter.

### Questions rot silently

A page is rewritten, and the answer moves or disappears. The question still
finds the page, and nothing says so. None of the tools surveyed ties an item
to the span that answers it. That survey covered Ragas, DeepEval, LangSmith,
Langfuse, Opik and Bedrock.

### There is no state to watch

0086 reports misses one by one. There is no count of how many questions are
found, how many are stale, or how many a model drafted that nobody read.

### Drafted questions are not golden

ADR 01016 already calls a generated set a candidate list until a person
confirms it. A 300-question draft must not turn CI red over questions nobody
reviewed.

## Design

The work lands as four PRs on the 0086 stack, before its docs PR.

| Phase | What lands |
|---|---|
| 7a | ai-context 1.1.0, where a page question can pin its answer. `graph check` finds the answer's section and reports answers that moved or changed. |
| 7b | Golden-set files under `graph.questionFiles`. Set health in `graph check`, with a summary and `foundThreshold`. Question coverage in `graph stats`. |
| 7c | `graph fill` drafts questions, pairs existing ones, and re-pins moved answers. |
| 7d | `graph export questions`. |

### 1. A page question can pin its answer

`manni:ai-context:1.1.0` lets each `sample-questions` item be a string or an
object.

```yaml
# before (1.0.0): a string, or a list of strings
sample-questions:
  - How do I retry a failed upload?

# after (1.1.0): each item is a string or an object
sample-questions:
  - How do I retry a failed upload?              # this page must be found
  - question: How many times does an upload retry by default?
    answers:
      - lines: 41-43                             # body lines, as cite counts them
        integrity: sha256-9f2c…                  # written by graph fill
  - question: How do I resume an upload?         # a person's question, paired by graph fill
    answers:
      - lines: 70-72
        integrity: sha256-77d1…
        reviewed: false                          # the pin is unconfirmed; the question is not
  - question: What happens when an upload is over the size limit?
    answers:
      - lines: 58-60
        integrity: sha256-1ab0…
    generated-by: anthropic/claude-sonnet-5-5    # written by graph fill
    confidence: 0.82
    reviewed: false                              # the whole item is a draft
```

| key | type | default | required | meaning |
|---|---|---|---|---|
| item | string or object | | | A string is a question this page must be found for. An object can also say which lines answer it. |
| `question` | string | | yes | The question, as a reader would ask it. |
| `answers` | list of pins | none | no | The lines on this page that answer it. Without it, the page itself must be found. |
| `answers[].lines` | `N` or `"N-M"` | | yes | Body lines, 1-based, counted exactly as cite's `claim.lines`. |
| `answers[].integrity` | `sha256-<64 hex>` | none | no | The hash of those lines under cite's rule. Without it, the pin is not checked for change. |
| `answers[].reviewed` | boolean | `true` | no | `false` marks a pin nobody has confirmed, on a question that is itself confirmed. |
| `generated-by` | string | none | no | The model that drafted the question or any of its pins, as `provider/model`. |
| `confidence` | number 0-1 | none | no | The model's confidence. Written by `graph fill`. |
| `reviewed` | boolean | `true` | no | `false` marks a drafted question, and its pins are drafts with it. |
| `reviewed-by` | string | none | no | Who confirmed it. An optional record, as on docevals golden cases. |

- **Absent `reviewed` means `true`.** ADR 01016 read an absent key as `false`,
  because its tool wrote seeded cases without one. Here only `graph fill`
  drafts, and it always writes `false`. So the 184 hand-written questions
  count from day one.
- **Review state lives at two levels, under one name.** Pairing a person's
  question must not demote it. So `graph fill` marks only the new pin
  unreviewed.
- **A field, not `meta-provenance`.** A pointer such as `/sample-questions/3`
  names a different question once question 1 is deleted. The review state has
  to travel with the question.
- **The schema.** 1.1.0 is a minor version, because it only accepts more. It
  replaces 1.0.0 in the default set. `manni:ai-context-strict:1.0.0` never
  constrains `sample-questions`, so it stays the overlay `strict` stacks beside
  1.1.0.
- **Derive.** `graph build` derives only the `question` text, as the
  `graph:sampleQuestion` literal 0086 defined. Pins and review state are test
  data, so the published graph does not change.

### 2. What `graph check` does with questions

`check` reads questions from the page sources, not from the graph. This is the
one mechanism of 0086 § 7 that 0087 supersedes. Pins and review state never
reach the graph, so the source is the only place they live.

- **Reading.** `check` resolves each page's source the way `graph export
  search` does. It reads `sample-questions` with the metadata reader `build`
  uses, manifests included.
- **One visible effect.** A question on a field marked `x-manni-graph-output:
  false` stays out of the graph and is still checked.
- **A page not on disk.** Its questions are skipped, with one warning per run,
  and the exit code is unaffected.

```text
manni: 2 pages in the graph are not on disk, so their questions were not checked; run manni graph build.
```

A question is found as follows.

- **Unpinned.** A hit on its page, or on any section of it, is in the top
  `top`. This is 0086's test.
- **Pinned.** The top `top` holds a hit on a node whose own text overlaps the
  pinned lines. A section owns its text from its heading to the next heading
  of any rank. Text before the first heading belongs to the page node. So a
  hit on an unrelated section does not count.
- **Several answers.** Each must be found, and each miss is its own finding.

Lines map to nodes in body lines, which cite's `bodyLineOf` counts. That
function moves from `src/cite/core/page.ts` to `src/shared/pin.ts`. Markdown
and MDX sections are located by `headingKey` and `sectionOccurrences`. HTML,
DITA, AsciiDoc and rST sections use the lint tree's positions, as the search
index already does.

`check` compares each pin with the page as it is now. It uses cite's hashing
rule and its whole-line move search, `findWindows`.

| finding | severity | message |
|---|---|---|
| not found (0086) | `questions.severity` | `"How do I retry a failed upload?" does not find this page in the top 5 (it ranks 12; first is docs/uploads/limits.md)` |
| not found, pinned | `questions.severity` | `"How many times does an upload retry by default?" does not find the section that answers it, § Retry limits, in the top 5 (it ranks 9; first is docs/uploads/limits.md § Quotas)` |
| answer moved | notice | `the answer to "How many times…" moved from lines 41-43 to 47-49, so manni graph fill --fields sample-questions re-pins it.` |
| answer moved, ambiguous | warning | `the answer to "How many times…" moved, and lines 47-49 and 88-90 both match, so pin one of them by hand.` |
| answer changed | `questions.severity` | `lines 41-43 no longer hold the answer to "How many times…" as pinned, so re-pair it with manni graph fill --fields sample-questions and review it.` |
| drafted, any of the above | notice | the same message, ending `(drafted, not reviewed)` |

- **Moved.** The answer is checked at its new lines, and only the file is out
  of date. A notice, as cite's `claim-moved`.
- **Ambiguous.** Either match counts as found. A warning, as cite's
  `claim-moved-ambiguous`.
- **Changed.** It counts as not found, and is not asked. The test means
  nothing once the lines have changed.
- **A confirmed question with a drafted pin.** It is held to 0086's page test
  at full severity. The pinned result reports at notice, ending `(answer not
  reviewed)`, until the pin is confirmed.
- **Severity.** `answer changed` shares the 0086 knob, because a stale golden
  item and a missed one are both the set failing. `off` silences every finding
  on that knob, drafted copies included. The moved notices are not on the
  knob. Drafted questions report at notice whatever the knob says.
- **Messages before 7c.** `graph fill` learns to re-pin in 7c. Until then, the
  moved and changed messages end `…so update its lines.` and `…so re-pin it
  and review it.` 7c rewrites them as in the table.
- **Finding shape.** 0086's shape is kept. The focus node is the page, the
  path is `graph:sampleQuestion`, and the page is in `docs`.

7a adds no config keys or flags.

### 3. Golden-set files, and set health

```yaml
# before (after 0086)
graph:
  check:
    shapes: []
    questions:
      top: 5
      severity: warning

# after
graph:
  questionFiles: [docs/questions.yaml]   # new
  check:
    shapes: []
    questions:
      top: 5
      severity: warning
      foundThreshold: 95                  # new; percent 0-100, or null
```

| key | type | default | required | meaning |
|---|---|---|---|---|
| `graph.questionFiles` | list of paths | `[]` | no | Golden-set files, relative to the config file. They hold questions that span pages or that the docs don't answer. |
| `graph.check.questions.foundThreshold` | number 0-100, or null | `null` | no | `check` exits 1 when the percentage of reviewed questions found falls below this. `null` means no rate gate. |

The found rate counts reviewed questions that have a test, a page or at least
one pin. Gaps and drafts are left out. A multi-answer question is found only
when every answer is. A changed or missing answer counts as not found.

A golden-set file is a list of the page item's object form, plus two keys.

```yaml
- question: After rotating the key, how do I check nothing broke?
  answers:
    - file: docs/key/rotate.md
      lines: 12-15
      integrity: sha256-…
    - file: docs/meta/validate.md
      lines: 30-31
      integrity: sha256-…
- question: Does manni run on Windows on ARM?
  answers: []                      # the docs don't answer it, a known gap
- question: Wie rotiere ich den Schlüssel?
  language: de                     # optional
  answers:
    - { file: docs/de/key/rotate.md, lines: 9-11, integrity: sha256-… }
  generated-by: anthropic/claude-sonnet-5-5
  reviewed: false
```

- **Two more keys.** `answers[].file` is required, relative to the config
  file. `language` is optional. It falls back to the first answer's page
  language, then the corpus default.
- **`answers` is required in the file.** An empty list marks a known gap.
- **Gaps are not retrieval-checked.** Search has no score floor, so "this
  should find nothing" is not a deterministic test. Gaps are counted, and
  exported as unanswerable.
- **Validation.** Each file is checked against a JSON Schema shipped with
  graph, `src/graph/core/questions-schema.json`.
- **Never published.** Nothing from a golden-set file is derived.

| finding | severity | message |
|---|---|---|
| not found, file question | `questions.severity` | `"After rotating the key, how do I check nothing broke?" does not find docs/meta/validate.md § Check the result in the top 5 (it ranks 14; first is docs/key/rotate.md § Rotate)` |
| answer gone | `questions.severity` | `docs/uploads/old.md, which holds the answer to "…", does not exist, so re-pin or remove the question.` |
| duplicate question | `questions.severity` | `"How do I retry a failed upload?" is also asked on docs/uploads/limits.md, so keep it where it is answered.` |
| copies its answer | notice | `"Do uploads retry three times by default?" repeats 5 of its 6 word pairs from its answer, so it tests matching words more than finding.` |
| found rate under `foundThreshold` | error | `280 of 288 reviewed questions are found in the top 5 (97%), under the 98% that graph.check.questions.foundThreshold asks for.` |

- **Duplicates.** Questions are compared ignoring case, punctuation and
  repeated spaces, across every page and file. The finding goes on each copy
  after the first, in path order.
- **Copied wording.** It is the share of the question's adjacent word pairs
  that also appear in its answer lines. The threshold is a fixed 0.5. A
  question with no pin, or under two words, is never measured.
- **Where findings point.** A file question's focus node is `<file>:<line>` of
  its item, with no path. The rate finding's focus node is `questions`.
- **At `off`.** The questions are still asked, so the summary and the rate gate
  still count them. Only the findings on the knob go quiet.

| case | stderr | exit |
|---|---|---|
| a listed file is missing | `manni: graph.questionFiles names docs/questions.yaml, which does not exist.` | 2 |
| a file fails its schema | `manni: docs/questions.yaml: /2/answers/0 must have required property 'lines'.` | 2 |

`check` already asks every question, so the health summary lives there, and
`stats` runs no search.

```text
$ manni graph check
…

questions  431: 288 reviewed, 143 drafted, on 142 pages and in docs/questions.yaml
  found    280 of 288 reviewed in the top 5 (97%), 204 first (71%)
  drafted  121 of 143 in the top 5, not counted until reviewed
  answers  296 pinned, 40 not reviewed: 282 current, 9 moved, 5 changed; 131 not pinned
  gaps     4 questions the docs don't answer

0 errors, 1 warning, 0 notices
```

The summary prints only when some question exists. A gap counts as reviewed
or drafted like any question, and never under `found`. The `drafted` row
prints only when a draft has a test, and the `gaps` row only when a gap
exists. Percentages round down, so a rate under a threshold never prints as
the threshold. Under `-f github` it prints after the annotations, as plain
text.

A file question's moved and changed messages name the answer's page, because
its answers can sit on several. They read `the answer to "…" in
docs/key/rotate.md moved from lines 12-15 to 14-17` and `lines 12-15 of
docs/key/rotate.md no longer hold the answer`. An answer whose page is on disk
but in no collection the graph was built from is reported as not found. The JSON report gains one
`questions` key beside `findings`, with the same counts. Stored per CI run,
that object is the time series. manni keeps no history of its own.

`graph stats` gains question coverage. `sample-questions` joins the document
coverage fields, so "pages with a question" is ordinary coverage. It is gated
only when the per-field `coverageThreshold` map names it. `stats` also lists
concepts with no question, which is reported and never gated, like orphans.
Its JSON gains `conceptsWithoutQuestions`.

### 4. `graph fill` drafts, pairs and re-pins

`sample-questions` joins the default fill fields. A config that lists
`graph.fill.fields` does exactly what it did before. Questions run in a pass
beside the `graph:` field pipeline, with their own completeness rule, cache
key and prompt. A page is complete when it has `perPage` questions, each one
paired, and no answer moved or changed.

1. **Re-pins, with no model.** A moved answer gets its new `lines`, on pages
   and in golden-set files. A pin with no `integrity` gets one. An ambiguous
   move is left alone.
2. **Pairs.** For a question with no `answers`, the model quotes the passage
   that answers it. The tool finds the quote in the body and pins the whole
   lines it touches. The new pin is written `reviewed: false`.
3. **Re-pairs.** A changed answer gets a new pin the same way, written
   unreviewed, because the verdict changed.
4. **Drafts.** A page with fewer than `perPage` questions gets new ones,
   written `reviewed: false`, with `generated-by` and `confidence`. The prompt
   names the page's concepts by their labels and alt-labels.

The gates run mechanical first.

| gate | outcome | reason shown |
|---|---|---|
| the quote is not in the page | dropped | `answer not on page` |
| it duplicates a question anywhere in the set | dropped | `duplicate of <file>` |
| it repeats over half its word pairs from its answer | dropped | `copies its answer (5 of 6 word pairs)` |
| the model finds no passage for an existing question | kept, not paired | `no passage answers it` |
| confidence under the threshold | not written | `low confidence, not written` |

There is no findability gate. Dropping drafts the retriever can't find would
keep only the easy questions, which is teaching to the test.

```yaml
graph:
  fill:
    confidenceThreshold: 0.7
    writeProvenance: true
    chunkChars: 12000      # new; integer >= 1
    offline: false         # new; boolean
    questions:
      perPage: 3           # new; integer >= 1
```

`--chunk-chars <n>` overrides `graph.fill.chunkChars`, with `meta fill`'s name
and bounds. Pretty output adds one line per question under its page. JSON
gains a `questions` list per result, each with an `action` of `drafted`,
`paired`, `re-paired`, `re-pinned`, `dropped` or `not-paired`.

`--offline` overrides `graph.fill.offline`. It means no egress, as it does for
`meta fill` and `term fill`, and it reuses their rule and their messages.
`auto` resolves only to a local model already downloaded, and a hosted
`--provider` beside it is a usage error. With no local model, only the re-pins
run. Each page that needed a model is `skipped` as `offline`, and the run
exits 0 with one warning.

A changed answer in a golden-set file is not re-paired, because `fill` only
moves that file's lines. Its `check` message therefore keeps `…so re-pin it
and review it.`, while a page's changed answer names `graph fill`.

### 5. `graph export questions`

`EXPORT_TARGETS` gains `questions`. It writes JSONL, one line per question,
from pages and golden-set files. Answer text is rendered from the pins at
export time, so the source stays pinned, not copied.

```json
{"id": "docs/uploads/retry.md#how-many-times-does-an-upload-retry-by-default",
 "question": "How many times does an upload retry by default?",
 "language": "en", "reviewed": true, "answerable": true,
 "expected": [{"id": "<the id graph export search writes for § Retry limits>",
               "file": "docs/uploads/retry.md", "lines": "41-43", "reviewed": true,
               "text": "Uploads retry three times, waiting 2, 4 and 8 seconds."}]}
```

The default path is `questions.jsonl` beside the graph, and `-o` overrides it.
`expected[].id` uses the ids `graph export search` writes, for ID-based
recall. A gap has `"answerable": false`. Drafts are included with
`reviewed: false`. A changed answer is exported with `"stale": true`, and one
warning names the count. The CLI reference maps the format into Ragas,
DeepEval and promptfoo datasets.

## What this does not do

- **Judge answers.** This is the 0086 decision. Export is the path to the
  tools that judge.
- **Draft cross-page and gap questions.** Synthetic multi-hop questions are the
  weakest kind in the research, and good unanswerable ones are rare. That can
  be its own proposal.
- **Add a review verb, a `manni status` line, or per-leg rates.** The YAML diff
  is the review surface. `graph search --mode` investigates one question.
- **Add a model-free repair flag.** Re-pinning runs before any model call, and
  a run where no page needs drafting makes none.

## Decisions

The user took these on 2026-10-18.

- Pairs live in both homes. A page holds its own in `sample-questions`, and a
  golden-set file holds cross-page and unanswered questions.
- Drafted questions count at notice until reviewed. Review state is a field,
  `reviewed`, not the removal of a `meta-provenance` entry.
- `graph export questions` ships, in its own PR.
- These phases go into the 0086 stack before its docs PR, as proposal 0087.
