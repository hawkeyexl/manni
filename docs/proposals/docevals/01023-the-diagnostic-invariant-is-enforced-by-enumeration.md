---
status: "accepted"
date: 2026-08-29
decision-makers: [hawkeyexl]
---

# The diagnostic invariant is enforced by enumeration, not by inspection

Supersedes the *completeness claim* of
[ADR 01022](01022-a-grader-that-reached-no-verdict-fails-the-eval.md), whose
decision was right and whose survey was wrong. The reason is the one 01022
gave, in the same words, about
[ADR 01020](01020-unreadable-tool-output-is-a-finding-not-a-pass.md).

## Context and Problem Statement

The invariant is settled and has not changed. **A finding that says the grader
could not reach a verdict is not a claim about the page. It must not be
downgradable by the eval's severity.** ADR 01022 states it, and
`src/core/engine.ts` enforces it in one line:

```ts
const hasError = own.some((f) => f.severity === "error" || f.diagnostic === true);
```

What keeps failing is not the rule. It is the claim that the rule has been
applied everywhere:

- ADR 01020 fixed one adapter and closed with *"No second instance of this
  defect was found."* There were three.
- ADR 01022 found those three, introduced `diagnostic`, and wrote that *"Every
  'the tool did not run / its output could not be read' finding across all six
  graders is marked `diagnostic: true`."* There were four more.

The four:

1. **`tool:doc-structure-lint`, missing `options.template`.** With no template
   the tool is never invoked. At `severity: warning` the eval reported and
   passed, having checked nothing. Found in review.
2. **`tool:doc-detective`, timeout.** The branch's own comment says it matches
   `commandGrader`, and `commandGrader`'s timeout *is* a diagnostic. This one
   was not.
3. **`tool:doc-detective`, non-zero exit with no parseable report.** What an
   uninstalled or misconfigured doc-detective produces. ADR 01022 already
   identified the non-zero-exit branch as *"the likeliest trigger of all"* in
   the adapter it was fixing, and did not check this one.
4. **`tool:markdownlint`, timeout and non-zero exit with nothing parseable.**
   The worst of the four, and the only one that is invisible rather than merely
   downgradable. The adapter inspected `spawnError` and nothing else. A
   timed-out or misconfigured run parsed zero findings, returned `[]`, and
   **every eval in the batch passed**. That is the original ADR 01020 defect,
   in a different adapter, still open two ADRs later.

Three rounds is enough to say what the actual problem is. Reading six adapters
and asking "does each remember?" is a check whose failure mode is silence. It
has now produced a false clean bill of health twice. The tests did not
compensate, because they were written at the default severity. There
`severity: "error"` and `ev.severity` are the same value, so the assertion
passes either way. The test in `doc-structure-lint.test.ts` named
`unreadable output cannot be downgraded` could not fail.

## Decision Drivers

- The invariant is worth exactly as much as its weakest adapter, and a survey
  cannot tell you which one that is.
- The failure is silent by construction. A missing flag produces a *passing*
  run, so nothing draws attention to it.
- A seventh adapter will be written by someone who has not read this file.

## Considered Options

1. **An enumerating test over every grader's no-verdict paths.** Chosen.
2. Fix the four and survey again more carefully.
3. A lint rule requiring `diagnostic` on any finding whose message matches
   /failed|timed out|could not/.
4. Restructure `Grader` so no-verdict outcomes cannot be expressed as a
   `Finding` at all. This is ADR 01022's rejected option 4.

## Decision Outcome

**Option 1 wins**, plus the four fixes.

`test/unit/no-verdict.test.ts` enumerates, per grader, every shape in which its
tool can fail to answer. Those are spawn failure, timeout, non-zero exit with
unreadable output, and missing required configuration. Each row drives the real
adapter with a fake `exec` and asserts three things:

- **at least one finding**, because silence is the failure mode 01020 opened on;
- **every finding carries `diagnostic: true`**;
- **severity is untouched**, since rewriting it is 01022's rejected option 2 and
  would take `warning` away from real findings.

