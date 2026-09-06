---
status: "accepted"
date: 2026-08-03
decision-makers: [hawkeyexl]
---

# Fix the Doc Detective adapter's invocation, failure detection, and finding granularity

## Context and Problem Statement

Wiring the documentation site's verification through `moose-docevals run` (ADR 01004) exercised the
`tool:doc-detective` grader for the first time. It had never actually been run against the real tool,
and it was broken in two independent ways:

1. **The invocation was wrong.** The default argv was
   `["npx", "--no-install", "doc-detective", "run"]`. Doc Detective 4.x runs tests as its **default**
   command and has no `run` subcommand. Every invocation therefore failed with
   `Unknown argument: run`, and the grader reported `doc-detective exited 1`. Verified against 4.26.0 and 4.37.1. Any user
   configuring a `tool:doc-detective` eval hit this unless they overrode `options.command`.
2. **Findings were multiplied by the results tree depth.** `collectFailures` walked the results blob
   and pushed a finding for *every* node with `result`/`status === "FAIL"`. Doc Detective repeats
   FAIL at every level, from assertion to step, context, test, and spec. **One broken step
   therefore produced five findings**, four of them labelled `"step failed"` with no detail. This was invisible while defect
   1 made the adapter fail before it ever parsed output.
3. **Every failing doc test passed silently.** Found in review, and the worst of the three. Two facts
   compound. Doc Detective **exits 0 on test failures** unless `--exit-on-fail` is passed. 4.x also
   writes its results JSON to a *file*, printing only a coloured summary to stdout. So
   `lastJsonBlob(result.stdout)` found nothing, `collectFailures` returned `[]`, and `result.code`
   was `0`, with no finding from either path. Verified end to end: a step asserting `exitCodes: [0]` on a
   command that exits 9 reported `pass`, and `moose-docevals run` over the docs exited 0.

Defect 3 made ADR 01004's central claim false. That claim was "a documented
command that drifts from the code fails the build". The gate existed and verified
nothing.

The adapter had no tests, which is how all three survived. Note that unit tests alone would not have
caught defect 3. The injected `exec` returns whatever the test supplies, and the natural thing to
supply for a failure is a nonzero code. Only running the real binary revealed that the real one
returns 0.

## Decision Drivers

- The docs site is now gated on this grader; a broken adapter blocks the whole verification story.
- The grader is public surface, so a user's `tool:doc-detective` eval must work without a workaround.
- A findings list that reports one failure five times is unreadable in a pull request, which is
  precisely where it lands.
- CLAUDE.md: adapters are tested against captured tool output with an injected `exec`, never a real
  binary.

## Considered Options

**For the invocation**

1. Drop the subcommand: `["npx", "--no-install", "doc-detective"]`.
2. Keep the default and document `options.command` as required.
3. Detect the installed version and branch.

**For the granularity**

A. **Report only the deepest FAIL** in each branch.
B. **Report a FAIL only when it can name itself, and only when nothing below it reported.** Recurse
   first, skip ancestors of reported failures, and skip unlabelled nodes.
C. Special-case the known shape, walking `specs[].tests[].contexts[].steps[]` explicitly.

**For detecting failure at all**

X. **Append `--exit-on-fail`** so a failing step produces a nonzero exit the adapter already handles.
Y. **Read the results file** whose path Doc Detective prints on stdout.
Z. Ask for a stdout JSON reporter (`--reporters json`) and parse that.

## Decision Outcome

**Option 1** wins for the invocation, **option B** for the granularity, and **option X** for
detection.

`--exit-on-fail` is appended **unconditionally, including over a user's `options.command` override**.
That is a deliberate exception to "the override wins". The grader cannot detect a failure without it,
so leaving it droppable means a user can silently disable the check they configured. `--input` is
already appended the same way.

Option Z was tested and rejected on evidence. `--reporters json` still keeps the results off stdout
(verified against 4.37.1; stdout contained no `"specs"` key either way). Option Y would give
per-step findings but couples the adapter to the filesystem, which it currently touches only through
the injected `exec`. That is a testability property worth keeping. Instead, `extractFailureReport` scrapes
the human-readable "Failed Steps" block from stdout, which names each failed step and its error. That
is strictly better than the alternative it replaced. The previous fallback printed the last 300 bytes
of *stderr*. On 4.x that is ~75 KB of ajv "strict mode" schema warnings saying nothing about the
test.

Option A looks equivalent to B but is wrong in this shape. The deepest FAIL is the *assertion*, which
carries a `statement` but no `description` or `resultDescription`. Reporting it yields
`"step failed"` with no detail and discards the useful message. The node worth reporting is the
**step**, one level up, which holds both `description` ("A step that fails on purpose.") and
`resultDescription` ("Returned exit code 7. Expected one of [0]").

