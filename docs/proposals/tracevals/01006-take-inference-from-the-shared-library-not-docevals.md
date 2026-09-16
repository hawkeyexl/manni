---
status: "accepted"
date: 2026-08-03
decision-makers: [hawkeyexl]
---

# Take the inference layer from `@hawkeyexl/inference`, not from docevals

## Context and Problem Statement

ADR 01001 decided to reuse docevals' provider and consensus layer rather than reimplement it. That
was the right call on substance and the wrong one on packaging. docevals is a *tool*, not a library,
and it is not on npm. Consuming it meant `"docevals": "file:../docevals"`, which npm publishes
verbatim, so moose-tracevals could not be published at all.

The coupling leaked well past the dependency line:

- a sibling clone next to every checkout, plus a junction for every `.claude/worktrees/` worktree;
- a second `actions/checkout` and a "build the docevals sibling" step in both `ci.yml` and
  `release.yml`, with every other step pinned to `working-directory: moose-tracevals`;
- `HUSKY: "0"` in CI purely because the file-dep lifecycle ran docevals' `prepare`;
- `makeJudgeProvider` serializing moose-tracevals' own config section back to YAML so it could be
  re-parsed by docevals' `parseConfig`, only to obtain the config object docevals' `makeProvider`
  demanded;
- a `MockResponse` type re-derived via `ConstructorParameters<typeof MockProvider>[0][number]`
  because docevals does not export it.

The shared pieces have since been extracted into [`@hawkeyexl/inference`](https://github.com/hawkeyexl/inference),
published on npm, with a flat library-owned `ProviderSpec` in place of consumer config objects.

## Decision Drivers

- Publishing must not be blocked by a dependency that cannot be published.
- An eval tool should not be another eval tool's inference vendor.
- The judge mechanics genuinely are shared; three copies of them had already drifted apart.
- Setup should be `git clone && npm install`, with no per-machine ritual.

## Considered Options

- Depend on `@hawkeyexl/inference` from the registry
- Wait for docevals to publish to npm, then depend on it by semver range
- Vendor the provider and consensus code back into moose-tracevals

## Decision Outcome

The chosen option is to **depend on `@hawkeyexl/inference`**. The dependency on docevals is removed
entirely, and `npm ls docevals` is empty.

What stays in moose-tracevals is what only moose-tracevals can decide. That is the prompts and
`PROMPT_VERSION`, and the trace-worded verdict schema (passed as the library's `schema` override so
its field descriptions survive). It is also the cache-key composition, the per-plan cost budget, and
the `JudgedEval` shape the reporters consume.

Two consequences beyond a straight swap:

1. **The provider config section is now typed and schema-validated.** It was
   `Record<string, unknown>` only because it was being re-serialized into docevals' parser. A
   misspelled `default: antropic` or `anthropc:` section passed validation, and the run quietly used
   a different provider than the author intended. It is now an enum plus per-section properties with
   `additionalProperties: false`.
2. **`fill` resolves the provider identity through the library.** It previously read
   `config.provider[name].model` by hand and fell back to `""`. A cache key could therefore record
   an empty model while the request used the provider's default. A cached proposal could then be replayed for
   a model that never produced it. `resolveProviderIdentity(providerSpecFor(...))` applies the same
   defaults `makeProvider` would.

The package is also renamed to `@hawkeyexl/agentevals`: the unscoped `agentevals` on npm belongs to
an unrelated project, so it was never available. The `bin` stays `agentevals`.

> **Superseded by [ADR 01008](01008-rename-the-project-to-moose-tracevals.md).** The project was later
> renamed to `moose-tracevals`, which *was* available unscoped, so the scope/bin split described
> above no longer exists.

### Consequences

- Good, because moose-tracevals is publishable. The `file:` blocker is gone, and so is the name
  collision.
- Good, because setup is a clean clone; the sibling checkout, the worktree junction, and two CI
  steps per workflow are deleted.
- Good, because a provider fix (the Windows stdin limit, a new model's price) lands once upstream
  instead of three times.
- Bad, because judge behavior now moves when the library releases. Mitigated by a semver range and
  by the library's own suite covering the mechanics moose-tracevals used to own.
- Neutral, because ADR 01001's substance stands: docevals' `makeJudge` is still page-coupled and
  still deliberately not reused. Only the source of the shared layer changed.

### Confirmation

`npm ls docevals` reports nothing, and the suite installs and passes from a clean clone with no
sibling checkout on disk. `test/unit/provider.test.ts` pins the config → `ProviderSpec` mapping,
including that every provider resolves a non-empty model so no cache key can carry `""`.
`test/unit/config.test.ts` pins that a typo'd provider name is now a validation error. CI's dogfood
gates exercise the real built CLI through the mock provider on both Linux and Windows.

## Pros and Cons of the Options

### Depend on `@hawkeyexl/inference`

- Good, because it is a library built to be depended on, published, and versioned.
- Good, because `ProviderSpec` removes the config-shape coupling that forced the YAML round-trip.
- Bad, because it is a third first-party dependency to keep current.

### Wait for docevals to publish

- Good, because it needs no new package.
- Bad, because it leaves moose-tracevals unpublishable on someone else's release schedule. It also
  keeps a peer tool as the vendor of a shared layer. docevals' public API would have to stay frozen
  around moose-tracevals' needs.

### Vendor the code back in

- Good, because it removes the dependency entirely.
- Bad, because it recreates exactly the drift this extraction was done to end. The three original
  copies each ended up holding a fix the others lacked.
