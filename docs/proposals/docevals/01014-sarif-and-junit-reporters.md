---
status: "accepted"
date: 2026-08-28
decision-makers: [hawkeyexl]
---

# SARIF and JUnit reporters, and a suite stamped on every result

## Context and Problem Statement

`run` emitted four formats: `human`, `json`, `markdown`, `github`. The last is the CI story, and it is a narrow one. GitHub workflow commands annotate a single check run, and the annotations disappear with it. There is no history, nothing to query, and nothing at all outside GitHub Actions.

docmeta's proposal 0003 named the two formats that fill those gaps, and the same gaps are here.

## Decision Drivers

- **A finding that scrolls away is a finding nobody tracks.** "Was this failing last week?" has no answer today.
- **Not everyone is on GitHub Actions.** Jenkins, GitLab, CircleCI and Buildkite all read JUnit XML natively and none of them read workflow commands.
- **`REPORT_FORMATS` is already the single source of truth** (ADR 01007), so adding a format is two constants and a module, not a new surface.
- **`Finding` already carries what SARIF wants**, namely `file`, `line`, `col`, `ruleId` and `severity`. The mapping is nearly total.
- **Both formats fail silently when malformed**, in exactly the place they were meant to help. A bad SARIF URI uploads fine and annotates nothing. Invalid JUnit XML makes a CI system report "no tests found" rather than the failure it was handed.

## Considered Options

- **Keep `github` only.**
- **Add SARIF.**
- **Add SARIF and JUnit.**

## Decision Outcome

The chosen option is **both.** They answer different questions. SARIF is "what is wrong with this corpus, tracked over time", and JUnit is "did the checks pass in this build". Neither substitutes for the other.

Three decisions inside the implementation are worth recording, because each had a wrong-but-plausible alternative:

- **SARIF URIs are repo-relative and forward-slashed**, and CI asserts it. An absolute path uploads successfully and matches no file. So does a Windows path with backslashes, which this repo produces on one of its two CI runners. The failure is invisible: a green upload and an empty dashboard.
- **A failing ai-graded eval is a SARIF result too**, even though it has no `Finding`. Emitting only findings would leave every judged failure out of the dashboard, which reads as "the AI evals all passed". That is the most misleading possible summary.
- **`needs-review` maps to `<skipped>` in JUnit, not `<failure>`.** JUnit has no third state, and reporting a human-review queue as a broken build tells the person reading it the wrong thing.

Making JUnit group correctly required one change outside the reporters: **`EvalResult` now carries `suite`**. The engine already computed that mapping for the suite summaries and threw it away. Without it a JUnit report could not group by suite at all. `--format json` reported per-suite pass rates with no way to tell which results produced them. It is stamped centrally in `runEvals` rather than threaded through the ~30 places a result is constructed.

### Consequences

- **Good.** Findings survive as a queryable history, and non-GitHub CI gets a native report.
- **Good.** `EvalResult.suite` makes the JSON output self-describing, which it was not.
- **Neutral.** `suite` is optional on `EvalResult` so existing constructions compile; the engine fills it for every result it returns.
- **Bad, and accepted.** Two more output shapes to keep correct. Mitigated by parsing both in CI rather than trusting them. A reporter whose failure mode is silence needs a gate that actually reads the bytes.

### Confirmation

`test/unit/reporters-ci.test.ts` pins the SARIF envelope, repo-relative URIs, rule declaration, and the `warning`/`info` → `warning`/`note` mapping. For JUnit it pins the suite/testcase structure, the failure and skip elements, and XML escaping of all five metacharacters. CI runs the built CLI and *parses* both outputs, using JSON for SARIF and Python's `ElementTree` for JUnit. It asserts that every result's rule is declared and that no URI is absolute or backslashed. `test/unit/format.test.ts` pins the allowed set and the usage-error message.

## Pros and Cons of the Options

### Keep `github` only

- Good, because it is what exists and it works where it works.
- Bad, because it works nowhere else, and keeps no history even there.

### SARIF only

- Good, because it is the format that buys a real dashboard.
- Bad, because it is GitHub-and-friends shaped in practice, and leaves every JUnit-reading CI with nothing.

### Both

- Good, because the two answer different questions and the marginal cost of the second is one module.
- Bad, because two silent failure modes instead of one. That is why both are parsed in CI rather than eyeballed.
