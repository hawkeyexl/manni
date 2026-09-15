---
status: "accepted"
date: 2026-08-29
decision-makers: [hawkeyexl]
---

# A grader that reached no verdict fails the eval, at any severity

Supersedes the scope of [ADR 01020](01020-unreadable-tool-output-is-a-finding-not-a-pass.md),
whose decision was right and whose survey was wrong.

## Context and Problem Statement

ADR 01020 established that unreadable tool output is a finding rather than a
pass, and fixed `tool:doc-structure-lint`. It closed with a survey:

> The other five adapters were reviewed for the same shape while writing this.
> […] No second instance of this defect was found.

That is false, and the review that found it also found the fix incomplete in the
adapter it did fix. Three separate problems, one cause:

1. **The survey missed three instances.** `src/graders/tools/vale.ts` emits
   `Failed to run vale … (is it installed?)` and `Vale produced no JSON output`
   at `ev.severity`. `src/graders/tools/docmeta.ts` emits `docmeta/no-schemas`
   at the eval's severity, and ADR 01013 makes `options.schemas` mandatory, so
   a `severity: warning` docmeta eval with no `schemas` key passes forever
   having validated nothing. `markdownlint`, `doc-detective` and the `command`
   grader have the same shape for spawn failures and timeouts.

2. **The fix itself was incomplete.** 01020's implementation only reached the
   `exit 0` branches. The non-zero-exit branch and the spawn-failure branch kept
   `ev.severity`. The non-zero branch is the *likeliest* trigger of all,
   because it is what an uninstalled tool produces.

3. **The mechanism was wrong.** Hard-coding `severity: "error"` inside one
   adapter states a universal property in a place that only one adapter reads.
   The next adapter gets it wrong by default, which is exactly what happened
   here across five of them.

The property is not about `doc-structure-lint`. **A finding that says the
grader could not reach a verdict is not a claim about the page. It must not be
downgradable by the eval's severity.** Severity expresses how much a *page
problem* matters. It has no jurisdiction over whether the check ran.

## Decision Drivers

- The invariant is one sentence and applies to every grader, so it belongs in
  one place.
- A new adapter must inherit it rather than remember it.
- Severity must keep meaning what it means for real findings. A
  `severity: warning` lint check should still report and still pass.

## Considered Options

1. **A `diagnostic` flag on `Finding`, enforced once in the engine.** Chosen.
2. Hard-code `severity: "error"` in every adapter's diagnostic paths.
3. A reserved `ruleId` prefix (`*/unreadable`) the engine special-cases.
4. A separate `GraderError` channel outside `Finding[]`.

## Decision Outcome

**Option 1 wins.** `Finding` gains `diagnostic?: boolean`, and
`src/core/engine.ts` computes the outcome as:

```ts
const hasError = own.some(
  (f) => f.severity === "error" || f.diagnostic === true,
);
```

Every "the tool did not run / its output could not be read" finding across all
six graders is marked `diagnostic: true`. Each keeps `ev.severity` for display,
so a warning-severity eval still renders its diagnostic as a warning. It still
fails, because no verdict was reached.

Rejected, and why:

- **Option 2** is what 01020 did in one adapter. It is five copies of an
  invariant, and the sixth adapter will not have it.
- **Option 3** couples the engine to a string convention that nothing enforces,
  and a typo in a `ruleId` silently reopens the hole.
- **Option 4** is the cleanest model but a much larger change. `Finding[]` is the
  grader contract, and every reporter, the baseline fingerprint, and the SARIF
  and JUnit writers consume it. A second channel is worth revisiting if
  diagnostics ever need to carry more than a message.

### Consequences

- A `severity: warning` eval now **fails** when its tool is missing or broken,
  where it previously passed. That is the point. It will look like new
  breakage to anyone whose tooling was already silently absent, which is the
  population this exists to inform.
- `diagnostic` joins `Finding`, so it appears in `--format json`. The baseline
  fingerprint deliberately ignores it, and identity stays
  `(file, evalName, ruleId)` per ADR 01017. Baselining a diagnostic is therefore
  possible, and remains a way to accept a permanently-missing tool. That is a
  real escape hatch, and it is at least explicit.
- The rule is now stated once. A seventh adapter inherits it by writing
  `diagnostic: true`, and the engine needs no change.

### Confirmation

`test/unit/doc-structure-lint.test.ts` covers the shapes that reach no verdict.
Those are unparseable stdout at exit 0, JSON of the wrong shape, and a list of
non-objects. They also include a list containing null, an entry whose `errors`
is not a list, a non-zero exit, and a spawn failure. Each must produce exactly
one finding carrying `diagnostic: true`, and a real structure error must not.
The engine's own `hasError` rule is what turns that flag into a failure, so the
two are tested where each lives.
