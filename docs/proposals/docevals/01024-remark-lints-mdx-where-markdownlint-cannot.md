---
status: "accepted"
date: 2026-08-29
decision-makers: [hawkeyexl]
---

# remark lints this repo's MDX; markdownlint stays for Markdown

## Context and Problem Statement

[ADR 01023](01023-the-diagnostic-invariant-is-enforced-by-enumeration.md) made
`tool:markdownlint` honest. It had been failing to spawn on every run and
passing, so `verify-docs` reported 102/102 with a third of it never executing.
Installing `markdownlint-cli2` and fixing the output parser turned the gate on
for the first time. It produced **1,416 findings** across 34 pages.

Almost none were about the documentation:

| Rule | Count | What it was |
|---|---|---|
| MD013 line-length | 992 | The default limit is 80. These docs are written to ~100; the median flagged line was 98, and the corpus's own p90 line length is 99. |
| MD060 table-column-style | 319 | Tables pair spaced headers with compact `---` delimiter rows. Cosmetic. |
| MD037 no-space-in-emphasis | 104 | **All 104 false positives.** markdownlint read the `/* ... */` inside MDX comments as emphasis markers with spaces. |
| MD026 trailing-punctuation | 1 | The only arguably real finding in the set. |

The MD037 rows are the diagnosis rather than a nuisance. **Every page in both
of this repo's corpora is MDX**, 34 of 34 in `docs/` and 12 of 13 in
`test/fixtures/pages/`. And markdownlint has no MDX mode. It cannot see an MDX
expression, a JSX element, or a Starlight directive; it sees Markdown with
strange punctuation. A linter that cannot parse the language it is checking
will keep producing this class of finding no matter how its rules are tuned.

Tuning was the obvious alternative, and it is why this is an ADR rather than a
config commit. A `.markdownlint-cli2.jsonc` raising `line_length` and disabling
MD037 and MD060 gets the count from 1,416 to about 90. But disabling MD037
because the parser cannot read the syntax is not configuration. It works
around the tool being wrong for the input, and the next MDX-shaped rule will
need the same treatment.

## Decision Drivers

- The corpora are MDX. The linter should parse MDX.
- A gate nobody reads is the failure mode this repo keeps rediscovering. 1,416
  findings that are 99% noise is that gate, whatever its exit code says.
- "Level 1 orchestrates, it does not reimplement", so the answer is a
  different existing tool, not a hand-written MDX linter.
- Whatever replaces it must be *provably running*, since the thing it replaces
  spent its whole life not running.

## Considered Options

1. **Add `tool:remark` and switch both corpora to it.** Chosen.
2. Configure markdownlint to raise `line_length` and disable MD037 and MD060.
3. Keep markdownlint and exclude `.mdx` from its file set, which is every file.
4. Drop the lint eval from both corpora.

## Decision Outcome

**Option 1 wins.** `src/graders/tools/remark.ts` wraps `remark-cli`, and both
`moose.config.yaml` and `docs/moose.config.yaml` now name `tool:remark`.
`.remarkrc.json` at the repo root supplies the plugin stack.

Each plugin earns its place against a concrete misparse, which is worth
recording because the count only reaches zero with all of them:

- **`remark-frontmatter`.** Without it the `---` fences read as thematic
  breaks and the YAML becomes a setext heading.
- **`remark-mdx`.** The reason for the change.
- **`remark-directive`.** Starlight asides are directives. Without it, an
  aside's bracketed title reads as a reference link, and the five findings
  remaining after the first three plugins were all this.
- **`remark-gfm`.** Tables.

**`tool:markdownlint` is kept.** It is the right tool for a plain Markdown
corpus, and nothing about it is broken now that it parses. This is a change of
which tool *this repo* uses, not a removal of a capability. `markdownlint-cli2`
leaves `devDependencies` because no corpus here needs it, matching `vale` and
`doc-structure-lint`, which have never been dependencies.

### The ruleset is `recommended`, deliberately not `consistent`

`remark-preset-lint-consistent` was measured before being rejected. It adds
**320 `table-cell-padding` findings**, the same cosmetic table complaint as
MD060, at the same magnitude. Swapping tools to trade 319 noisy findings for
320 different noisy findings would have missed the point.

`remark-preset-lint-recommended` is 13 rules, and they are correctness-shaped
rather than style-shaped. They cover dangling and unused link definitions,
unclosed block quotes, malformed list indentation, bare URLs, and a missing
final newline. The docs corpus passes all 13 at zero, which is the state a gate
should start from. A new broken reference gets caught, rather than joining a
backlog of 1,416 that everyone has learned to scroll past.

### Invocation details that are load-bearing

Three, each of which produces a silently wrong adapter if missed:

- **`--no-stdout`.** Given file arguments and no `--output`, remark prints the
  *reformatted document* to stdout.
- **The report goes to stderr.** An adapter reading stdout finds the document
  and never the findings.
- **No `--frail`.** It exits 1 whenever any warning exists, which would spend
  the exit code on the normal case. Without it, a non-zero exit means something
  actually broke, which is what the no-verdict branches test for.

### Consequences

- Both corpora lint with a parser that understands their syntax. The docs
  corpus goes from 1,416 findings to 0.
- A new dependency family: 7 direct packages, 162 transitively, against 17
  removed with markdownlint. remark's ecosystem is many small packages by
  design; the lockfile diff is large, and every removal is markdownlint's tree.
- `tool:remark` is a seventh grader that shells out, so it owes rows in
  `test/unit/no-verdict.test.ts` per ADR 01023. It has them: spawn failure,
  timeout, no JSON report, and a report that is not a list of files.
- Findings are attributed by matching remark's reported path to a target, and
  remark reports Windows paths with backslashes. A path that fails to match is
  reported as a **diagnostic** rather than dropped. Silently dropping unmatched
  findings is exactly how markdownlint reported nothing for years while its
  evals passed.
- A page that cannot be parsed at all becomes an ordinary finding, not a
  diagnostic. "This file is not valid MDX" is a claim about the page. The JSON
  reporter drops vfile's `cause` chain, so the message says to run
  `npx remark <file>` for the underlying reason.
- The published frontmatter schema is untouched. Both it and
  `config-schema.json` match graders with a *pattern* rather than an enum, so
  `tool:remark` validates against the frozen 1.0.0 artifact with no new version.

### Confirmation

`test/unit/remark.test.ts` runs the adapter against captured output in
`test/fixtures/tool-output/remark-{pass,fail,unparseable-page}.json` with a fake
exec. It pins the argv, that the report is read from stderr, and the
rule/line/column mapping. It also pins backslash-path normalization, the
`options.command` override, the unparseable-page finding, and the
unmatched-path diagnostic.

Because the tool being replaced spent its whole life not running, passing tests
were not accepted as evidence that this one does. It was verified through the
built CLI against the real corpus. 34 pages report `pass remark`. Appending
a dangling reference and a bare URL to a docs page produced exactly
`remark-lint/no-undefined-references` and `remark-lint/no-literal-urls` at the
right line, with the page then restored.
