---
status: "accepted"
date: 2026-08-28
decision-makers: [hawkeyexl]
---

# Track docmeta 4.x, and make `tool:docmeta` name its own schema set

## Context and Problem Statement

`docmeta` was pinned at `^1.3.0`, the release that first exported `extractFrontmatter` and `runValidate`, the two functions this repo uses. docmeta is now at 4.12.0: three majors and thirty-one design proposals later. Staying on 1.3 meant `tool:docmeta` validated against a two-year-old validator. Meanwhile [ADR 01009](01009-implement-the-docmeta-evals-vocabulary.md) adopted that same project's *current* vocabulary proposal, which is an awkward pair of positions to hold.

The upgrade turned out to be safe at the API surface and unsafe at the behavior surface. The second half is what this ADR is really about.

## Decision Drivers

- **Both exports survive.** `extractFrontmatter` and `runValidate` are still exported at 4.12, with compatible signatures. Nothing in `src/` needed a change to compile or pass.
- **`DEFAULT_SCHEMAS` did not survive unchanged.** 2.0.0 removed the singular `DEFAULT_SCHEMA` export and added Diátaxis and Seven-Action to the default set; 3.0.0 added The Good Docs Project.
- **`src/graders/tools/docmeta.ts` passes `cliSchemas: schemas`, which is `undefined` when the eval sets no `schemas` option.** The grader was therefore inheriting whatever docmeta happened to default to.
- **This repo keeps guarding against exactly this shape**: a config that silently resolves to something other than what the author meant, and passes.

## Considered Options

- **Stay on `^1.3.0`.**
- **Upgrade, and keep inheriting `DEFAULT_SCHEMAS`.**
- **Upgrade, and require `options.schemas`.**

## Decision Outcome

The chosen option is to **upgrade to `^4.12.0`, and make `tool:docmeta` refuse to run without `options.schemas`.**

The upgrade itself is uneventful. Typecheck, 258 tests, the fixture dogfood run, and the 102/102 docs corpus all pass unchanged, because both configs already name their schemas explicitly.

The second half is the decision. An eval that says only `grader: tool:docmeta` used to mean "validate against whatever docmeta defaults to". That meaning changes when the dependency changes, with no edit to any file here. Measured on this upgrade: with no `schemas` option, **all 13 fixture pages fail** `google:okf:0.1` for a missing `type`, a vocabulary nobody in this repo opted into. The findings would name the pages, not the underspecified eval.

So the grader now reports a finding naming the missing option, at the eval's own severity. That follows the same pattern `tool:doc-structure-lint` already uses for its required `template`. Which schemas a corpus is held to is a decision, and moose-docevals is not in a position to make it.

A default of *this repo's own* published schema was considered and rejected. `tool:docmeta` is a general "validate frontmatter against schemas" grader, not "validate the eval block". Making it silently check something else would be a third meaning for the same eval.

### Consequences

- **Good.** The `tool:docmeta` grader's meaning is now written in the config that uses it, and cannot move under a dependency bump.
- **Good.** This repo tracks the project whose vocabulary it implements, rather than a version from before that vocabulary existed.
- **Bad, and accepted.** A `tool:docmeta` eval with no `schemas` changes from "validates against a default set" to "reports a configuration finding". This is a breaking change to an under-specified configuration, which is the kind worth breaking. No config in this repo is affected.
- **Neutral.** docmeta 4.x brings `runQuery`, baselines, SARIF/JUnit reporters and a much larger surface. None of it is used here yet; `runValidate` and `extractFrontmatter` remain the only imports.

### Confirmation

`test/unit/docmeta-grader.test.ts` pins both halves. One is a finding naming `options.schemas`. The other is the point of the exercise. The finding does *not* mention `okf` or `seven-action`, so the grader never reached docmeta's default set. `test/unit/schema.test.ts` still validates the whole fixture corpus through `runValidate` on 4.12, and the docs corpus stays 102/102 through the real CLI.

## Pros and Cons of the Options

### Stay on `^1.3.0`

- Good, because it is the version everything was tested against.
- Bad, because it pins a validator three majors behind the project whose vocabulary this repo now implements.
- Bad, because the `cliSchemas: undefined` hole stays open either way. The version pin hides it rather than closing it.

### Upgrade, keep inheriting `DEFAULT_SCHEMAS`

- Good, because a bare `tool:docmeta` eval keeps "working".
- Bad, because what it means changes on every docmeta major, silently.
- Bad, because it makes the next upgrade a behavior change disguised as a dependency bump. That is precisely what this repo's config guards exist to prevent.

### Upgrade, require `options.schemas`

- Good, because the eval's meaning is stated where the eval is written.
- Good, because it matches the pattern the other tool graders already follow.
- Bad, because it breaks an under-specified configuration. Mitigated by the finding naming the fix, and by nothing in this repo relying on it.
