# 0061: The template format is a grammar over sections

- **Status:** Proposed
- **Serves:** Three journeys.
  - Sara · S7, new: "Describe a doctype as a template". She owns what a how-to
    or a release note must contain. Today she writes that in a format which
    cannot say half of it.
  - Maya · M10, "Hold every page to the shape its doctype promises". She wants
    to lint the site she has, whose reference pages are defined by tables.
  - Theo · T5, "Read a structure failure and fix it". One wrong heading should
    read as one finding.
- **Depends on:** Three.
  - [0060](0060-content-model.md) names the content kinds. A template asks
    about them, so they had to be named first.
  - [0050](0050-lint-domain.md) folded lint in, with the v1 format this
    replaces.
  - [0034](0034-command-grammar.md) is the house rule this follows. One
    separator per list, and no sentinel where an absent key already says the
    same thing.
- **Relates to:** [01002](lint/01002-match-sections-in-order-not-by-index.md),
  lint's imported record, which chose an ordered single pass over index
  pairing. This supersedes its mechanism and keeps its finding. A document is
  matched by order, not by position in a map.
- **Touches (planned):** `schemas/lint/template.json`, `src/lint/core/**`,
  `src/lint/rules/**`, `templates/lint/tgdp/**`, `examples/lint/templates.yaml`,
  `docs/src/content/docs/lint/reference/templates.mdx`.

## Problem

A v1 template is a map of section rules, and the map's key order is the
grammar. Four things follow from that, and all four are defects.

**A map cannot hold two sections with the same heading.** A page with two
`Example` sections needs two keys, so the author invents `example-1` and
`example-2` and then restates the real heading in `heading.const`. The name and
the heading are the same fact, written twice.

**A map's key order is not data.** YAML says a mapping is unordered, and
JavaScript enumerates integer-like keys first. A section named `2024` therefore
silently reorders the rules around it. The format answers that with a rule
forbidding all-digit names, and a warning box explaining why. A hazard that
needs a warning box is a design defect.

**Occurrence is spread over three keys that do not compose.** `required`
defaults to true when absent, which inverts the reader's expectation.
`repeat` means one thing on an anchored rule and another on a slot.
`additionalSections` is a boolean, so "extras are allowed, but only after the
steps" cannot be said at all. Meanwhile content counts use `min` and `max`, so
one document has two vocabularies for how many.

**A doctype's real shapes have no spelling.** Three appear in every corpus we
surveyed, and v1 can say none of them:

- A repeating *pair*. TGDP's troubleshooting doctype is one or more symptoms,
  each with a cause and its solution. `templates/lint/tgdp/troubleshooting.yaml`
  records the compromise in a comment: one rule matching either word, in any
  order, because the format cannot repeat two rules as a unit.
- Heading alternation. This site closes a journey page with `Next steps` or
  `Where to go next`; nginx's docs use eight spellings of the same closer.
- Content the format cannot see. Every reference page here is a table, and
  `tgdp:reference:1.6` asserts nothing about content because the parser had no
  table kind.

There is a fifth, in the matcher rather than the format. It walks the rules
left to right with no backtracking, so it carries eight heuristics to
approximate the question it never asks. A wrong heading can surface as a
missing section plus an unexpected one, depending on how the pairing happened
to fall.

## Decision

### A template is a list of rules, and a template is itself a rule

Order is data. Duplicate headings are legal. The all-digits hazard is gone with
the map that caused it.

A template describes the page, so it takes every rule key. Its `heading`
constrains the page's own title, its `sequence` or `contains` describes what
sits before the first heading, and its `sections` are the headings under it.
v1 needed a wrapper rule whose only job was to be the page, and every built-in
carried one.

### One occurrence vocabulary

`min` defaults to 1. `max` absent means no limit, as an absent cap does
everywhere else in manni. A rule that must appear exactly once says `max: 1`.
An optional rule says `min: 0`. Extras are allowed by a trailing rule with
`min: 0` and no heading, which composes: put it after the steps and extras are
allowed only there.

`required`, `repeat: true` and `additionalSections` are gone. A file carrying
one is refused by name, with the v2 spelling in the message.

### Four forms of heading, including none

A string is exact. A list is one of. `{ pattern }` is a regular expression. And
`false` says the section has no heading of its own. An include fragment needs
that. In nginx's docs, 273 files are bodies whose host owns the title.
Omitting `heading` matches any heading, or none.

### `repeat` groups sibling rules into one repeated unit

This is the shape v1 apologised for. Troubleshooting now says what it means,
and so do nginx's per-version release notes and Doc Detective's per-scenario
examples.

### Content is ordered or unordered, and never both

`sequence` is a list of runs in order. `contains` is a map of kind to counts.
A rule carries at most one, enforced by the schema. v1 had the same split
without saying so: `sequence:` beside bare `paragraphs:` counts, with no rule
about mixing them.

A content key is plural because it carries a count. The node model is singular,
because a node is one thing. `codeBlocks: { min: 1 }` reads as a count of code
blocks, and v1 was plural for the same reason.

### Matching is an alignment, not a claim

The rule list compiles to an automaton, and the document's sections are aligned
against it by minimum cost. A match is free. Coercing a rule onto a section
whose heading it rejects costs 1. A missing required occurrence or an
unexpected section costs 2. Ties break toward the rule that names its heading,
then toward keeping a repeating rule's sections adjacent, then toward the
earlier rule.

Every v1 behavior falls out of those weights or out of the construction, and
the matcher's header carries the table saying which produces which. A wrong
heading reads as one finding because coercion is cheaper than a missing section
plus an unexpected one. `enoughSectionsRemain` is gone: it counted toward the
comparison the alignment now makes exactly.

