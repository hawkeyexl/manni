---
status: "accepted"
date: 2026-08-29
decision-makers: [hawkeyexl]
---

# A config-defined eval is one generation target, however many pages use it

## Context and Problem Statement

`moose-docevals generate` exited 1 on runs where everything it was asked to do
succeeded.

Two pieces of code counted the same work differently. `runGenerate`
(`src/commands/generate.ts`) pushed one `GraderTarget` per *(page, eval)* pair.
`makeGenerateScripts` (`src/graders/scriptgen.ts`) carries a `doneConfigEvals`
set and generates a config-sourced eval exactly once. That is correct. A
config eval's script is written to one shared location under
`config.scripts.configDir`. The command reference persisted back into the
config points at that one path.

So a config-defined eval used by two pages produced
`{ generatedPaths: [one path], targets: 2 }`. `src/cli.ts` then printed
`Generated 1/2 check script(s):` and ran:

```ts
if (result.generatedPaths.length < result.targets) {
  process.exitCode = 1;
}
```

The second failure is the worse one. The first is a false red on a working
command; the second is that `generatedPaths.length < targets` stopped being able
to mean anything. It is the only signal `generate` has for "some generations
actually failed". Once it fires on a healthy run, nobody can act on it, and the
comparison is spent.

`runPromote` (`src/commands/promote.ts`) has carried a `seenConfigEvals` guard
against exactly this since it was written; `runGenerate` never got one.

## Decision Drivers

- **An exit code has to mean one thing.** A failure signal that fires on success
  is worse than no signal, because it trains the reader to ignore it.
- **The two counts describe the same work** and are compared directly, so they
  have to be denominated in the same unit.
- **There is already a right answer in this repo.** `runPromote` solved it;
  divergence between two commands over the same question is a maintenance cost
  with no upside.

## Considered Options

1. **Dedupe config-sourced evals in `runGenerate`.** Chosen.
2. Generate one script per page for a config eval.
3. Weaken the CLI comparison to `generatedPaths.length === 0 && targets > 0`.
4. Drop the exit-code comparison entirely.

## Decision Outcome

**Option 1 wins.** `runGenerate` mirrors `runPromote`. A config-sourced eval
becomes a target the first time it is seen and is skipped thereafter:

```ts
if (ev.source === "config") {
  if (seenConfigEvals.has(ev.name)) continue;
  seenConfigEvals.add(ev.name);
}
```

This settles what `targets` *means*, which is the part worth recording: it counts
**units of generation work**, not (page, eval) pairs. That is the unit
`generatedPaths` is already in, and the unit the exit code is computed from.
Page-sourced evals are unaffected and remain one target per page, because each
page genuinely gets its own script beside it.

### Consequences

- `generate` exits 0 when it generated everything it set out to, and the
  `Generated N/M` line reports two numbers in the same unit.
- `generatedPaths.length < targets` is a usable signal again: it now means a
  generation was attempted and did not produce a script.
- A user watching the count will see a smaller `M` than before on a corpus with
  shared config evals. That is the correction, but it does look like a change in
  scope to someone who had learned to read the old number.
- The two commands that walk plans looking for work, `promote` and `generate`,
  now agree. `runEvals` deliberately does not dedupe: it grades a config eval
  once *per page*, because the finding is about the page.

### Confirmation

`test/unit/generate.test.ts` covers both routes a page has to a config-defined
eval, since they are separate branches of `resolvePage` and covering one does not
cover the other:

- `- use: <id>` on the page, and
- `eval-suite: <name>` pulling in the suite's whole membership list with no
  `evals:` key on the page at all.

Each asserts `targets === 1` and `generatedPaths.length === 1` for a two-page
corpus. Both were verified to fail (`expected 2 to be 1`) with the dedupe removed
and to pass with it restored.
