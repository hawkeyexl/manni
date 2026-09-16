# Architecture Decision Records

Every **behavior change** in moose-tracevals ships with an ADR here. The ADR records the intended behavior and the reasoning. Write it before or alongside the code, so it is the reviewable source of truth rather than an afterthought. The full rule lives in [CLAUDE.md](../CLAUDE.md#architecture-decision-records-required).

## Conventions

- **Format**: [MADR 4.0.0](https://adr.github.io/madr/). Start from [template.md](template.md).
- **Filename**: `NNNNN-kebab-case-title.md`, 5-digit zero-padded.
- **Numbering starts at `01000`** and increments. The range `00001`–`00999` is **reserved** to backfill pre-existing architectural decisions later. Do not use it for new ones.
- **Scope** covers decisions (behavior, contracts, trade-offs), not mechanical changes. If a change alters observable behavior or a public contract, it needs one.

## Index

| ADR | Title | Status |
|---|---|---|
| [01000](01000-rebuild-as-trace-adherence-evaluator-on-docevals-and-docmeta.md) | Rebuild moose-tracevals as a trace-adherence evaluator on docevals and docmeta | accepted |
| [01001](01001-reuse-docevals-provider-and-consensus-layer-not-makejudge.md) | Reuse docevals' provider and consensus layer, not makeJudge | accepted |
| [01002](01002-declared-criteria-plus-implicit-whole-artifact-eval.md) | Declared frontmatter criteria plus an implicit whole-artifact eval; drop heading scraping | accepted |
| [01003](01003-claude-code-traces-first-with-an-adapter-seam.md) | Claude Code traces first, with an adapter seam and graceful degradation | accepted |
| [01004](01004-validate-grader-options-up-front.md) | Validate grader options up front, not only while grading | accepted |
| [01005](01005-fill-proposes-criteria-at-authoring-time.md) | `fill` proposes criteria at authoring time, with deterministic graders and a confidence gate | accepted |
| [01006](01006-take-inference-from-the-shared-library-not-docevals.md) | Take the inference layer from `@hawkeyexl/inference`, not from docevals | accepted |
| [01007](01007-ship-a-cuj-first-documentation-site.md) | Ship a CUJ-first documentation site, with a committed content strategy and mechanical drift gates | accepted |
| [01008](01008-rename-the-project-to-moose-tracevals.md) | Rename the project to `moose-tracevals` and publish it unscoped | accepted |
| [01009](01009-share-one-moose-config-file-across-the-family.md) | Read settings from a `tracevals:` section of a shared `moose.config.yaml` | accepted |
| [01010](01010-adopt-the-docmeta-artifact-evals-vocabulary.md) | Adopt `docmeta:artifact-evals` as the eval vocabulary, and stop publishing our own | accepted |
| [01011](01011-execute-command-graded-evals.md) | Execute `command`-graded evals, on by default | accepted |
| [01012](01012-verify-quoted-paths-and-pin-the-vendored-schema.md) | Verify repo paths quoted in the docs, and pin the vendored schema's bytes | accepted |
| [01013](01013-carry-position-and-branch-identity-in-the-trace-model.md) | Carry position and branch identity in the normalized trace model | accepted |
| [01014](01014-merge-sidecar-subagent-transcripts-into-the-trace.md) | Merge sidecar subagent transcripts into the trace, spliced at the spawn | accepted |
| [01015](01015-grade-each-artifact-against-the-window-it-governed.md) | Grade each artifact against the window it governed | accepted |
| [01016](01016-read-the-availability-roster-and-check-the-artifact-that-never-fired.md) | Read the availability roster, and check the artifact that never fired | accepted |
| [01017](01017-load-grader-plugins-named-in-the-config.md) | Load grader plugins named in the config, and append `--require` to that list | accepted |
| [01018](01018-evaluate-many-traces-in-one-run.md) | Evaluate many traces in one run, and report rates rather than a verdict | accepted |
| [01019](01019-add-an-opt-out-for-command-execution.md) | Add an opt-out for `command` execution, without reversing its default | accepted |
| [01020](01020-redact-the-judge-digest-before-it-leaves-the-machine.md) | Redact the judge digest before it leaves the machine | accepted |
| [01021](01021-warn-when-an-artifact-changed-after-the-session.md) | Warn when an artifact changed after the session ended | accepted |
| [01022](01022-measure-the-judge-against-a-labels-sidecar.md) | Measure the judge against a labels sidecar, and sweep the knobs for free | accepted |
| [01023](01023-give-slash-commands-their-own-artifact-type.md) | Give slash commands their own artifact type, and let the filesystem say what a `/name` is | accepted |
| [01024](01024-capture-a-session-manifest-so-staleness-is-exact.md) | Capture a session manifest, and make staleness exact instead of a guess | accepted |
| [01025](01025-adopt-artifact-evals-proposal-2.md) | Adopt `docmeta:artifact-evals:1.0.0-proposal.2` | accepted |
| [01026](01026-a-tool-order-grader.md) | A `tool-order` grader, with the weakest useful semantics | accepted |
| [01027](01027-skill-invoked-is-not-an-adherence-suite.md) | `skill-invoked` alone is not an adherence suite | accepted |
| [01028](01028-a-judge-grading-its-own-session.md) | A judge grading its own session is reported | accepted (signature superseded by 01031) |
| [01029](01029-target-selects-the-graded-subject.md) | `target` selects the graded subject, alongside graders' own narrowing options | accepted |
| [01030](01030-weight-feeds-a-reported-pass-rate.md) | `weight` feeds a reported pass rate, not a gate | accepted |
| [01031](01031-per-eval-runs-and-model.md) | Per-eval `runs` and `model`, and the judge context that carries them | accepted |
| [01032](01032-the-criterion-axis-of-self-preference.md) | The criterion axis of self-preference, and reading `eval-provenance` back | accepted |
| [01033](01033-work-the-prose-corpus-to-zero-and-make-the-vale-gate-blocking.md) | Work the prose corpus to zero, and make the Vale gate blocking | accepted |
