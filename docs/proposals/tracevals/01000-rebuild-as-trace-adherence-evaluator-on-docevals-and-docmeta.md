---
status: accepted
date: 2026-07-24
decision-makers: [hawkeyexl, Claude]
---

# Rebuild moose-tracevals as a trace-adherence evaluator on docevals and docmeta

## Context and Problem Statement

moose-tracevals 0.2.x was a self-contained eval framework with three modes (spec trials through `claude -p`, transcript, prompt). It carried its own LLM judge, spawning the `claude` CLI, and regex-based criteria scraping. The judge duplicated machinery the sibling docevals project already ships: providers, ensemble consensus, and confidence zones. The multi-mode design also blurred what the tool is for. What should the ground-up rework be built around, and on what foundations?

## Decision Drivers

- One clear job, evaluating whether an existing agent session adhered to the skills and instructions it used.
- Avoid re-implementing judge safety machinery (errored-run handling, consensus, zones) that docevals already tests.
- Frontmatter parsing and schema validation are docmeta's domain; duplicating them invites drift.
- Live trial generation (spec mode, pass@k) coupled the tool to a specific agent CLI and made runs expensive and nondeterministic.

## Considered Options

- Trace-only rework depending on docevals + docmeta
- Rework internals but keep all three modes
- Keep the tool self-contained and only refactor

## Decision Outcome

Chosen option: "Trace-only rework depending on docevals + docmeta". The pipeline is: select trace → parse → deterministically resolve used artifacts → extract criteria → grade (deterministic + ensemble LLM judge) → report. Spec mode, prompt mode, pass@k, and live trial generation are removed. docevals supplies the judge provider layer and ensemble math; docmeta supplies frontmatter extraction and schema validation. Until docevals publishes to npm, it is consumed via a `file:../docevals` dependency, and releases of moose-tracevals stay disabled.

### Consequences

- Good, because the tool has one job and every run is reproducible from an existing trace file.
- Good, because judge invariants are inherited from a tested dependency instead of re-implemented.
- Bad, because generating fresh trials now requires running the agent separately and pointing moose-tracevals at the resulting session file.
- Bad, because a `file:` dependency blocks npm publishing until docevals ships.

### Confirmation

CI's dogfood gate runs the built CLI against the fixture corpus. The absence of any trial-generation code path is enforced by the package no longer spawning agent CLIs outside the judge provider layer. That is checked in review, and the hermetic-test rule flags any new spawn.

## Pros and Cons of the Options

### Trace-only rework depending on docevals + docmeta

- Good, because smallest surface with the clearest contract.
- Good, because reuse eliminates two parallel judge implementations.
- Bad, because coupled to sibling-repo release timing.

### Keep all three modes

- Good, because no capability is lost.
- Bad, because spec mode's trial runner, pass@k math, and workspace snapshotting dominate maintenance while serving a different problem (benchmarking, not adherence auditing).

### Self-contained refactor

- Good, because no cross-repo dependency.
- Bad, because judge/consensus/zones would remain duplicated and untested against docevals' calibration corpus.
