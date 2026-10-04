---
status: accepted
date: 2026-08-29
decision-makers: hawkeyexl
---

# Documented command output is executed, not trusted

## Context and Problem Statement

dockg's docs quote command output constantly, because determinism makes that output a promise.
What the page shows is what every reader gets, byte for byte. That promise is only worth making
if something checks it. Nothing did, and eight documented numbers had drifted from what the CLI
produces. One of them, `retrieve/export.mdx`'s "17 nodes to kg/graph.jsonld" against an actual 33,
had never matched any build of any corpus. It was the `search.json` count pasted into the JSON-LD
block, wrong the day it was written.

Doc Detective is the runner for this, and it has been attempted here before. It lived and died
inside PR #25's branch on 2026-08-03: added, corrected, reverted 53 minutes later. The revert
records no technical failure. It was a scope cut.

What makes this decision worth recording rather than filing as tooling is that **the obvious
setup is silently broken in two independent ways**. Both were reached the first time:

1. **The runner exits 0 on failing steps by default.** `exit_on_fail` defaults to `false` in the
   GitHub Action, so a red run reports green.
2. **A step with a schema error is skipped, at warn level, and the run still passes.** `runShell`
   asserts output through a single `stdio` field matching stdout *or* stderr, and the step object
   is `additionalProperties: false`. Steps written with `stdout` or `stderr` fail validation, log
   `isn't a valid step. Skipping.`, and return. doc-detective's own bundled reference shows those
   in a `runShell` example. The first integration **silently dropped 22 of 33 steps and was
   green**, and the 11 survivors were exactly the ones with no output assertion.

A gate that reports green while running a third of its cases, or none of them, is worse than no
gate. It converts "unverified" into "verified" in every reader's mind, including the
maintainer's.

## Decision Drivers

- **A gate that cannot fail is not a gate.** The same principle ADR 01026 applies to mocks and
  ADR 01007 applies to hooks-versus-CI.
- **Silent skips must be impossible to mistake for passes.** The failure mode here is not "a
  test failed", it is "a test did not run", which no assertion inside the test can detect.
- **CLAUDE.md already forbids hand-written command output.** That rule needs an enforcer, or it
  is a convention people follow until they are in a hurry.
- **Fork PRs execute shell from the pull request's own content.** Whatever this runs, it must not
  hand an untrusted contributor a shell on the repo's runner with the repo's secrets.

## Considered Options

1. **Run Doc Detective with `--exit-on-fail`, plus a second guard that diffs declared steps
   against executed steps.**
2. **Run Doc Detective with `--exit-on-fail` alone.**
3. **Assert command output from vitest instead**, dropping the runner.
4. **Keep the convention unenforced**, as it was before.

## Decision Outcome

**Option 1 was chosen**, with three sub-decisions.

**`--exit-on-fail` is mandatory, and passed on the command line rather than left to config.** The
default is the wrong way round for a gate. A default that must be overridden to be correct is
one edit from being wrong again.

**`scripts/check-doc-tests.mjs` ships beside the runner and is not optional.** It parses the
`{/* step … */}` blocks declared in the pages, reads the runner's results JSON, and fails on any
mismatch in either direction. That is a declared step that did not execute, or an executed step
that did not pass. This is the part that makes a silent skip visible. Without it, a dropped step
and a passing step are the same observation. It is why the count in its output is stated as
`N declared · N executed` rather than a pass tally.

**Coverage is partial, and the boundary is a rule rather than a list.** A page is in the gate when
its output can be produced by running the built CLI against a committed fixture. The count is
whatever `npm run docs:test` reports, deliberately not written down here. An ADR about
transcribed numbers drifting is the last place to transcribe one. (An earlier draft of this
section did exactly that, and was wrong within the same pull request.)

Two categories sit outside it, and both are gaps rather than decisions to leave alone:

- **Pages illustrating a corpus that exists nowhere in the repo.** Frontmatter examples chosen to
  teach a shape, not to be run. These are prose about a hypothetical, so no command's output could
  be asserted. Closing this would mean inventing a second corpus to serve illustration.
- **Pages quoting output from a corpus no fixture reproduces.** These are the real residue. The
  output is real; it just came from a corpus the gate cannot rebuild. Each is closable by adding a
  fixture, one page at a time. `retrieve/search.mdx` was closed exactly that way. Its vector
  transcript runs under `embed --model mock`, which is deterministic and downloads nothing
  (ADR 01025).

Naming the categories rather than the members is what keeps this true as coverage grows. An
unexplained gap in a gate reads as an oversight and invites someone to "fix" it by weakening the
gate. An enumerated one goes stale the first time somebody closes an item.

**Fixtures live in `test/fixtures/dd/`, never in `test/fixtures/corpus/`.** The corpus fixture
feeds six byte-exact goldens; a file added to it to serve a doc page would invalidate all six.
Each dd scenario gets its own config file so its settings cannot perturb the counts another
page's steps assert.

**The job runs in its own workflow, and is skipped on fork PRs.** Its steps execute shell from
the PR's own content, so it cannot be granted a fork's trust level. A skipped job does not block.
That means **fork contributions are unverified for command output**, stated plainly in
CLAUDE.md rather than left for someone to discover.

### Consequences

- Good. The eight drifted numbers were found and re-captured, and cannot drift again unnoticed.
- Good. `dockg`'s "what you read is what you get" claim is now checked by the same determinism
  that makes it true.
- Bad. A page cannot be doc-tested without a fixture, so adding one has a real cost. That cost is
  the point. It stops a transcribed approximation from being written in the first place.
- Bad. Coverage is uneven, and the gate does not run on fork PRs. Both are documented rather than
  papered over.

### Confirmation

- The test of the test ran before this landed. Mutate one documented number and confirm the job
  **fails**. Then delete a declared step's execution and confirm `check-doc-tests.mjs` fails on
  the mismatch. The first integration was green while dropping two thirds of its steps, so a
  green run on its own proves nothing about this gate.
- `npm run docs:test` reports `N pages · N steps declared · N executed`, with the two counts
  equal. That equality is the assertion, not the number.

## Pros and Cons of the Options

### 1. `--exit-on-fail` plus a declared-vs-executed guard

- Good. The only option that detects a step that never ran, which is the failure that actually
  occurred here.
- Good. The runner and the guard read the same results file, so the two cannot disagree about
  what happened.
- Bad. A second script to maintain, and it must be kept in step with the block syntax.

### 2. `--exit-on-fail` alone

- Good. One moving part.
- Bad. Does not detect a skipped step at all. That is the exact failure mode that made the
  previous integration green while it ran a third of its cases. This is option 1 minus the part that
  matters.

### 3. Assert command output from vitest

- Good. No new dependency; the suite already runs the built CLI against fixtures.
- Good. No fork-PR trust problem, since it runs in the normal suite.
- Bad. The assertions live away from the prose they describe, so a page edit and its test drift
  apart in the ordinary course of editing. That is the whole failure being fixed, relocated.
- Bad. Nothing then ties a *documented* block to a *tested* command. A page could quote output no
  test covers and look identical to one that is covered.

### 4. Leave the convention unenforced

- Good. Zero cost.
- Bad. Measured false. Eight numbers had drifted, one had never been right, and the rule against
  hand-writing output was already in CLAUDE.md the whole time.
