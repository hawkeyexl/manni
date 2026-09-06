---
status: accepted
date: 2026-07-24
decision-makers: [hawkeyexl, Claude]
---

# `fill` proposes criteria at authoring time, with deterministic graders and a confidence gate

## Context and Problem Statement

Artifacts without a `metadata.evals` block fall back to one implicit whole-artifact eval (ADR 01002), which is coarse and expensive. Writing criteria by hand is the bottleneck for adopting moose-tracevals across a project. The sibling docevals shipped `fill`, which asks an LLM to propose evals per page and appends those above a confidence threshold. How should moose-tracevals bulk-propose criteria, and does writing into artifacts contradict ADR 01002, which removed exactly that?

## Decision Drivers

- ADR 01002 removed criteria write-back and recorded that "evaluation is read-only end to end".
- docevals' `fill` proposes `llm` graders only; the reason it gives does not obviously transfer.
- Proposals land in files a human maintains and reviews in a diff, so low-signal noise erodes trust fast.
- Self-reported LLM confidence is a weak, uncalibrated signal to gate a write on.
- Some artifacts are read by the agent under test before it acts.

## Considered Options

- **Authoring-time `fill` with deterministic graders and a confidence gate** (chosen).
- **Port docevals' `fill` verbatim**: llm-graded proposals only.
- **Leave criteria hand-authored**: no proposal command at all.

## Decision Outcome

Chosen option: "Authoring-time `fill`". Specifics:

### It does not reverse ADR 01002

ADR 01002 rejected two distinct things under one heading: **(a)** *inferring* criteria from unstructured prose by convention (heading scraping), and **(b)** *writing* criteria **during evaluation** (`run --detect-criteria`). This ADR keeps (a) rejected in full and narrows (b) to "during evaluation".

`fill` is a separate command that `run` never invokes. It derives nothing from headings or prose structure. Its output is a **proposal a human accepts in review**, not an inference the evaluator acts on. It is the same declared-criteria contract someone would type by hand. 01002's invariant survives: criteria are a declaration, never an inference.

The accepted cost: `run` results now depend on whether `fill` has been run against a repo. That is the point of adding criteria, and it is why every write lands in a reviewable diff.

### Deterministic graders are proposable

docevals restricts `fill` to `llm` because a `command`-grader eval without a command is scriptgen's target state. Bulk-filling would therefore seed LLM code generation and eventual execution. **moose-tracevals has no such hazard.** Its graders are a fixed registry configured by declarative options, with no codegen and no execution. There is also no `promote`/`generate` pipeline to recover determinism later, so an llm-only port would strand it permanently.

Grader choice is gated by an allowlist per artifact type. `cost`, `turn-count`, and `json-output` are excluded everywhere, because they are whole-session graders. A budget declared inside one skill silently constrains the entire session, and double-counts when several artifacts declare it. `skill-invoked` is excluded from skills and agents because artifact resolution is trace-driven. A criterion asserting that its own artifact was used can only ever be graded in a session that used it, making it permanently green.

`tool-usage` proposed on an **agent definition** is normalized to `includeSidechains: true`. Such a criterion describes what the subagent did, and subagent tool calls are recorded as sidechain calls, which the grader excludes by default.

### Confidence is the last gate, not the only one

A 0–1 self-reported confidence is required on every proposal and gates writing at **0.7** (`fill.confidenceThreshold` / `--confidence`), matching the manuscript's calibration bar. Because that number is uncalibrated, mechanical checks run **first** and are not overridable by a high score:

- the grader must be allowed for the artifact type;
- its options must pass the grader's own `validateOptions` (ADR 01004);
- the target must exist, whether a tool in the project's vocabulary, a skill found in the same scan, or a repository-relative `file-access` path. `mcp__`-prefixed tools are accepted by prefix, since MCP tools are named at connect time.

Every rejection carries a machine-readable reason (`low-confidence`, `invalid-options`, `grader-not-allowed`, `ungrounded-target`, `duplicate-name`) so the report is actionable and CI can assert the gate ran.

### Static structure grounds the prompt; it does not mint criteria

