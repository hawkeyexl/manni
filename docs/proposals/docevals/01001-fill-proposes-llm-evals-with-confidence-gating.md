---
status: "superseded by ADR-01011"
date: 2026-07-24
decision-makers: [hawkeyexl]
---

# `fill` proposes llm-graded evals with a confidence gate

## Context and Problem Statement

Pages declare evals in frontmatter, but authoring them by hand is the bottleneck for adopting moose-docevals across a docs corpus. dockg solved the analogous problem for SKOS metadata with a `fill` subcommand that asks an LLM to propose missing frontmatter. How should moose-docevals bulk-propose evals, and how should it decide which proposals are trustworthy enough to write?

Notably, dockg's `fill` has **no numeric confidence threshold**. It relies on prompt self-gating ("omit fields you are not confident about"), schema validation, and a cost budget. moose-docevals already has real confidence machinery, in judge confidence zones and the 70% calibration bar. The question of a scored gate is therefore live here in a way it was not there.

## Decision Drivers

- Proposals are written into content files and reviewed in PRs, and low-confidence noise erodes trust in the tool.
- Frontmatter-declared commands are arbitrary code execution (`scripts.allowFrontmatterCommands` invariant); a bulk generator must not widen that surface.
- Re-running over a corpus must be cheap: token spend is the scarce resource, thresholds are not.
- Existing human-authored evals must never be modified, reordered, or duplicated.
- Config ↔ CLI parity: every knob must be reachable from the config file and overridable by a flag.

## Considered Options

- **Numeric confidence gate.** The LLM emits a 0–1 confidence per proposed eval. Only proposals at or above a threshold (default 0.7) are written, and the rest are reported.
- **dockg parity.** Prompt self-gating plus schema validation and cost budget only, no score.
- **Reuse the judge zone threshold** (`judge.zones.autoPass`, 0.8) instead of a new knob.

## Decision Outcome

Chosen option: "Numeric confidence gate", with these specifics:

- **Grader `llm` only**, written explicitly (`grader: llm`, explicit `type`). `fill` never proposes `command` evals. A command eval without a command is the scriptgen target state. A bulk fill would therefore seed LLM code generation, and eventual execution, on the next `run`. Determinism flows through the existing `promote` → `generate` pipeline instead. `tool:*` graders need per-tool options fill cannot infer; `human` is pointless to machine-propose.
- **Threshold** defaults to **0.7** (matching the manuscript's 70% calibration bar), configurable via `fill.confidenceThreshold` and `--confidence`. A separate knob rather than reusing `judge.zones.autoPass`, because judge-verdict confidence and proposal confidence measure different things and should tune independently.
- **Append-only-missing-names.** Proposals are deduplicated against the page's *resolved plan*, which covers inline evals, `use:` references, and suite-expanded evals. Surviving evals are appended, and existing entries are never touched. Pages with `evals: {skip: true}` are skipped without an LLM call.
- **Write by default, `--dry-run` to report** (dockg parity). Statuses: `filled | proposed | nothing-proposed | skipped | skipped-budget | error`. Exit `0` clean, `1` any contained per-page error, `2` operational.
- **`confidence` and `rationale` are report-only**, and never persisted to frontmatter.
- **Cache stores the raw pre-gating proposal**, keyed on provider, model, `FILL_PROMPT_VERSION`, temperature, `maxEvalsPerPage`, body hash, and the existing eval-name set. Changing `--confidence` therefore re-gates from cache with zero API calls. A post-fill re-run misses, because the name set changed, and asks for *additional* coverage instead of replaying stale proposals. Separate cache dir (`.moose-docevals/cache/fill`) from the judge cache: different key schemes and value shapes must never mix.
- **Lazy provider construction.** Identity is resolved without building the provider, so fully-cached or all-skipped runs need no API key.
- Every proposal must carry `examples.pass` / `examples.fail`, so generated evals never trigger the resolve-time missing-examples warning.
- Pages with no frontmatter block get one synthesized; everywhere else the edit is surgical and the body stays byte-identical.

### Consequences

- Good, because reviewers see only proposals the model itself rates above the bar, with the rest visible in the report for manual salvage.
- Good, because the command-grader exclusion keeps `fill` outside the arbitrary-code-execution surface.
- Good, because threshold experiments and corpus re-runs are free once proposals are cached.
- Bad, because LLM self-reported confidence is imperfectly calibrated; the 0.7 default may need tuning against real corpora.
- Bad, because two cache directories (judge, fill) exist under `.moose-docevals/cache/`.

### Confirmation

`test/unit/fill.test.ts` pins gating (boundary at exactly 0.7) and dedupe against inline and suite-referenced names. It also pins dry-run byte-identity, cache hit behavior, budget skip, and per-page error containment, all offline via `MockProvider`. `test/unit/frontmatter-append.test.ts` pins the shape matrix and validates output against `schemas/frontmatter-0.1.json`, so `fill` can never write frontmatter the published schema rejects. `test/integration/fill.test.ts` proves the round trip on a copy of the fixture corpus. CI's dogfood run is unaffected: fill is exercised at the library seam only, like `generate`.

## Pros and Cons of the Options

### Numeric confidence gate

- Good, because it gives users a tunable precision/recall dial with a principled default.
- Good, because gating after caching decouples threshold changes from token spend.
- Neutral, because it adds one config field and one flag.
- Bad, because self-reported confidence is only a proxy for correctness.

### dockg parity (no score)

- Good, because it is simpler and matches the sibling tool.
- Bad, because nothing is tunable. The only lever on proposal quality is rewriting the prompt.
- Bad, because moose-docevals' whole design (zones, calibration) is built on scored confidence; an unscored generator is out of character.

### Reuse `judge.zones.autoPass` (0.8)

- Good, because one shared threshold is less configuration.
- Bad, because it couples two unrelated quantities: judge-verdict confidence on an existing assertion vs. generation confidence in a brand-new one. Tuning one would silently move the other.
