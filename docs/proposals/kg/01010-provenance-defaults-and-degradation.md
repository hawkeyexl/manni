---
status: accepted
date: 2026-07-22
decision-makers: [hawkeyexl, Claude]
---

# Provenance defaults on, with a tri-state `provenance.git` and a warnings channel

## Context and Problem Statement

ADR 01009 makes hermetic features default to on. Two opt-ins predate it:
`provenance.git` and `provenance.qualified`, both `false`. Flipping them is the
first behavior change of the roadmap, and the naive flip does not work.

Three obstacles, all confirmed against the code:

- **`provenance.git` fails hard when git is unavailable.** `collectGitHistory`
  throws `DockgError` (exit 2) when the cwd is not a git repo, has no commits,
  or git is not on PATH. Defaulting it on would turn every non-git corpus from
  a working build into an operational error. That is precisely the "on by
  default must not mean broken by default" case ADR 01009 forbids.
- **There is no warning channel.** dockg command cores return report objects and
  `cli.ts` renders them. The only diagnostic path is `fail()`'s `console.error`
  for a thrown error. Degrading "with a warning" has nothing to warn through.
- **Git provenance destabilizes the golden.** The build activity's
  `prov:endedAtTime` comes from the **HEAD committer date**. Building the
  regression corpus with git on emits
  `prov:endedAtTime "2026-07-22T14:40:31-07:00"^^xsd:dateTime`, which changes on
  every commit to this repo. The golden normalizes only `dockg:version`, so the
  corpus golden would fail on literally every commit.

`provenance.qualified` has none of these problems: it derives from data already
in the graph and emits only stable nodes (`prov:Attribution`,
`prov:Association`, `prov:hadRole`, and the qualified* properties).

## Decision Drivers

- ADR 01009's policy and its degradation rule.
- The golden is the determinism gate. It must stay stable across commits, and a
  gate that fails for reasons unrelated to derivation is worse than no gate.
- Some users genuinely require git provenance, for reproducible attribution in
  CI. Silently continuing without it would be its own failure.
- Config should be legible. A reader of `dockg.config.yaml` should be able to
  tell what will happen without knowing which values were defaulted.
- Minimal new surface; warnings must stay testable without capturing console
  output.

## Considered Options

For `provenance.git`:

1. **Tri-state `"auto" | true | false`, default `"auto"`.** `auto` attempts git
   and degrades with a warning; `true` requires it and errors when unavailable;
   `false` skips the subprocess entirely.
2. **Boolean, default `true`, always degrade.** Simple, but removes any way to
   require git provenance.
3. **Boolean, default `true`, distinguishing explicit `true` from an inherited
   default** (ADR 01009's leading candidate). Explicit errors, inherited warns.
4. **Do not flip**; leave git provenance opt-in.

## Decision Outcome

Chosen option 1, plus two supporting decisions.

**`provenance.git` becomes tri-state, defaulting to `"auto"`.** This implements
ADR 01009's principle. It is enabled wherever it can run, and an explicit
request that cannot be honored is an operational error. The behavior stays
visible in the config file rather than depending on the invisible provenance of
a value. Option 3 was rejected for exactly that reason. The same literal `true`
would mean "error" or "warn" depending on whether the user typed it. That is
difficult to document, difficult to test, and surprising to read.

**`provenance.qualified` flips to `true` outright.** No external dependency, no
degradation path needed, stable output.

**Builds gain a warnings channel.** `BuildResult` grows `warnings: string[]`;
`runBuild` collects them and `cli.ts` renders each to **stderr**, leaving stdout
clean for the build summary. Warnings never change the exit code. Exit 1 is
reserved for findings, and a degraded-but-successful build is not a finding.
This preserves the existing seam (cores return data, the CLI renders) and keeps
the behavior assertable in tests without intercepting console output.

**The regression corpus pins `provenance.git: false`.** The golden's job is to
catch derivation regressions deterministically, not to capture the repository's
commit state. Letting HEAD's committer date into it would convert the
determinism gate into a test that fails on every commit. Git-derived output
stays covered by the dedicated integration tests that build temporary
repositories with `provenance.git: true`.

### Consequences

- Good. The opinionated default arrives without breaking non-git corpora, and
  users who need enforcement have an explicit, documented way to ask for it.
- Good. Dockg gains a general diagnostic path it did not have; later phases
  (coverage, iiRDS derivation, exports) can warn instead of failing or staying
  silent.
- Good. `dockg build` in a git repo now emits richer provenance with no
  configuration, which is the point of the policy.
- Bad. The corpus golden no longer exercises the *default* value of
  `provenance.git`. A config unit test pinning the default and the existing git
  integration tests mitigate it. It is noted here so a future reader does not
  mistake the fixture's `false` for the shipped default.
- Bad. Every default build now spawns `git log` once. Cheap for documentation
  corpora, and skipped entirely under `false`.
- Bad. Builds in a git repo become sensitive to clone depth. CI checks out with
  `fetch-depth: 0`, so CI is unaffected. Shallow clones still yield partial
  history silently, which is pre-existing behavior documented in the README.
- Neutral. CLAUDE.md's determinism invariant describes git dates as living
  "behind an opt-in flag". That clause is amended here to state the
  source-of-truth rule instead. Frontmatter first, then git committer dates,
  never the wall clock. That is what the invariant actually protects.

### Confirmation

`test/unit/config.test.ts` pins the defaults `git: "auto"` and
`qualified: true`. It asserts `true`, `false` and `"auto"` all parse, and that
an unknown string such as `"maybe"` is rejected by Ajv.
`test/integration/build.test.ts` builds a temp directory that is not a git
repo. Under the default it succeeds, exits 0, and emits a warning naming the
reason on stderr while stdout keeps the summary. The same directory with
explicit `provenance.git: true` still exits 2, and `false` emits no warning and
no git triples. The existing temp-repo git tests continue to pass unchanged. The
corpus golden, regenerated once for the qualified-provenance nodes, stays
byte-identical across rebuilds.

## Pros and Cons of the Options

### Tri-state `"auto" | true | false`

- Good. Each state is meaningful and legible in the config file.
- Good. Satisfies both the opinionated default and the enforcement need.
- Bad. A non-boolean value in a boolean-looking field; schema and type become
  `boolean | "auto"`.

### Boolean, default true, always degrade

- Good. Simplest schema and simplest explanation.
- Bad. No way to require git provenance; a CI pipeline depending on it would
  silently produce attribution-free graphs after an infrastructure change.

### Boolean, default true, explicit vs inherited

- Good. No schema change.
- Bad. Identical config values behave differently based on whether they were
  written down. That is invisible in the file and awkward to document, and it
  makes `parseConfig` carry provenance-of-values state it does not otherwise
  need.

### Do not flip

- Good. No golden churn, no new surface.
- Bad. Contradicts ADR 01009 immediately after adopting it, and leaves the
  richest provenance behind a flag most users never find.
