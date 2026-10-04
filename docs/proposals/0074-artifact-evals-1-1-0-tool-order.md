# 0074: artifact-evals 1.1.0 names `tool-order`

- **Status:** Proposed
- **Serves:** Sara · S14, "Change the artifact-evals standard without
  breaking what exists", and S3, "Version and evolve the schema safely".
  Maya · M21, "Turn one instruction into a testable eval", when the
  instruction is about order.
- **Depends on:** [0067](0067-registering-the-vocabularies.md), which
  registered `manni:artifact-evals:1.0.0` and its strict overlay. It said a
  later `1.1.0` registers beside `1.0.0`. [0066](0066-strict-vocabulary-overlays.md),
  for what an overlay holds. [0009](0009-publish-builtin-schemas.md), for
  how a built-in publishes.
- **Relates to:** [ADR 01026](tracevals/01026-a-tool-order-grader.md) in
  the tracevals log, which added the `tool-order` grader. [0023](0023-metadata-vocabularies.md),
  whose artifact-evals draft 1.0.0 was cut from.
- **Supersedes, in part:** [0049](0049-tracevals-domain.md) § 4, for the
  vocabulary tracevals reads. Artifacts validate against the registered
  `manni:artifact-evals:1.1.0`, not the `1.0.0-proposal.4` draft. Its Status
  line is the only edit.
- **Touches:** `src/meta/schemas/artifact-evals{,-strict}/1.1.0.json` (new),
  `src/meta/schemas/manifest.json`, `src/meta/core/schema-registry.ts`,
  `docs/public/schemas/**`, `src/tracevals/evals/schema.ts`, `test/**`,
  `docs/src/content/docs/meta/reference/schemas/**`
- **Verdict:** `tool-order` stays a grader of its own. Both artifact-evals
  ids register again at `1.1.0`, beside `1.0.0`. The strict overlay names
  eleven graders, and the open vocabulary changes only in its prose and its
  recommended list. The `1.0.0` files keep their bytes.

## Problem

The registered vocabulary names ten graders. tracevals answers to one more,
`tool-order`, which ADR 01026 added and no draft of the vocabulary listed.

The open vocabulary accepts it anyway, because any kebab name passes there.
The strict overlay does not. It closes `grader` to the ten named graders and
`tool:<kebab>`, so this entry fails strict:

```yaml
metadata:
  evals:
    - id: read-before-write
      assertion: The session read the file before writing it.
      grader: tool-order
      options: { before: Read, after: Write }
```

A team that adopts strict to catch `tool-useage` loses a grader the tool
ships. The overlay was written to reject typos, and here it rejects a real
name.

tracevals has a second gap. It validates against the
`1.0.0-proposal.4` draft under `docs/proposals/`, so its findings name a draft
id. A reader who copies that id into `manni meta validate` gets an unknown
built-in.

## Decision

### `tool-order` stays its own grader

Folding it into `tool-usage` as an `after` option was considered and
rejected. `tool-usage` answers whether a tool ran, and how often. `tool-order`
answers which came first. The two take different options, and they fail for
different reasons. One grader with both would need a rule for which options
combine. ADR 01026 weighed the same choice and reached the same answer.

Its semantics are those of `src/tracevals/graders/tool-order.ts`.

| Option | Type | Meaning |
|---|---|---|
| `before` | string, required | The tool that must come first |
| `after` | string, required | The tool that must come later |
| `beforeInputMatch` | string, a regular expression | Counts only `before` calls whose input matches |
| `afterInputMatch` | string, a regular expression | Counts only `after` calls whose input matches |
| `includeSidechains` | boolean, default `false` | Counts subagent calls as well as the main chain |

The eval passes when some occurrence of `before` precedes some occurrence of
`after`. Order is the call's position in the session's events. When neither
tool appears, the eval passes, because the claim has nothing to bite on.

### Two ids at 1.1.0

| Id | Built from |
|---|---|
| `manni:artifact-evals:1.1.0` | `manni:artifact-evals:1.0.0` |
| `manni:artifact-evals-strict:1.1.0` | `manni:artifact-evals-strict:1.0.0` |

Each is published where every built-in is, at
`https://hawkeyexl.github.io/manni/schemas/artifact-evals/1.1.0.json` and
`.../artifact-evals-strict/1.1.0.json`.

The open vocabulary changes in three places.

- `$id` and `title` name `1.1.0`.
- The `grader` description lists `tool-order` among the session graders.
- The recommended list inside `grader` gains `tool-order`.

That list sits in an `anyOf` beside the kebab pattern, so it is a hint for
editors. Every value it names already matched the pattern. The set of
documents the schema accepts does not change.

The strict overlay changes in four places.

- `$id` and `title` name `1.1.0`.
- Its description names `manni:artifact-evals:1.1.0` as the vocabulary it
  sits beside.
- The `grader` enum gains `tool-order`, eleven names in all.
- The `grader` description says eleven rather than ten.

Strict leaves `options` alone, for `tool-order` as for every other grader.
The open vocabulary keeps a grader's options outside the schema, so they
follow the grader's schedule. A grading tool validates them at run time, and
tracevals reports a bad option as an error on the eval.

### 1.0.0 does not move

`npm run schemas:check` holds every published file to its recorded hash.
`1.0.0` keeps its bytes, and a config that names it validates as before. Ids
resolve by exact string, so nothing moves to `1.1.0` without a config edit.

Neither id is in the default set, so `strict: true` reaches neither. A team
lists both ids beside the host schema, as it does at `1.0.0`.

```yaml
meta:
  overrides:
    - collection: skills
      schemas:
        - anthropic:claude-skill:2.1
        - manni:artifact-evals:1.1.0
        - manni:artifact-evals-strict:1.1.0
```

### tracevals reads 1.1.0

tracevals imports `src/meta/schemas/artifact-evals/1.1.0.json`, as docevals
imports `manni:evals:1.0.0`. A finding names `manni:artifact-evals:1.1.0`, an
id `manni meta validate` accepts. The draft stays in `docs/proposals/` as the
review record.

## Stress test

1. **A strict `1.0.0` user with a `tool-order` eval.** It still fails, with
   the same message. The fix is a config edit to `1.1.0`, and the failure
   names the overlay that produced it.
2. **A user who stacks `artifact-evals:1.1.0` with `artifact-evals-strict:1.0.0`.**
   The open root accepts `tool-order`, and the older overlay rejects it. Each
   finding names its schema, so the mismatch is visible in one run.
3. **A misspelled `tool-ordr`.** It passes the open vocabulary at both
   versions, as any kebab name does. Strict `1.1.0` rejects it, and tracevals
   rejects it at the grader registry.
4. **A `tool-order` eval with a bad option.** Both schemas accept it, because
   neither reads `options`. tracevals reports `options.before is required`
   against the eval, not the session.
5. **A future grader.** The open vocabulary needs no new version. The strict
   overlay needs one, and so does the recommended list. Each lands beside the
   last, as this one does.
6. **The published check.** The new files are absent from the legacy docmeta
   base by design. That check asks the legacy base only for its own 23 files.

## Open questions

None.
