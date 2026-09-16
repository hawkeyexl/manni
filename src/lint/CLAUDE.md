# CLAUDE.md

Guidance for agents working in `src/lint/`. The repository's own rules are in
the root `CLAUDE.md`, and they win where the two disagree.

## What manni lint is

The structure domain of the `manni` package: it validates the **structure** of a
document against a doctype template, routed by the page's own `type` frontmatter.
The pipeline resolves targets, parses each to a generic section tree, resolves a
template per file, matches sections to rules, runs content rules, and reports.

It is **deterministic**. There is no language model, and there are no network
calls except fetching a template you point it at. If you find yourself reaching
for inference, the answer belongs in `manni docevals`, not here.

Key layers:

- `src/lint/parsers/` holds per-format parsing behind the `DocumentParser`
  interface (`src/lint/types.ts`). Each parser flattens its own AST into ordered
  `Block`s; `sectionize.ts` folds those into the `SectionNode` tree once, for
  every format. A new format is one file plus a line in `parsers/index.ts`.
- `src/lint/core/match.ts` decides which rule describes which section. Read the
  file header before touching it; the decisions are subtle and each has a test.
- `src/lint/core/resolve-template.ts` decides which template describes which page.
- `src/lint/rules/` holds the content rules over the generic content model.
- `src/lint/commands/` holds the command cores (`lint`, `templates`, `tools`), kept
  free of CLI/IO plumbing so they can be unit-tested directly. `lint` and
  `tools` settle which config governs a run through `core/config.ts`'s
  `resolveLintRun`, as cite's cores do, and resolve their targets with the
  family's walker (`../meta/internal.js`) rather than one of their own.
- `src/lint/cli.ts` is a thin commander wrapper over the command cores. The verbs
  are `check`, `structure`, `templates` and `tools`; there is no default
  subcommand (proposal 0034), and the document set is the family's
  `collections:` (proposal 0041), never a `lint.paths`.
- `src/lint/reporters/` formats output (pretty / json / github / sarif / junit).
  Severity, color and the GitHub escapers come from `src/shared/`; junit rides
  meta's renderer. A finding's id is `manni:lint/structure/<rule>`, built in
  `core/rule-id.ts` (proposal 0049).
- `templates/lint/tgdp/` holds the built-in doctype templates and the manifest
  that registers them. They sit at the repository root, not under `src/`, because
  they ship as package files rather than as bundled code — which is what
  `npm run smoke:lint` exists to catch.

## Working agreements

Project preferences. Follow them unless the user says otherwise.

### The generic tree is the contract

Everything downstream of `parse()` operates on `SectionNode` and `ContentNode`.
**Rules must never reach for mdast node types**, or the parser registry is a
fiction and every rule silently becomes Markdown-only. If a rule needs something
the content model cannot express, grow the model rather than special-casing one
format. Growing it means touching every parser, deliberately.

### Red/green TDD

Develop test-first:

1. **Red**. Write or adjust tests for the new behavior and run them. Confirm
   they fail for the right reason.
2. **Green**. Implement the minimum to make them pass.
3. **Refactor**. Clean up with the tests as a safety net.

When a behavior change makes existing tests fail correctly, update those tests as
part of the red step rather than working around them.

### Unit tests pin rules; integration tests catch the rest

Both matter, and the second has repeatedly caught what the first could not:

- The greedy-slot error passed every unit test and was caught by linting this
  repo's own `templates.yaml`.
- The `dist/` template-path bug passed every test, because the suite runs against
  `src/`, where the templates sit one directory deeper. That is why
  `npm run smoke:lint` exists and runs in CI.

So: when a change could behave differently in the built package than in the repo,
add a smoke check. When a change affects matching, lint a real document with it.

### Test fixtures per feature

When a feature needs sample input, add a **dedicated fixture** under
`test/lint/fixtures/` rather than embedding large literals in tests or reusing an
unrelated one. Name it for what it exercises. Inline strings are fine for small
parse cases.

### Commands must have parallel behaviors

Every subcommand exposes a consistent surface. Targets are positional
`[paths...]`; `-` reads stdin (with `--as`); shared flags keep the same names and
semantics (`--as`, `--exclude`, `-c/--config`, `-f/--format`, `--no-color`). Do
not introduce per-command input conventions.

Exit codes follow clig.dev and are load-bearing for CI: **0** clean, **1** lint
findings, **2** operational or usage error. A `LintError` always means 2.

### The JSON reporter's shape is an API

`manni docevals` parses `[{ file, success, errors: [...] }]` off stdout, and it
*parses* rather than validates, so a renamed key yields zero findings instead of
an error. Adding keys is safe; renaming or nesting is not — which is why
`ruleId` and `tool` joined an error object whose `type` stayed exactly as it was.
`test/lint/unit/reporters.test.ts` pins it deliberately.

### Built-in templates are derived, not authored

The templates under `templates/lint/tgdp/` mirror The Good Docs Project at a
pinned release. Upstream is the authority: `test/lint/integration/tgdp.test.ts` lints
TGDP's own published template, vendored verbatim, against ours. **Never edit a
vendored fixture to make a template pass.** If they disagree, the template is
wrong. When moving the pin, bump the version in every id. A version in an id is
a claim about which upstream revision it mirrors.

### One config file, one key

Settings live in a shared `manni.config.yaml`, and this tool reads only the
`lint:` key. Sibling tools' keys are neither read nor validated. Within our
section, validation is strict (`additionalProperties: false` at every level).
That strictness turns a typo into a loud failure instead of a silent default.

Do not add JSON Schema `default`s to booleans in either schema. A written-in
default is indistinguishable from a value the author typed, and it beat inherited
values in `extends` merges once already.

### Record decisions

lint's imported decision log lives at `docs/proposals/lint/` (records 01001
through 01008) and stays as written. A decision made **inside manni** is a
family proposal instead: `docs/proposals/NNNN-*.md`, following the root
`CLAUDE.md` rule that a proposal is superseded, never amended. Proposal 0049 is
this domain's record.

## Commands

```bash
npm test                  # vitest, the whole repo
npm run typecheck         # tsc --noEmit
npm run build             # tsup -> dist/
npm run smoke:lint        # build, then exercise the real dist/cli.js
npm run check:tgdp-pin    # has upstream moved past the pinned TGDP release?
```

### Prose is linted too, by the repository's gate

Vale runs from `.github/workflows/vale.yml` over the repository's own prose, at
`fail_level: any` against a pinned rule package — the reasoning is in
[01008](../../docs/proposals/lint/01008-gate-on-prose-lint-against-a-pinned-rule-set.md).
There is no `npm run lint:prose` here; that script belonged to the standalone
repository. `npm run lint` is ESLint.

Everything under a `fixtures/` directory is exempt, `test/lint/fixtures/tgdp/`
included, because those files are vendored verbatim from upstream and the rest
are inputs chosen for what they parse to. Rewriting either to quiet an alert
would break the test that reads it.

## Versioning

`manni` is past 1.0 and published, so a breaking change costs a major release.
Commits follow Conventional Commits and `semantic-release` derives the version:
mark a breaking change `feat!:` with a `BREAKING CHANGE:` footer. Changes to
`manni lint` itself have been free so far only because the domain has not
shipped yet.
