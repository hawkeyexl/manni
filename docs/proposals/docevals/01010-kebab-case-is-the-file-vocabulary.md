---
status: "accepted"
date: 2026-08-28
decision-makers: [hawkeyexl]
---

# Kebab-case is the file vocabulary, frontmatter, config, and grader options alike

## Context and Problem Statement

[ADR 01009](01009-implement-the-docmeta-evals-vocabulary.md) adopts a kebab-case frontmatter vocabulary. But an eval definition is written in **two** places: page frontmatter, and the named-eval library in `moose.config.yaml`. `use:` makes them interchangeable, because a page references a config eval by id and overrides its fields. They are one vocabulary in two files.

The config also carries settings that are nobody's vocabulary but ours (`judge.ensembleRuns`, `fill.maxCostUsd`). Grader `options` are a third case. Their names are ours, but grader code reads them at run time rather than the schema validating them.

docmeta's proposal leaves the last one open, by name:

<!-- vale off -->

> Grader `options` names (`maxUsd`, `maxAgeDays`) remain camelCase — whether kebab-case reaches into runtime contracts is each tool's call.

<!-- vale on -->

So: how far does kebab-case reach?

## Decision Drivers

- **A field should mean one thing wherever it is written.** `success-exit-codes` in frontmatter and `successExitCodes` in config is one field with two spellings, and the person writing the second one has no way to know.
- **A mixed file teaches nothing.** A config where eval definitions are kebab and the settings above them are camel invites the reader to guess which rule applies where.
- **TypeScript is not a file.** `resolvedEval.successExitCodes` is idiomatic; `resolvedEval["success-exit-codes"]` is not, and nothing user-facing depends on it.
- **Silence is the failure mode.** A camelCase key under `additionalProperties: false` is rejected as "must NOT have additional properties" against the *parent*, which names the object, not the key.

## Considered Options

- **Frontmatter only.** Config keeps camelCase.
- **Frontmatter plus the eval definition in config.** Settings stay camelCase.
- **Everything in a file is kebab.** TypeScript stays camelCase.

## Decision Outcome

The chosen option is that **everything in a file is kebab-case.** Frontmatter, config eval definitions, config runtime settings, and grader `options`. This answers docmeta's open question 6 with a yes, and that answer is worth feeding back to the review as implementation evidence.

**TypeScript keeps camelCase.** `EvalDef`, `DocevalsConfig` and `ResolvedEval` are internal shapes with no file behind them, and the whole point of a boundary is that it has two sides. `normalizeEvalDef` in `src/core/config.ts` is that boundary, and it is the only one: nothing downstream of it should ever see a kebab key.

The one exception is `severity-map`, whose *sub*-keys are a tool's own severity names, such as Vale's `suggestion` and markdownlint's levels. Those names are not ours, so the migration guard does not walk into them.

`parseConfig` raises a `DocevalsError` naming every camelCase key it finds and the kebab it should be, rather than letting Ajv report the parent object. A migration that makes you guess which key is wrong is one people work around.

### Consequences

- **Good.** One spelling per field, and a config file that reads consistently top to bottom.
- **Good.** The guard turns a stale config into a named, actionable error instead of a schema complaint about an object.
- **Bad, and accepted.** Every existing config breaks. Free while unpublished; the guard makes it a one-time mechanical fix rather than a hunt.
- **Neutral.** Grader `options` are a runtime contract, so this is a convention rather than a validated rule. `options` is `type: object` in the schema either way, and the guard, not the schema, is what enforces it.

### Confirmation

`test/unit/config.test.ts` covers positive and negative cases for the kebab keys. The migration guard is exercised throughout the suite. It caught the stale spellings in this repo's own test fixtures during the migration, which is the behavior it exists for. `test/unit/graders.test.ts` pins the kebab option names (`max-age-days`, `max-similarity`, `max-grade`, `template-path`) through the graders that read them. `test/unit/init.test.ts` loads the scaffolded config back rather than matching its text, so `init` cannot scaffold a config the loader rejects.

## Pros and Cons of the Options

### Frontmatter only

- Good, because it is the smallest change and the only one docmeta actually requires.
- Bad, because `use:` makes the two files one vocabulary, and this gives it two spellings.
- Bad, because the seam falls in the least obvious place: the same field, renamed or not depending on which file you opened.

### Frontmatter plus config eval definitions

- Good, because it keeps one spelling for the vocabulary proper.
- Bad, because the resulting config is half kebab and half camel with no stated rule, which is the shape people file bugs about.

### Everything in a file

- Good, because the rule is one sentence and has no exceptions a reader must remember.
- Good, because it answers an open question in the upstream proposal with evidence rather than an opinion.
- Bad, because it is the largest breaking surface. Mitigated by the naming guard, and by being free while unpublished.