**The weights are interface.** Changing them changes which findings appear on
documents nobody edited. They are exported, documented and pinned by a test.

### A rule that cannot run says so

A parser declares which kinds it emits (0060). A rule about a kind this file's
format cannot report is removed before matching and reported once, as a
warning. Removing it is the point. Left standing, a table rule counts zero
tables in a format with no tables, and fails the page. Meanwhile the report
says the rule was not checked.

A warning never moves the exit code.

### `extends` merges by id

A rule may carry `id`. A child's rule with that id replaces the parent's in
place, one without an id is appended, and every other key replaces outright.
Unnamed rules are never matched by position, so inserting a rule in the parent
cannot silently re-target an override below it.

The handle is `id` rather than `name` so that `name` means one thing in the
whole file: the name of an element.

## Stress test

### 1. Why not JSON Schema over the section tree?

Because the interesting assertions are about order and repetition among
siblings, which JSON Schema expresses badly. Its error messages would also be
about instance paths rather than about headings. The format's job is to make a
finding a writer can act on.

### 2. Why an alignment rather than a backtracking regex match?

A regex answers yes or no. Every real document is "no", so all the value is in
what comes back with the answer. A backtracking matcher would need a repair
pass to produce that, and the repair pass is v1's problem restated. The
alignment produces the findings as a by-product of the pairing it chose.

### 3. Ambiguity is now invisible

Two alignments can tie on every key, and the tie-break picks one. Under v1 a
person could trace the left-to-right pass by eye. This is the real cost of the
design. It is why `--explain` prints the alignment, and why the tie-break
order is stated in words a docs page carries. A template with two adjacent
wildcards of the same occurrence range is warned about at load time, because
there nothing but order separates them.

### 4. The cost weights changed a real outcome

Rewriting `examples/lint/templates.yaml` turned up a case where a required
`Troubleshooting` rule coerces an unrelated `Advanced Features` heading,
because coercion costs 1 and a missing section costs 2. Marking the rule
optional lets a trailing wildcard absorb it instead. That is the model behaving
correctly and surprising its author, which is the risk the weights carry and
the reason they are pinned.

### 5. Strict by default is a wall on the first run

Every rule defaults to exactly one occurrence, and an undescribed section is a
finding. A new author's first run is a screen of unexpected sections. The
message names the escape, and `manni lint templates infer` writes a first
template from a page that already exists. Ship them together.

### 6. Why `max` absent rather than a word like `many`?

Because manni has no sentinel anywhere else. An absent `--collection` is every
collection, an absent `maxPages` is no cap. A string in an integer field would
be the first. It would also force an absent `max` to mean one thing on a
section, and another on a content rule one indent apart.

### 7. Does the page model lose anything?

A v1 template could describe siblings of the H1, since the page was a rule like
any other. A page is one page, so that shape is gone. `readme.yaml` used it,
and the loss is recorded in its comment. Nothing in the corpora we surveyed
needs it.

### 8. What about a heading inside a component?

It is not a section. That follows from 0060, where an element's children are
its own. It hides eight headings in two pages of this repository, all inside a
tab. The alternative is worse: a page's shape would change with the tab it
happens to show.

## Deferred: DITA tooling as a second `structure` tool

0050 left the door open to a second tool under this job, and DITA-OT is the
obvious candidate. The survey says no, and the reason belongs here because it
is a finding about what this format is for.

`dita validate` is the preprocess stage with its output thrown away. It costs
54 MB plus a Java runtime, and exits `0` or `1` with no operational code. In
strict mode it stops at the first error rather than reporting all of them. Of
its 162 message codes, none is about section shape. DITA's own grammar already
enforces element order inside `<task>`, and a DITA shop runs the toolkit in CI
anyway.

What the DTD cannot state is exactly what this format states.

- A section's *title*, and the order among repeatable `<section>` elements.
- A required `@id`, and prose counts.
- A rule that must hold for Markdown and DITA alike.

Two follow-ups fall out of that, each its own proposal.

- Read `@class` in `src/lint/parsers/xml.ts`, so a specialization maps onto the
  base vocabulary. Today a specialized `<myTask>` is invisible.
- Grammar validation as a separate job, if anyone wants it. `libxml2-wasm` is
  the tool, at 1.2 MB with no dependencies and no runtime. Schematron is the
  open question, since libxml2 has scheduled its own support for removal.

## Verification

- `test/lint/integration/tgdp.test.ts` is the acceptance gate. Every vendored
  upstream page lints clean against the built-in derived from it, and no
  fixture may be edited to make that true.
- A table-driven test pins the alignment's weights and tie-breaks. It lists
  each v1 behavior, and the alignment that now produces it.
- A v1 file is refused with a message naming the v2 spelling, tested key by
  key.
- `manni lint templates infer` round-trips: its output lints its input clean.
- The seven built-ins load with nothing on stderr.

## Not breaking

`manni lint` has not shipped. No published template exists to migrate, which is
why v2 replaces v1 outright rather than carrying an alias for every renamed
key. The refusals exist for a working copy, not for a release.

## Consequences

- A template can now say what every doctype in three surveyed corpora actually
  asks for, and `tgdp:reference:1.6` asks about tables for the first time.
- The matcher is one cost table instead of eight heuristics, and a new shape
  costs a rule rather than a special case.
- The weights join the family's list of things that are interface rather than
  implementation, beside the exit codes and the rule ids.
- Two adjacent wildcards are the one ambiguity the format still admits. The
  loader warns; it cannot make them meaningful.
