---
status: "superseded by ADR-01022"
date: 2026-08-29
decision-makers: [hawkeyexl]
---

# Unreadable tool output is a finding, not a pass

## Context and Problem Statement

`tool:doc-structure-lint` could report success for output it had not read.

The adapter parsed the tool's `--json` stdout inside a `try`. On a parse failure
it pushed a finding only when the exit code was non-zero; with exit `0` it fell
through to a bare `continue`. Nothing was recorded, the eval had no findings, and
an eval with no findings passes. A second path was worse. Output that parsed but
was not an array reached `for (const r of parsed)` and threw
`parsed is not iterable`. A malformed payload therefore surfaced as an
engine-level error rather than as a finding against the page.

Both are reachable without anything being wrong with the page. A version bump
changes the tool's output shape. A wrapper prints a banner before the JSON. A
`--json` flag silently stops being honored. Each turns the eval green while
checking nothing.

This is the same failure the repository already treats as a first-class hazard
elsewhere. `ci.yml` carries an explicit step asserting that every inline
Doc Detective step parses. A page whose steps are all invalid reports
"no tests" and exits 0, green with nothing executed. `discoverPages` throws on
an empty input set for the same reason. The rule was applied to the corpus and
to discovery, but not to the adapters.

`tool:doc-structure-lint` was also the only grader with no test and no captured
fixture, which is why this survived: the other five tool adapters have both.

## Decision Drivers

- **An eval must not pass because its tool became unreadable.** Passing is a
  claim about the page. Unreadable output is a claim about the tool.
- **Consistency with the existing corpus gates.** The repo already spends CI
  steps on green-with-nothing-checked; an adapter silently doing it undercuts
  them.
- **A malformed payload is a finding, not a crash.** The engine contains grader
  exceptions, but an exception names the run rather than the page, and loses the
  severity the eval configured.

## Considered Options

1. **Report unreadable output as a finding.** Chosen.
2. **Throw a `DocevalsError`.** Rejected. That is an operational error (exit 2)
   for something that is per-page and per-eval. It stops the whole run over
   one page's tool output.
3. **Keep the silent pass, add a warning to stderr.** Rejected. A warning that
   does not affect the verdict is the status quo with extra text. The eval still
   passes, and CI still goes green.
4. **Leave it, and cover it only in CI like doc-detective.** Rejected. The CI
   guard for Doc Detective exists because that grader executes steps out of page
   *bodies*, which no adapter contract can police. This one is a plain parse,
   and the adapter is the right place.

## Decision Outcome

**Report it.** `src/graders/tools/doc-structure-lint.ts` now records a
finding at the eval's configured severity in both cases:

- stdout that is not JSON, whatever the exit code. When the exit code is `0` the
  message says so explicitly, as "exited 0 but its output could not be read as
  JSON". That combination is the surprising one, and naming it is what makes the
  cause findable.
- JSON that is not the list of results the tool documents, with the same
  treatment. The shape check replaces the unguarded iteration.

Both messages carry `outputTail(result)`, so the reader sees what the tool
actually printed rather than being told only that it could not be read.

### Consequences

- A tool whose output shape changes now fails its eval instead of passing it.
  That is the point, and it will look like a regression the first time it
  happens to someone. The message names the tool and quotes its output, which is
  what separates "this broke" from "this broke and here is why".
- `tool:doc-structure-lint` gains the test coverage every other adapter had:
  `test/unit/doc-structure-lint.test.ts` against captured output in
  `test/fixtures/tool-output/doc-structure-lint-{pass,fail}.json`, with a fake
  `exec` and no real binary.
- The other five adapters were reviewed for the same shape while writing this.
  They differ. `markdownlint` and `vale` parse into their own helpers with
  explicit guards, and `docmeta` calls a library function rather than a
  subprocess. `doc-detective` already reports a timeout distinctly from a
  failure (ADR 01005). No second instance of this defect was found. The property
  is still worth stating, so it is checked when the seventh adapter is written.
  **A grader that cannot read its tool's output reports, it does not pass.**

### Confirmation

`test/unit/doc-structure-lint.test.ts` asserts a finding for unparseable stdout
with exit `0`, the case that previously returned `[]`. It asserts another for
valid JSON of the wrong shape, which previously threw. Pinned alongside them are
the happy path and the structured-failure path with line and column. So are the
missing `options.template` path, the spawn failure, and a non-zero exit with
non-JSON output. The change is then visible as a change in one branch rather
than a rewrite.
