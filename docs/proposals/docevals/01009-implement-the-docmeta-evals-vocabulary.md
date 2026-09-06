---
status: "accepted"
date: 2026-08-28
decision-makers: [hawkeyexl]
---

# Implement `docmeta:evals` as the frontmatter vocabulary, and publish a schema for it rather than defining one

Supersedes [ADR 01000](01000-publish-the-frontmatter-schema-from-this-repo.md).

## Context and Problem Statement

ADR 01000 asked where a tool's frontmatter schema should live. It answered "in the tool that defines the fields", with an explicit rule not to re-propose a docmeta built-in. That answer was right for the question as it was framed. The question was about *versioning*, and a built-in couples every schema revision to a docmeta release.

docmeta [proposal 0023](https://github.com/hawkeyexl/docmeta/blob/main/docs/proposals/0023-metadata-vocabularies.md) reframes it. It proposes nine **common metadata vocabularies** that docmeta would publish itself. One of them, `docmeta:evals:1.0.0-proposal.1`, is a rework of this repo's `frontmatter-0.1`. The design walked the in-progress contracts of three sibling tools (moose-docevals, dockg, moose-tracevals). All three had independently recorded 01000's rule, and the design drew a different line:

<!-- vale off -->

> docmeta publishes common metadata vocabularies; tools implement behavior — graders, graphs, runtimes — against them.

<!-- vale on -->

That line separates the two things 01000 conflated. *Who owns the field names* and *who ships the file a validator loads* are different questions, and 01000's evidence only ever answered the second.

The proposal names the work owed here. It calls for a superseding ADR, a resolver that reads the new spellings, and a reservation of the `eval-` prefix. That last one is an implementer's obligation the vocabulary cannot express itself.

## Decision Drivers

- **A vocabulary is worth more shared than owned.** "What must be true of this page?" is not a moose-docevals question. A page annotated for this tool should be legible to any grader, judge, or CI tool. That happens only if the field names are not ours.
- **The window is now.** moose-docevals has never been published to npm. Every break is free today and expensive on any later day.
- **The proposal is genuinely better than 0.1**, independent of who owns it. It lands `severity-map`, which 0.1 documented and then rejected. It adds `provider` and the single-string shorthand. It closes three holes 0.1 left open. Those are a `command` on an `ai` eval, a `generated-assertion-hash` with no command, and exit codes on a grader that never reads them.
- **0.1's closed `evals:` object bought one real thing**: a typo'd setting was an error. A flat, open page root loses that, and losing it silently would be worse than the rename.
- **The draft is not accepted yet.** Depending on an id docmeta has not registered would be depending on a 404.

## Considered Options

- **Keep `frontmatter-0.1` and its own vocabulary.** Honor 01000 as written.
- **Adopt the vocabulary; wait for docmeta to register it, then point at `docmeta:evals:1.0.0`.**
- **Adopt the vocabulary now; publish our own schema file implementing it.**

## Decision Outcome

The chosen option is to **adopt the vocabulary now, and publish `schemas/frontmatter-1.0.0.json` implementing it.**

The schema file keeps a `$id` under this repo, so nothing depends on an id docmeta has not registered. What changes is that the *field names are no longer ours to choose*. The file is an implementation of someone else's contract, and a divergence from the draft is a bug here, not a local dialect.

Concretely, versus `frontmatter-0.1`:

- **Renamed.** `name`→`id`, `llm`→`ai`, `successExitCodes`→`success-exit-codes`, `timeoutMs`→`timeout-ms`, `generated.assertionHash`→`generated-assertion-hash` (the wrapper flattened).
- **Removed.** The `evals:` object form. `suite` and `skip` hoist to the page-level `eval-suite` and `eval-skip`; `generatedBy` is superseded by the page's own top-level `generated-by`, which the self-preference-bias check now reads there.
- **Added.** `provider`, `severity-map`, the single-assertion string shorthand, and anchor examples as string-or-list. The guard rails come too: `human` ⇒ `assertion`, `command` ⇒ `grader: command`, a hash never without its command, and exit codes and timeouts only on `command`.
- **Added here, not in the draft.** The **`eval-` prefix reservation**. docmeta's root is `additionalProperties: true`, so `eval-suit:` would sail through it. This schema rejects any unrecognized `eval-*` key, which restores at an open page root the loud-typo property the closed 0.1 block had. It is the one thing the proposal explicitly asks implementers to add.

`ai`, not `llm`, is the rename worth naming: the judge may be an agent rather than a bare model, and `llm` asserted otherwise.

The schema is versioned with **three segments**, and its bytes are frozen once published. A published schema's URL has to keep meaning what it meant. The only lawful way to fix even a `description` is a new version. With two segments the only available bump is a minor, which announces new fields when none were added. `1.0.1` says what actually happened.

The `$id` is now **actually served**. It was a 404 for the whole life of 0.1. The schema lived only in `schemas/`, the site had no `public/`, and every test passed against it. `docs/public/schemas/` now carries a committed copy, `npm run schemas:check` asserts the two agree, and a scheduled job fetches the URL, because every local check passes on a 404ing site.

### Consequences

- **Good.** A page's eval declarations are legible to any tool implementing the vocabulary. This repo stops maintaining a private dialect of a shared idea.
- **Good.** The guard rails and the prefix reservation catch classes of mistake 0.1 accepted in silence.
- **Bad, and accepted**: the draft may move under review. Shipping our own `$id` mitigates that, because a change in the draft becomes a version bump here rather than a broken pointer. Implementing it also produces the review evidence the proposal asks for.
- **Bad, and accepted**: every existing page and config breaks at once. Free today; not free later.
- **The sharpest edge.** In 0.1 a bare string in the eval list was a *reference* to a config-defined eval. It is an **assertion** now. A page that still says `- fresh-enough` does not error. It sends those two words to the judge and reports a verdict on them, while the freshness grader silently stops running. `resolvePage` warns when a string shorthand matches a defined eval id, but deliberately does not reinterpret it: guessing would make a second, invisible spelling of `use:`.

### Confirmation

`test/unit/schema.test.ts` ports the proposal's own 23-case ladder plus this repo's additions, for 31 cases. The ten negatives are the migration guard. The 0.1 object form has to fail, and so do `grader: llm`, the `generated` wrapper, and a misspelled entry field. So do `ai`/`human` without an assertion, `eval-skip: "true"`, exit codes on `ai`, and a hash without its command. Five more pin what the ladder cannot: unrecognized `eval-*` keys rejected, `- name:` rejected, a non-kebab id rejected, `evals: []` rejected, and sibling tools' page keys passing untouched.

`test/unit/resolve.test.ts` pins the stale-reference warning, including that it does not change behavior. Three tests pin that the `$id` resolves to a served, byte-identical copy. The fixture corpus and the docs corpus both run through the real CLI in CI, and `verify-docs` stays 102/102.

## Pros and Cons of the Options

### Keep `frontmatter-0.1`

- Good, because it honors 01000 and costs nothing today.
- Bad, because it keeps a private dialect of a question three sibling tools were answering separately.
- Bad, because 0.1's own holes (a `command` on an `ai` eval; a hash with no command) stay open.
- Bad, because the cost of moving rises the moment anything ships.

### Adopt, but wait for registration

- Good, because it would let the id be `docmeta:evals:1.0.0` with no local schema file.
- Bad, because the proposal is open for community review with no date, and the review wants implementation evidence that waiting cannot produce.
- Bad, because "adopted but not implemented" is indistinguishable from not adopted.

### Adopt now, publish our own file

- Good, because it decouples adoption from docmeta's release schedule, which is precisely what 01000 was protecting, kept.
- Good, because implementing the draft is the evidence the review asks for.
- Neutral, because two artifacts describe one vocabulary until registration. That is bounded, and the ledger above records every difference.