So the rule is two-part:

- **Recurse first.** If anything below reported, this node is an ancestor of a real failure and adds
  nothing. That collapses context, test, and spec.
- **Only report a node that can name itself** via `description`, `id`, or `stepId`. That skips the
  unlabelled assertion in favour of its parent step.

A FAIL with nothing readable anywhere now yields no findings; the caller's existing nonzero-exit
fallback catches that.

**On `--allow-unsafe`: not needed, and deliberately not set.** This was tested empirically. A
`runShell` step invoking the moose-docevals CLI executes without it, both in a scratch probe and in the
four real steps now embedded in `reference/index.mdx`. Adding it would widen what a content file can execute for no
benefit, which cuts directly against the fork-safety posture in ADR 01004.

### Consequences

- Good, because `tool:doc-detective` works out of the box, and the workaround override in
  `docs/moose.config.yaml` is reduced to the config path it legitimately needs.
- Good, because one failed step is one finding, with the message a human can act on.
- Good, because the adapter now has tests. Those cover argv shape, override handling, the
  empty-results pass, the one-finding-per-step rule, the exit-code fallback, and spawn errors.
- Bad, because it is **a breaking change for anyone who worked around defect 1** by setting
  `options.command: [..., "run"]`. Their override still wins and still fails. Acceptable pre-1.0, and
  the failure is loud and self-describing.
- Neutral, because the argv is pinned to Doc Detective 4.x's CLI. A future major that reintroduces a
  subcommand breaks it again. The pinned devDependency and the test asserting the exact argv mitigate
  that, and fail loudly rather than drifting.

On 4.x the `collectFailures` path is effectively dormant. No results JSON reaches stdout, so the
nonzero exit plus `extractFailureReport` carry every finding. It is kept rather than deleted because
it costs nothing and is now correct and tested. It also handles any version or reporter configuration
that does put a blob on stdout. If a future release restores that, per-step findings resume automatically.

### Confirmation

- `test/unit/graders.test.ts` → `describe("docDetectiveGrader")`, seven cases with an injected
  `exec`. One is built from real captured 4.x output (`test/fixtures/tool-output/
  doc-detective-fail.json`). One reproduces the silent-pass shape exactly: exit 1, no JSON on
  stdout, coloured summary on stdout, ajv noise on stderr. The argv tests assert the exact array,
  `not.toContain("run")`, and that `--exit-on-fail` survives a command override.
- **End to end, both directions.** Appending a step asserting `exitCodes: [0]` on a command that
  exits 9 makes `npm run docs:verify` exit 1 with
  `[doc-detective/step] Failed Steps: … Error: Returned exit code 9. Expected one of [0]`; removing
  it returns the run to 24/24 at exit 0. Checking only the green direction is what let defect 3
  survive the first time. A gate must be shown to fail before a pass means anything.
- Writing those steps also caught a false claim in the draft of the page carrying them. An unknown
  `--format` on `list` exits 0, not 2, and that was caught before publication.

## Pros and Cons of the Options

### Invocation, option 1, drop the subcommand

- Good, because it matches the tool's actual CLI and needs no configuration.
- Bad, because it is version-coupled; mitigated by a pinned devDependency and an argv assertion.

### Invocation, option 2, document the override

- Good, because it is a zero-code change.
- Bad, because it makes every user configure a workaround for a bug, and a grader whose default is
  known-broken is not a grader.

### Invocation, option 3, version detection

- Good, because it would span major versions.
- Bad, because it means spawning the tool twice, or parsing `--version` output, to work around a
  problem that only exists because the default was never verified. Complexity with no current payoff.

### Granularity, option A, deepest FAIL only

- Good, because it is a one-line rule.
- Bad, because in this shape the deepest node is the unlabelled assertion. It produces exactly one
  finding and throws away the message that makes it useful.

### Granularity, option B, labelled-and-deepest

- Good, because it lands on the step, the node with both the description and the failure detail.
- Good, because it stays shape-agnostic. There is no hardcoded key path, so a results-format change
  degrades to the exit-code fallback rather than silently reporting nothing.
- Neutral, because "can name itself" is a heuristic. It matches the fallback chain the adapter
  already used for labels, so it introduces no new concept.

### Granularity, option C, hardcode the key path

- Good, because it is unambiguous for the current format.
- Bad, because it couples the adapter to an internal shape of a third-party tool. A renamed key
  produces silence rather than a loud failure, which is the worst outcome for a gate.
