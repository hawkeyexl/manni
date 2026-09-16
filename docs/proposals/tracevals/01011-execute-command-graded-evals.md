---
status: "accepted"
date: 2026-08-28
decision-makers: [hawkeyexl]
consulted: [docmeta proposal 0023 review]
informed: [docevals]
---

# Execute `command`-graded evals, on by default

## Context and Problem Statement

The vocabulary adopted in [ADR 01010](01010-adopt-the-docmeta-artifact-evals-vocabulary.md) adds a
`command` grader. An eval may name an executable, which moose-tracevals runs over the session trace
and grades by exit code. `{trace}` in the argv is replaced with the trace path, the artifact-side
analog of the page side's `{file}`.

This is the one addition in the vocabulary with a security surface. Artifacts are resolved from the
**trace's own project tree**, so evaluating someone else's trace can run code that repository
declares. Nothing else in this tool executes anything: evaluation was previously pure reading.

## Decision Drivers

- Some adherence claims are trivially checkable by a script and awkward for a judge ("no force
  push appears in this session"). Paying for inference to answer them is waste.
- A declared eval that cannot run must never read as a pass; that is the existing invariant.
- The execution surface is real and must be documented where someone will find it, not buried.
- The tool is already routinely pointed at traces from projects the user did not write.

## Considered Options

- Implement it, running by default
- Implement it behind an explicit config opt-in, off by default
- Accept it in the schema but reject it in the registry, deferring execution

## Decision Outcome

The chosen option is to **implement it, running by default.** An eval that declares a command is
asking for that command to run. A gate that silently turns declared evals into errors would make the
vocabulary's own example non-functional out of the box.

The surface is stated rather than mitigated away, and two properties bound it. Both are free, and
neither costs the default behavior:

- **argv, never a shell.** The command is an array spawned with `shell: false`, so nothing in an
  artifact is parsed as shell syntax. Pipes, redirects, `;`, and `$(...)` reach the process as
  literal argument text. Pinned by a test that asserts exactly this.
- **Always bounded.** `timeout-ms` defaults to 30 000ms, so a hung or deliberately slow check fails
  its own eval rather than the run.

Commands run with `cwd` set to the artifact-resolution project root, falling back to the trace's
`cwd`. A repo-relative script path therefore resolves the way its author wrote it.

Four states produce `outcome: "error"` rather than a verdict, because none of them can honestly be
called a pass:

| State | Why it errors |
|---|---|
| `grader: command` with no `command` | The schema's legal "generation contract" state. This tool generates no check scripts; the eval cannot run. |
| `generated-assertion-hash` ≠ `sha256(assertion)` | The assertion was edited after the script was generated, so the command no longer checks what the eval claims. |
| The executable cannot be spawned | A missing script is a broken eval, not a satisfied one. |
| The command overruns its timeout | An unfinished check has no verdict. |

`fill` **never proposes** a command grader. It is absent from `ALLOWED_GRADERS`, and the grader
deliberately implements no `validateOptions`. "A kind without it cannot be proposed" is the
registry's existing contract (ADR 01004). Its configuration is the entry itself, not `options`, so
there is nothing for that hook to check anyway. Writing an executable into an artifact is a
decision a human makes.

### Consequences

- Good, because cheap mechanical checks stop costing inference calls, and their verdicts are exact
  rather than probabilistic.
- Good, because the failure modes are all loud: four distinct error messages, none of which can be
  mistaken for a pass.
- Bad, because `moose-tracevals run` over an untrusted trace can execute that project's code. This
  is the accepted cost of the feature. It is documented here, in the grader reference, and in the
  module header of [src/graders/command.ts](../src/graders/command.ts).
- Neutral, because `command` runs under `--deterministic-only`: it is deterministic and needs no
  provider. A CI run that avoids inference still runs commands.

### Confirmation

- [test/unit/graders/command.test.ts](../test/unit/graders/command.test.ts) covers pass, non-zero
  exit, `success-exit-codes`, `{trace}` substitution, severity, and timeout. It also covers the
  missing-command and hash-drift errors, an unspawnable executable, and the no-shell containment.
- The fixture corpus declares a real command eval, backed by the script at
  [test/fixtures/project/tracevals/no-force-push.mjs](../test/fixtures/project/tracevals/no-force-push.mjs)
  in the repository. [ci.yml](../.github/workflows/ci.yml) asserts it passes with
  `grader: "command"`, so the spawn path is exercised on both OS legs of every run.

## Pros and Cons of the Options

### Running by default

- Good, because a declared command does what it says, with no second step.
- Good, because the vocabulary's documented example works as written.
- Bad, because it is the one code-execution path in an otherwise read-only tool.

### Behind a config opt-in

- Good, because execution would require a deliberate act by the repo owner.
- Bad, because every command eval silently becomes an error until someone finds the flag, which
  reads as the feature being broken.
- Bad, because the opt-in lives in the *evaluating* repo's config while the risk comes from the
  *evaluated* repo's artifacts. It gates the wrong side.

### Schema-only, execution deferred

- Good, because it defers the surface entirely.
- Bad, because the open enum already makes `grader: command` validate, so the vocabulary would
  advertise a grader this tool refuses. That is the worst of both.
