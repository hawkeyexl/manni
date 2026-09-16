---
status: "accepted"
date: 2026-08-28
decision-makers: [hawkeyexl]
consulted: [docmeta proposal 0023 review]
informed: [docevals, dockg]
---

# Adopt `docmeta:artifact-evals` as the eval vocabulary, and stop publishing our own

## Context and Problem Statement

This repo published its own eval contract as `schemas/artifact-evals-0.2.json`, under a rule
inherited from docevals. That rule was *schemas are published by the tool that owns them*, with an
explicit "never register this as a docmeta built-in" clause in [CLAUDE.md](../CLAUDE.md).

docmeta has since reversed the dividing line. [Proposal
0023](https://github.com/hawkeyexl/docmeta/blob/main/docs/proposals/0023-metadata-vocabularies.md)
publishes nine metadata vocabularies. Three of them were derived by reworking the in-progress
contracts of three tools in this family: docevals, dockg, and this one. The new line is that
**docmeta publishes common metadata vocabularies, and tools implement behavior against them.**
That behavior is graders, graphs, and runtimes. `docmeta:artifact-evals:1.0.0-proposal.1` *is* our
`artifact-evals-0.2`, reworked into the family shape. docmeta's own ledger names the debt this repo
owes back: a superseding ADR, plus `extract`/`write`/`fill` reading the new spellings.

The proposal is blunt about timing. The reversal is *"cheap now and only now: docevals and
moose-tracevals have never shipped, so every break below is loud and free."* That is confirmed here,
with zero git tags, `RELEASE_ENABLED` unset, and nothing on npm. `0.1` and `0.2` have no pinned consumers, and
never had any.

## Decision Drivers

- One vocabulary across the family beats three that drift; this repo already learned that lesson
  about the inference layer (ADR 01006).
- Every break is free before the first publish and expensive after it.
- A contract with a stable identifier is only worth having if someone else can implement it.
- The 0.2 shape had real defects the rework fixes. One was an optional position-derived `name` that
  orphaned history joins. Another was an `evals: []` hole that read as "eval-covered", and a closed
  grader enum that forced a schema version for every new grader.

## Considered Options

- Adopt the docmeta vocabulary, vendoring the draft until docmeta registers it
- Keep publishing `artifact-evals-*` and treat docmeta's as a parallel dialect
- Wait for docmeta's community review to conclude before changing anything

## Decision Outcome

The chosen option is to **adopt the docmeta vocabulary now, vendored**. The shape is already
the better contract, and the migration cost only rises from here.

`schemas/artifact-evals-1.0.0-proposal.1.json` is a **byte-identical copy** of docmeta's draft,
keeping docmeta's `$id` (`docmeta:artifact-evals:1.0.0-proposal.1`). We validate it by file path
through docmeta's `Validator`, the same file-ref approach docmeta's own spec suite uses for these
unregistered drafts. No registry work is needed until the review concludes.

This **supersedes two rules** in [CLAUDE.md](../CLAUDE.md):

- *"Don't register `schemas/artifact-evals-*.json` as a built-in inside docmeta."* Reversed. The
  vocabulary is docmeta's; this repo implements behavior against it.
- The rule that `schemas/artifact-evals-*.json` are published artifacts, with each `$id` a
  resolvable URL, is retired. The `$id` is now docmeta's vendor-prefixed identifier, which is not a URL and should not
  be rewritten into one. A local `$id` would fork the vocabulary in everything but name.

`0.1` and `0.2` are **deleted**, along with their `package.json` exports. The immutability
invariant they were protected by was never engaged: nothing was ever released.

### What changed in the contract

| Change | Detail |
|---|---|
| `criteria` container dissolves | `metadata.evals` is the list, or a single string |
| `evals.skip` → `metadata.eval-skip` | A sibling of `evals`, not nested inside it |
| `name` → `id` | Required on object entries; the string shorthand stays the id-less form |
| `llm` → `ai` | The registry rejects `llm` |
| Grader enum closed(8) → open | Any kebab name validates; the registry is the rejecting authority |
| `examples` anchors | One string or a list of them |
| New entry fields | `provider`, `skip`, `severity-map`, and the `command` family |
| New graders | `human`, `command` (see [ADR 01011](01011-execute-command-graded-evals.md)) |
| New block key | `metadata.eval-provenance`, written by `fill` |

Two design rules from the family are adopted along with the shape:

- **Open enum, registry-validated.** The grader vocabulary is closed where a *schema conditional*
  switches on the value and open where only a *runtime registry* does. Nothing in this schema
  branches on `grader`, so it is fully open. A new grader never needs a schema version. The stated
  cost is real and accepted: a stale `llm` passes the schema and is rejected by the registry.
- **Prefix reservation as a loud-typo guard.** `metadata` is the host tool's extension bag and must
  stay open, so the schema cannot reject `eval-skpi`. `extractEvals` reserves the `eval` prefix at
  run time, and rejects any unrecognized `eval*` member. That restores the closed block's property
  that a misspelling is an error rather than a key that quietly does nothing.

The internal vocabulary follows the contract: `src/criteria/` → `src/evals/`, `Criterion` →
`EvalEntry`, `fill.maxCriteriaPerArtifact` → `fill.maxEvalsPerArtifact`, `--max-criteria` →
`--max-evals`. docmeta's ledger is explicit that *"the word criteria leaves the family
vocabulary"*, and keeping it internally is the two-spellings-of-one-rule problem the family exists
to prevent.

### Consequences

- Good, because one entry vocabulary now ports across pages (docevals) and artifacts (here), so a
  grader name means the same thing in both.
- Good, because required `id`s stop history joins from resetting whenever entries are reordered.
- Good, because the open grader enum decouples adding a grader from versioning a schema.
- Good, because `fill` output is now self-describing: `eval-provenance` says which model proposed
  what, at what confidence, and a human deletes the entry once reviewed.
- Bad, because every existing artifact in the wild breaks. That is accepted, because there are
  none. The 0.2 spellings fail loudly with a JSON Pointer and a line number, never silently.
- Bad, because a misspelled grader now reaches the registry rather than the schema. Mitigated by
  the registry error naming every kind it knows.
- Neutral, because the vocabulary is still a *proposal*. If the review changes it, we re-vendor;
  the `-proposal.1` prerelease in the filename is what keeps that visible.

### Confirmation

- [test/unit/schema.test.ts](../test/unit/schema.test.ts) is a case-for-case port of docmeta's own
  verification ladder (`docs/proposals/0023/ladders/artifact-evals-examples.cjs`), with 13 accepts
  and 9 rejects. Those include the migration negatives: the `criteria` envelope, the old `name`
  key, and the command-family guard rails. Drift between our copy and docmeta's draft fails here.
- [test/unit/evals.test.ts](../test/unit/evals.test.ts) pins the reader: block shapes, the
  `eval` prefix guard, anchor normalization, and the 0.2 spellings failing loudly.
- The fixture corpus exercises every new shape end-to-end, and
  [ci.yml](../.github/workflows/ci.yml) asserts each outcome by name.

## Pros and Cons of the Options

### Adopt now, vendored

- Good, because the break is free today and permanent tomorrow.
- Good, because vendoring needs no registry machinery and no docmeta release.
- Bad, because the schema file must be re-synced if the review changes the draft.

### Keep publishing our own

- Good, because nothing changes today.
- Bad, because two near-identical dialects of one contract is exactly what the family walk existed
  to end, and the divergence compounds silently.

### Wait for the review

- Good, because we would adopt a settled shape once.
- Bad, because the review may take a while, and the "breaks are free" window closes at first
  publish. That is a one-time setup step away.
