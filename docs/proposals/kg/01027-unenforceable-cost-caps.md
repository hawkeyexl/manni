---
status: "accepted"
date: 2026-08-29
decision-makers: [hawkeyexl]
---

# An unenforceable cost cap says so, rather than reading as zero

## Context and Problem Statement

`fill.maxCostUsd` defaults to **5 USD**. The gate is one line:

```ts
if (maxCostUsd !== null && costUsd >= maxCostUsd) { /* skipped-budget */ }
```

`costUsd` accumulates `costOfUsage(usage, pricing)`, and `pricing` comes from `pricingFor(model)`,
which returns `undefined` for any model outside the six in the library's price table.
`costOfUsage(usage, undefined)` returns `0`. So for every other model the total stays `0`, the gate
never fires, `skipped-budget` is unreachable, and the run prints `LLM cost: $0.0000`.

That is not an edge case. It is every `claude-cli` model, which reports no token usage at all,
every local model, and every hosted model newer than the table. Meanwhile the cap is **on by
default**. A caller who set a limit had no limit and no way to know.

The library's own documentation names the distinction. *Costing zero is not the same as cannot be
priced.* It prescribes guarding on the price being known rather than on the number.

## Decision Drivers

- Silently not enforcing a spend limit someone asked for is the one failure here that costs money.
- `mock` and the local providers genuinely cost nothing; a fix must not break them.
- The exit-code contract: `1` means a contributor should fix a document, `2` means the pipeline is
  broken. Neither describes "your cap is unenforceable but everything else is fine."
- ADR 01010 rejected making identical config values behave differently by origin, so "fail only
  when the cap came from the CLI" is not available.

## Considered Options

1. **Report a three-state budget and warn**, as `off`, `enforced`, or `unpriceable`.
2. **Refuse the run** (exit 2) when a cap is set and the model is unpriced.
3. **Treat unpriceable as unlimited**, the status quo, documented.
4. **Assume a price** for unknown models from a conservative default.

## Decision Outcome

**Option 1 was chosen.**

`FillReport` gains `budget: "off" | "enforced" | "unpriceable"` and a `warnings: string[]`. The gate
now tests an `enforcedCap` that is null unless the cap is both set *and* applicable. It cannot
fire on a run whose total means nothing. The pretty renderer prints `LLM cost: unpriceable` instead
of `$0.0000`. The warning goes to stderr with the two ways to resolve it. Set `fill.pricing`,
or set `fill.maxCostUsd: null` to say you meant no cap.

Option 2 was rejected on blast radius, not on principle. The cap is on by default and `mock` is
unpriced, so refusing would fail `dockg fill --provider mock`, the offline path the docs recommend,
along with every local run. Refusing is the right answer for a *hosted* provider, but dockg cannot
distinguish hosted-and-unpriced from local-and-free through `pricingFor`, which returns `undefined`
for both. When it can, this decision is worth revisiting.

Option 4 was rejected outright. A made-up price produces a cap that fires at the wrong time, which
is worse than a cap that visibly does not fire.

### Consequences

- **Behavior change, visible:** a warning on stderr and a different cost line for anyone running an
  unpriced model with a cap. Exit codes are unchanged; a warning never gates.
- `budget` is the field a machine consumer should read. `costUsd` alone cannot distinguish a free
  run from an unmeasured one, and never could.
- `skipped-budget` becomes genuinely unreachable under `unpriceable` rather than accidentally so.
- The gap remains that dockg cannot enforce a cap on an unpriced hosted model. It is now loud
  instead of silent, which is the whole change.

### Confirmation

`test/unit/fill.test.ts` covers three cases. An unpriced model with a cap reports `unpriceable`,
warns once naming the model, still processes every document, and renders `LLM cost: unpriceable`
rather than `$0.0000`. A priced model reports `enforced` and warns not at all. And
`maxCostUsd: null` reports `off` with no warning, because an unpriced model is only a problem when
a limit depends on the price. The existing "stops proposing when the cost budget is exhausted" test
still passes unchanged. Its comment already said *"model name must be priced in the cost table for
the budget to accrue"*.

## Pros and Cons of the Options

### 1. Three-state budget and a warning

- Good, because it names the state that was previously indistinguishable from zero cost.
- Good, because it breaks nothing: free providers keep working, the exit code is untouched.
- Bad, because the cap still does not enforce. It cannot; the honest move is to say so.

### 2. Refuse the run

- Good, because a cap that cannot be honored arguably *should* stop the run.
- Bad, because the default cap plus an unpriced `mock` means it would fail the documented offline
  path, and every local run with it.

### 3. Status quo, documented

- Good, because it costs nothing to implement.
- Bad, because the failure is invisible at exactly the moment it matters. That is the run where an
  unpriced hosted model spends past the limit that was set.

### 4. Assume a price

- Good, because the cap would always fire.
- Bad, because it fires at a fabricated threshold. A wrong limit is worse than a visible non-limit.
