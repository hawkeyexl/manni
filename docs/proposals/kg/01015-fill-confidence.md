---
status: accepted
date: 2026-07-24
decision-makers: [hawkeyexl, Claude]
---

# `dockg fill` proposes all fields, gated by model confidence

## Context and Problem Statement

`dockg fill` lifts `kg:` frontmatter with an LLM and writes it back, guarded by
the SHACL "certified by structure" gate ([ADR 01006](adrs/01006-shacl-graph-validation.md)).
Today it proposes only four SKOS fields. `broader` and `narrower` are held back
by a static allowlist because they hallucinate. There is no confidence signal
beyond a prompt line telling the model to "omit fields you aren't sure of."

The iiRDS research frames fill as the deliberate **resolution-deepening** step,
paired with **exception-based human review**. The model reasons about each
proposal and self-scores it. Low-confidence proposals surface for review instead
of being written, and a human inspects only the exceptions. That model wants
*more* fields proposed so the graph deepens, not fewer. Confidence decides what
lands, rather than a hard allowlist.

How should fill decide what to propose and what to write, and where does
confidence live?

## Decision Drivers

- The maintainer's steer: fill should be able to propose **all** fillable fields;
  **confidence** decides what is written, not a static allowlist. Dangerous
  fields (product variants, negative scope) should earn low confidence and be
  filtered, not be forbidden.
- Strictness is the default *inside* the explicit `fill` command
  ([ADR 01009](adrs/01009-opinionated-defaults.md)).
- The SHACL guardrail stays the structural gate; confidence is an orthogonal,
  additional gate.
- No network in tests (MockProvider); determinism of `build` is untouched.
- An agent orchestrating dockg must be able to read fill's exit code correctly.
  Routine low-confidence drops are **not** failures.

## Considered Options

- **What fill proposes.** A curated safe allowlist · **all fields, confidence-gated**.
- **Confidence gate default.** Off (opt-in) · **on, strict (0.7)**.
- **Confidence storage.** Run report only · **persisted in `kg.provenance`** and
  the emitted graph.
- **Dropped-for-confidence exit code.** Exit 1 (a finding) · **exit 0** (normal).

## Decision Outcome

**Fill proposes all doc-level fillable fields.** That is the six SKOS fields
plus the iiRDS fields added in Phases 2–4: `topicType`, `appliesTo`,
`softwareLifecyclePhase`, `softwareSubject`, `notApplicableTo`, and
`notSoftwareSubject`. The default `fill.fields` is the full set, and the old
`broader`/`narrower`-off allowlist is retired.

**The model returns per-field `confidence` (0..1) and `reasoning`.** The
reasoning is forced, because it is what makes the score meaningful, and it is
shown in the run report. `fill.minConfidence` defaults to **0.7**. A field
scored below it is **dropped and reported, not written**. The confidence gate
runs *before* the SHACL guardrail, and the two are orthogonal. Confidence covers
every field; the guard covers the structural subset. The prompt instructs the
model to score hallucination-prone fields such as variants and negatives low
unless the text is unambiguous. Those fields then self-filter without a hard
rule.

**Confidence is persisted in `kg.provenance`**, the per-model attribution entry
fill already writes, and reflected in the emitted graph. The `#kg-fill` activity
reifies each filled field into an entry node carrying `dockg:filledField` and
`dockg:confidence`, blank-node-free and deterministic. Frontmatter is the
durable, human-reviewable audit surface, and the graph carries it for downstream
consumers.

**A field dropped for low confidence is exit 0.** That is normal, expected
operation. Filling a corpus is expected to drop many low-confidence proposals.
An exit 1 would read as "the command failed" to an orchestrating agent, which is
wrong.
Exit 1 stays reserved for `status: "error"` (schema-invalid proposal, unsupported
frontmatter, YAML write failure); exit 2 for operational failures. This mirrors
how the guardrail's `rejected` fields are already reported without failing.

**Section-level fill is out of scope.** Fill is architecturally doc-level (one
proposal per doc); filling `kg.sections` is a structural extension for a
follow-up.

### Consequences

- Good. The graph deepens across all typed fields, with a self-filtering safety
  mechanism the research prescribes; humans review only flagged exceptions.
- Good. Confidence + reasoning give a durable, inspectable audit trail; the SHACL
  guard still blocks structurally-invalid writes regardless of confidence.
- Good. The exit code stays a truthful signal. 0 for normal runs, including
  heavy dropping, and 1 only for real errors.
- Bad. The response contract, the schema (`frontmatter-0.8.json`), the emitter,
  and the shapes (`dockg-0.5.ttl`) all change in one phase. The `dockg:`
  namespace grows by two properties (`filledFieldEntry`, `confidence`, 8 → 10).
- Bad. A model's self-scored confidence is not calibrated ground truth. 0.7 is a
  starting default, tunable per corpus via `fill.minConfidence`.

### Confirmation

`test/unit/fill.test.ts` runs against MockProvider. A mixed-confidence proposal
writes the high fields and drops the low ones with a report. Other cases cover
the `minConfidence` override, confidence recorded in the written
`kg.provenance`, and an iiRDS field filled at high confidence. Two more cover a
disjoint `appliesTo`/`notApplicableTo` proposal rejected by the extended guard,
and dropped-for-confidence keeping exit 0. In `test/unit/derive.test.ts`, a provenance entry with confidence emits the
reified entry nodes and `dockg:confidence` decimals. `test/unit/shacl.test.ts`
confirms the entry conforms to `dockg-0.5.ttl`. `test/unit/schema-sync.test.ts`
asserts `FIELD_SCHEMAS` and the provenance `fields` enum both equal the full
fillable set. The determinism gates cover the new triples: double-build,
version-normalized golden, and n3 round-trip.

## Pros and Cons of the Options

### All fields, confidence-gated

- Good. Deepens the graph; self-filtering; no arbitrary field bans.
- Bad. Relies on the model scoring honestly; needs the confidence contract and a
  sensible default threshold.

### Curated safe allowlist

- Good. Simplest; no confidence machinery.
- Bad. Caps the graph at whatever list is deemed safe; the research's
  resolution-deepening never happens; the allowlist is itself a guess.

### Confidence in run report only

- Good. No schema/emitter/shapes change; graph stays lean.
- Bad. The audit trail evaporates once the run ends. A reviewer coming back
  later cannot see why a field was written or how sure the model was.

### Exit 1 for dropped-confidence

- Good. Signals "review needed."
- Bad. Routine, expected drops would read as command failure to an orchestrating
  agent. That is the exact confusion this rule exists to avoid.