An agent's `tools:` grant and a skill's `name`/`description` are fed to the model as grounding context and used to build the rejection vocabulary. They are deliberately **not** converted into criteria directly. A `tools:` list is an allowlist rather than a requirement, so `expect: used` is wrong. `expect: not-used` over the complement is tautological under a runner that enforces the grant.

### Project rules are proposed, never written

`CLAUDE.md` / `AGENTS.md` / `GEMINI.md` are discovered and proposed against, and the proposals are reported. They are never written. Criteria inside a file the agent reads before acting are teaching to the test. The rubric would enter the system prompt and inflate later `run` scores for reasons unrelated to real improvement. Frontmatter is also injected verbatim as context, and `AGENTS.md` is a cross-vendor file whose spec has no frontmatter concept. Writing them needs its own decision, likely a sidecar rather than inline frontmatter. `GEMINI.md` is added to the recognized filenames in resolution as well as discovery, so proposals for it are not dead on arrival.

### Mechanics

- **Writes by default, `--dry-run` to preview**, matching docevals so the verb behaves the same across the sibling tools.
- Appends only; existing criteria are never modified or reordered, and a name collision is an error rather than an overwrite.
- Artifacts with no frontmatter get a block synthesized above a byte-identical body. That is the common case, since most project rules and many agent files carry none.
- The cache stores the **raw pre-gating** proposal. The key is provider, model, `FILL_PROMPT_VERSION`, temperature, per-artifact cap, artifact type, body hash, and the existing criterion-name set. Re-tuning `--confidence` therefore re-gates for free, and a post-fill re-run misses and asks for *additional* coverage instead of replaying an applied proposal.
- Untestable instructions are reported under `needsSharpening` rather than turned into soft assertions. An instruction with no observable failure is a defect in the artifact; naming it is more useful than covering it.
- New criteria are written as `type: regression` (schema 0.2), since they describe behavior the artifact already asks for.
- Provider construction is lazy, so a fully-cached run needs no API key.

### Consequences

- Good, because adopting moose-tracevals across a project stops being a hand-authoring exercise. Deterministic criteria, the cheap and CI-friendly kind, are proposed where they fit.
- Good, because every write is gated by checks that do not depend on the model's self-assessment, and every rejection is explained.
- Good, because threshold experiments cost no tokens.
- Bad, because `run` results now depend on whether `fill` has been run.
- Bad, because project rules, the most assertion-dense artifact type, cannot be filled automatically yet.
- Neutral, because `--provider mock` needs proposal-shaped responses; `makeJudgeProvider` gained an optional `mockResponses` for it.

### Confirmation

`test/unit/fill.test.ts` pins the round trip. Criteria are written into skill and agent frontmatter, project rules are reported but left byte-identical, and a dry run writes nothing. Rejections carry reasons, a second run is served from cache, and changing only the threshold re-gates without an API call. A provider failure is contained to one artifact, and the written frontmatter is re-read through `extractCriteria` and `planEvals`. `test/unit/fill-gate.test.ts` covers every rejection reason, the allowlist, sidechain normalization, and cap-versus-confidence reporting. `test/unit/frontmatter-write.test.ts` pins the writer against BOM, CRLF, comment preservation, and block synthesis. CI's dogfood step runs the built CLI against the fixture corpus and asserts `git diff --quiet` on it, so a regression that silently starts writing fails loudly.

## Pros and Cons of the Options

### Authoring-time `fill` with deterministic graders

- Good, because it matches the deterministic-first grader hierarchy the manuscript describes.
- Good, because mechanical grounding compensates for uncalibrated confidence.
- Bad, because it adds a write path to a tool that was read-only end to end.

### Port docevals' `fill` verbatim (llm-only)

- Good, because it is the smallest diff and keeps the two tools identical.
- Bad, because moose-tracevals has no `promote` step, so determinism would never be recovered.
- Bad, because it inherits a restriction whose justification (generated code execution) does not exist here.

### Leave criteria hand-authored

- Good, because every criterion is human-authored, which the cited research favors.
- Bad, because the implicit whole-artifact eval stays the default in practice, which is coarse and costly.
