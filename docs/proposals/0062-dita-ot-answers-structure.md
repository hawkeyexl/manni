# 0062: DITA-OT answers the structure job

- **Status:** Proposed
- **Serves:** Three journeys, for a docset written in DITA.
  - Maya · M10, "Hold every page to the shape its doctype promises". Her pages
    are DITA topics gathered by maps.
  - Devin · D9, "Gate document structure in CI". The failures that matter to him
    live between files, not inside one.
  - Theo · T5, "Read a structure failure and fix it". A broken conref should
    read as a finding, not as a build log.
- **Depends on:** Three.
  - [0050](0050-lint-domain.md) folded lint in and split the job from the tool.
    This is the first use of that split.
  - [0035](0035-a11y-domain.md) set the shared severity scale, and the rule that
    a domain folds its source's scale onto it.
  - [0034](0034-command-grammar.md) is why this adds no verb.
- **Touches (planned):** `src/lint/tools/**`, `src/lint/core/config.ts`,
  `src/lint/commands/lint.ts`, `src/lint/parsers/xml.ts`, `src/shared/tools.ts`,
  `docs/src/content/docs/lint/**`, `test/lint/fixtures/dita-ot/**`,
  `test/lint/fixtures/examples/dita-ot/**`.

## Problem

manni lint already reads DITA. `src/lint/parsers/xml.ts` carries a DITA
vocabulary, and a topic routes to a template the way a Markdown page does. A
DITA shop can hold its topics to a doctype today.

What it cannot do is resolve anything between files. A conref points into
another topic. A keyref resolves through a map. An xref names a file, and an
image names a path. Every one of those can break without changing the file it
sits in.

That class of failure is invisible to this package by construction. The engine
parses one file at a time into a section tree, and the tree has no idea other
files exist. Growing it into a resolver would mean reimplementing key scopes,
conref push, and the map hierarchy. DITA-OT already does that, correctly, and is
what the docset is published with anyway.

## The decision

DITA-OT becomes a second tool for the **structure** job. It adds no verb.

```yaml
lint:
  structure:
    tool: dita-ot

tools:
  dita-ot:
    home: /opt/dita-ot
```

`manni lint structure docs/` is what a person types either way. That is 0050's
rule, and this is the case it was written for. A repo that swaps the tool
changes one line of config, and its CI command, its docs and its habits all
still hold.

DITA-OT keeps its own rule names, so a finding is
`manni:lint/structure/DOTX010E`. Vale's prose findings already work that way.
The name a tool's own documentation uses is the name a reader searches for.

## Why not a verb of its own

Because validity and reference resolution are not a different question from
structure. They are the same question asked of a format whose structure is
enforced elsewhere. A DITA author asking "is this topic sound" means the
grammar and the references, not the heading order.

An earlier draft of this work proposed two new verbs, `validity` and `links`.
It was wrong, and the way it was wrong is worth recording. Naming a verb after
what a particular tool happens to report is how a CLI ends up with one verb per
tool. 0050 rejected `manni lint vale` for the same reason.

## Reversing the `.ditamap` exclusion

[0050](0050-lint-domain.md) shipped with `.ditamap` excluded from the parser,
on this reasoning.

> Not `.ditamap`: a map is a table of contents, with no titled section and no
> prose, so every map in a docset would report as unparseable. A map is not a
> page and has no doctype to check.

The first half is right. The conclusion is not. A map is a tree of titled
nodes, and a tree of titled nodes is what a `SectionNode` is. A `topicref`
nests the way a heading nests.

So the parser gains a `DITAMAP` vocabulary, and both tools read `.ditamap`. Two
findings from building it are worth keeping.

**Navigation elements are `topicref` specializations, and there are many.** A
vocabulary listing `topicref` alone is wrong. DITA-OT's own
`reference/glossary.ditamap` nests all thirteen of its entries in `glossref`,
which such a vocabulary skips whole. The bucket now lists the specializations,
including the bookmap divisions.

**An entry usually has no title, and that is correct.** Real maps point by
`keyref` and let the target supply the title.
`resources/common-toc.ditamap` carries no `navtitle` at all. An untitled entry
is therefore an untitled section rather than a failure. A template requiring a
title on every entry would fail maps that are right.

`reltable` and `keydef` stay out of the tree. A `keydef` defaults to
`processing-role="resource-only"` and never appears in navigation. A `glossref`
processes normally and does. That is a fact about DITA rather than a taste.

## Not `dita validate`, which was the first plan

`dita validate` shipped in 4.3 and reads as built for exactly this. The release
notes call it "ideal for continuous integration scenarios, as it allows you to
quickly check contributions for errors without building output". This proposal
was drafted around it.

Running it settled the matter the other way. Against a map whose topic conrefs
an id that does not exist, `dita validate` exits 0 and prints nothing. It
parses and checks grammar, and it resolves no references. Its own `--help`
accepts neither `--logger` nor `--logfile` nor `--temp`, so the obvious
invocation is accepted in silence and does nothing useful.

`--format=dita`, the DITA-to-DITA transformation, runs the whole preprocessing
chain. That chain is where conref, keyref and link resolution happen, and it
reports what they find. Measured on the fixtures, it catches everything
`validate` catches and the references as well.