Every eval in the file is at **`severity: warning`**, deliberately. At the
default `error` these assertions hold whether or not the flag is set. That is
precisely how the previous round's tests managed to be vacuous.

Two complement cases sit beside it, asserting those are *not* diagnostics. They
cover markdownlint lint output and a command that simply exits non-zero.
Without them, marking everything `diagnostic: true` would satisfy the block
above while destroying what severity means.

**Adding a grader means adding its rows.** That is a convention, not a
mechanism, and it is a weaker guarantee than the engine gives. It is still
strictly better than the two surveys it replaces. A missing row is visible in a
diff, where a missing flag is visible only in a run that passes.

Rejected, and why:

- **Option 2** is what ADR 01020 and ADR 01022 each did. It has a measured
  record: two attempts, seven missed instances.
- **Option 3** matches on message prose, which is exactly the coupling
  `src/judge/budget.ts` was created to remove. It would also miss the
  markdownlint case entirely, since there is no message to match.
- **Option 4** remains the cleanest model and remains too large. `Finding[]` is
  the grader contract, consumed by every reporter, the baseline fingerprint,
  and the SARIF and JUnit writers.

### What making markdownlint honest uncovered

Marking the markdownlint paths turned this repo's own `verify-docs` gate red,
which is the point. **Two further defects were sitting behind the silent pass,
and neither was reachable while it held.**

1. **`markdownlint-cli2` was a dependency of nothing.** Not in the root
   `package.json`, not in `docs/`, not installed by the `verify-docs` job. The
   docs config declares a `tool:markdownlint` eval on every page, and
   `npx --no-install markdownlint-cli2` had been failing on every run since the
   gate was written. All 34 evals passed. `verify-docs` reported 102/102 with a
   third of it never executed.
2. **`parseMarkdownlintOutput` did not match the tool's output.**
   markdownlint-cli2 0.23 prints a severity token between the position and the
   rule id, as in `file.md:6:81 error MD013/line-length ...`. The pattern was
   written against an older format and matched none of it. So even with the
   tool installed, every finding was dropped and every eval still passed.

Two independent faults, stacked, each hidden by the other and both hidden by
the missing flag. Installing the tool and widening the pattern surfaced **1,416
markdownlint findings** across the docs corpus that had never been reported.
They are `severity: warning` there by configuration, so they report and pass.
That is the intended behavior, and it is now actually happening.

This is the strongest argument for the decision above. Three ADRs treated this
as a question of whether adapters remember a flag. The flag was the visible
part; what it was covering was a gate that had never run.

### Consequences

- A `severity: warning` eval on **markdownlint** or **doc-detective** now fails
  where it previously passed, when the tool times out, is missing, or is
  misconfigured. Same consequence ADR 01022 recorded, now reaching the adapters
  it missed. For markdownlint this is the larger change: those runs previously
  produced no finding at all, so there was nothing in the report to notice.
- `markdownlint-cli2` exits 1 *because* it found issues, so the new branch
  fires only when nothing parsed. A normal lint failure is unaffected.
- The `no-verdict.test.ts` matrix is a maintenance obligation with no
  enforcement behind it. Recorded as such rather than described as a guarantee.
- `markdownlint-cli2` joins `devDependencies`, so the docs gate runs the tool
  it has always claimed to run. A tool an eval names must be installed by the
  job that runs the eval. Nothing checks this, and the diagnostic flag is now
  what makes a violation loud.
- The `doc-detective` non-zero-exit branch splits: with a readable failure
  report it stays an ordinary finding, without one it becomes a diagnostic.
  A run that fails and prints a parseable report is a verdict about the page.

### Confirmation

All five previously-unflagged paths were verified to fail before the fix. Two
of them (`markdownlint` timeout, `markdownlint` non-zero) failed as
`expected 0 to be greater than 0`, which is the silent-pass shape stated as an
assertion. The full suite passes at 456 tests with no other test changing,
which is itself evidence: nothing had been depending on the old behavior.