| Case | `dita validate` | `--format=dita` |
|---|---|---|
| Element not in the DTD | `DOTJ012F`, exit 1 | `DOTJ088E` at line and column |
| conref target missing | nothing, exit 0 | `DOTX010E` at line and column |
| Link target unreadable | nothing, exit 0 | `DOTX008E` and `DOTX031E` |
| Key reference undefined | nothing, exit 0 | `DOTJ047I`, verbose only |

The cost is that a transformation writes output. It goes to a scratch directory
with the logs and the temp trees, and the whole scratch is removed however the
run ends.

Verbose is required rather than chosen. An undefined key reference is reported
at `INFO`, and the default verbosity drops it. Verbose turns one run over a
four-file map into roughly 130 log entries, of which one or two carry a `code`.

The lesson worth keeping is narrow. A command named `validate`, documented for
CI, in a tool this widely used, still had to be run before its behaviour was
known. Reading its documentation and its source was not enough.

## What DITA-OT's JSON logger actually gives

The per-message shape is documented nowhere. It was first read from
`org.dita.dost.invoker.JsonLogger` at tag 4.4.1. Running 4.4.1 on Windows
against JDK 17 then confirmed it, field for field.

Each message carries `timestamp`, `level` and `msg`. It may also carry `code`,
`location`, `line`, `row`, `target`, `task`, `duration` and `stacktrace`.

Three of those decided the implementation.

**`code` is the filter.** DITA-OT emits hundreds of `INFO` lines that are
progress rather than findings. A message with a `code` is a diagnostic, and a
message without one is not. Nothing else separates them.

**`level` is the severity, not the id's last letter.** The values are `FATAL`,
`ERROR`, `WARN`, `INFO`, `DEBUG` and `TRACE`, from DITA-OT's own
`MessageBean.Type`. They fold onto the family scale, and `DEBUG` and `TRACE`
are dropped.

**The field named `row` is the column.** The logger parses a `file:line:col:`
prefix with one regex. Group two becomes `line` and group three becomes `row`.
A parser that trusts the name puts every finding in the wrong place.

A location is present only when the message text carried that prefix. DITA-OT's
semantic messages usually do not, so a finding often knows its file and no more.
dita-ot [#2839](https://github.com/dita-ot/dita-ot/issues/2839) and
[#2580](https://github.com/dita-ot/dita-ot/issues/2580) track that, and both are
stale. A finding with no location is attributed to the target the run was
pointed at.

## What else was evaluated

| Option | Verdict |
|---|---|
| Schematron | Rejected. SVRL carries XPath, not line and column. oXygen's staff state their line numbers come from Java outside the stylesheets. `saxon:line-number()` needs paid Saxon-PE or EE. SchXslt's GitHub org was archived in August 2025. |
| A DITA rule pack | None is maintained. `jelovirt/dita-schematron` last moved in 2011. OASIS ships none. |
| oXygen Scripting | Rejected on licensing. A separate SKU, priced per core from $1,353 to $3,384. |
| LemMinX | Rejected. An LSP server with no batch CLI, and a JVM for less than DITA-OT gives. |
| A standalone DITA linter | There is not one, on npm or on PyPI. The GitHub topic `dita-validator` holds no repositories. |
| `xmllint` in WASM | Good, and deferred. See below. |

DITA 1.3 is the target. DITA 2.0 is not an OASIS Standard yet, and DITA-OT
supports it only preliminarily, against January 2026 drafts.

## Stress test

### 1. A mixed repo gets one tool for the whole run

0050 allows one tool per job. A repo holding both Markdown and DITA therefore
gets one answer, and files the chosen tool cannot read are skipped. This change
does not alter that, but it is the first time the limit is reachable.

It is left as it is. Per-format tool selection would mean two tools answering
one job, and `manni lint tools` could no longer print one row per job. That is a
larger change than this one, and no user has asked for it yet.

### 2. Why is the exit code ignored

Because DITA-OT documents none, and because it demonstrably lies. A run that
reports `DOTX010E` against a broken conref **exits 0**. Trusting that exit code
would turn every reference failure into a clean CI job.

So the log is the verdict. A non-zero exit with a readable log reports findings.
A non-zero exit with no readable log is an operational failure, and says so.

### 3. Why does a directory walk collect only `.ditamap`

Because DITA-OT takes one `--input`, so a run is one invocation per target. Walking every topic would pay a JVM start per topic. DITA-OT's own
documentation puts the saving from reusing a JVM at two to ten times.

A map is the right unit anyway. The references this tool exists to check are
resolved through the map. Naming a topic directly still works, and the run says
that fewer references resolved.

### 4. Is `dita-ot` a good name for the tool

It is what the project calls itself, what the command is called, and what a
reader will search for. `manni` names the engine in this package for the same
reason.

## Deferred, deliberately

- **`xmllint` as a third structure tool.** libxml2 compiled to WASM validates
  DTD, RELAX NG and XSD in process, with real line and column numbers and no
  JVM. It answers less than DITA-OT, and it needs nothing installed. The seam
  this proposal builds makes it one more entry.
- **Bundling OASIS DITA grammar files** as package files. It matters only if
  `xmllint` lands, and it needs an IPR check first.
- **A severity map.** 0050 said one should wait for the first job with more than
  one severity. This is that job. It is still additive, so it waits.
